import { proxyActivities, workflow, condition } from '@temporalio/workflow';
import { StatefulWorkflow } from 'chrono-forge';
import EventEmitter from 'eventemitter3';
import * as dottie from 'dottie';

// Activity proxy setup
const activities = proxyActivities({
  startToCloseTimeout: '1 minute',
  retry: { maximumAttempts: 3, initialInterval: 5000, maximumInterval: 10000 },
  heartbeatTimeout: 60000
}) as Record<string, (...args: any[]) => Promise<any>>;

export type DSLDefinition = {
  state: Record<string, any>;
  plan: DSLStatement;
};

export type DSLStatement = {
  when?: (dsl: DSLDefinition) => Promise<boolean>;
  until?: (dsl: DSLDefinition) => Promise<boolean>;
} & ({ execute: Execute } | { sequence: Sequence } | { parallel: Parallel } | { loop: Loop });
export type ExecutionType = 'activity' | 'workflow' | 'dynamic' | 'graph';

export type Sequence = { elements: DSLStatement[] };
export type Parallel = { branches: DSLStatement[] };
export type Execute = {
  type: ExecutionType;
  name: string;
  handler?: string;
  taskQueue?: string;
  needs?: string[];
  provides?: string[];
  result?: string;
};
export type Loop = { condition: string; body: DSLStatement[] };

export type ExecutionType = 'activity' | 'workflow' | 'dynamic' | 'graph';

// Decorator for Step Management
function Step(executionType: ExecutionType, name: string, taskQueue?: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    target[propertyKey].metadata = { executionType, name, taskQueue };
  };
}

class DynamicExecutionEngine extends StatefulWorkflow {
  private dsl: DSLDefinition;
  private bindings: Record<string, any> = {};
  private queriesQueue: any[] = [];
  private signalsQueue: any[] = [];
  private processing: boolean = false;

  constructor(dsl: DSLDefinition) {
    super();
    this.dsl = dsl;
    this.initialize();
  }

  initialize() {
    Object.keys(this.dsl.state).forEach((key) => {
      this.bindings[key] = this.evaluateVariable(this.dsl.state[key]);
    });

    this.setupDynamicQueriesAndSignals();

    this.on('signal', async (signalName, args) => {
      await this.handleSignal(signalName, args);
    });
    this.on('query', async (queryName, args, resolve) => {
      await this.handleQuery(queryName, args, resolve);
    });
  }

  setupDynamicQueriesAndSignals() {
    const setup = (statement: DSLStatement) => {
      if ('execute' in statement) {
        const { provides = [] } = statement.execute;
        provides.forEach((path) => {
          const queryName = `query_${path}`;
          const signalName = `signal_${path}`;

          this.queryHandlers[queryName] = () => dottie.get(this.bindings, path);
          this.signalHandlers[signalName] = async (newValue: any) => {
            dottie.set(this.bindings, path, newValue);
          };

          workflow.setHandler(workflow.defineQuery(queryName), this.queryHandlers[queryName]);
          workflow.setHandler(workflow.defineSignal(signalName), async (...args: any[]) => {
            await this.signalHandlers[signalName](...(args as []));
            this.emit(signalName, ...args);
          });
        });
      } else if ('sequence' in statement) {
        statement.sequence.elements.forEach(setup);
      } else if ('parallel' in statement) {
        statement.parallel.branches.forEach(setup);
      } else if ('loop' in statement) {
        statement.loop.body.forEach(setup);
      }
    };

    setup(this.dsl.plan);
  }

  @Step('activity', 'activityName', 'default')
  async handleSignal(signalName: string, args: any[]) {
    if (this.signalsQueue.some((signal) => signal === signalName)) return;
    this.signalsQueue.push(signalName);
    if (!this.processing) {
      await this.processQueue();
    }
  }

  @Step('activity', 'queryName', 'default')
  async handleQuery(queryName: string, args: any[], resolve: Function) {
    if (this.queriesQueue.some((query) => query.queryName === queryName)) return;
    this.queriesQueue.push({ queryName, args, resolve });
    if (!this.processing) {
      await this.processQueue();
    }
  }

  async processQueue() {
    this.processing = true;
    while (this.signalsQueue.length || this.queriesQueue.length) {
      if (this.signalsQueue.length) {
        const signal = this.signalsQueue.shift();
        await this.executeSignalHandler(signal);
      }

      if (this.queriesQueue.length) {
        const { queryName, args, resolve } = this.queriesQueue.shift();
        const result = await this.executeQueryHandler(queryName, args);
        resolve(result);
      }
    }
    this.processing = false;
  }

  async executeSignalHandler(signalName: string) {
    console.log(`Processing signal: ${signalName}`);
  }

  async executeQueryHandler(queryName: string, args: any[]): Promise<any> {
    console.log(`Processing query: ${queryName}`);
    return {};
  }

  @Step('workflow', 'WorkflowName', 'workflow-task-queue')
  async execute(statement: DSLStatement, bindings: Record<string, any>): Promise<void> {
    if (statement.when && !(await statement.when(this.dsl))) return;
    if (statement.until && (await statement.until(this.dsl))) return;

    if ('parallel' in statement) {
      await Promise.all(statement.parallel.branches.map((el) => this.execute(el, bindings)));
    } else if ('sequence' in statement) {
      for (const el of statement.sequence.elements) {
        await this.execute(el, bindings);
      }
    } else if ('loop' in statement) {
      const conditionFn = new Function('bindings', `return ${statement.loop.condition}`);
      while (conditionFn(bindings)) {
        for (const el of statement.loop.body) {
          await this.execute(el, bindings);
        }
      }
    } else if ('execute' in statement) {
      const { type, name, taskQueue, needs = [], provides = [], result } = statement.execute;
      const resolvedArgs = needs.map((path) => dottie.get(bindings, path));
      console.log(`Executing ${type}: ${name} on task queue: ${taskQueue || 'default'} with args: ${resolvedArgs}`);

      let activityResult;
      if (type === 'activity') {
        activityResult = await this.invokeActivityOnTaskQueue(name, resolvedArgs, taskQueue);
      } else if (type === 'workflow') {
        activityResult = await this.invokeChildWorkflow(name, resolvedArgs, taskQueue);
      } else if (type === 'dynamic') {
        const dynamicFunction = new Function('bindings', ...needs, 'return ' + name);
        activityResult = dynamicFunction(this.bindings, ...resolvedArgs);
      }

      provides.forEach((path, index) => {
        dottie.set(bindings, path, activityResult[index]);
      });

      if (result) {
        bindings[result] = activityResult;
      }
    }
  }

  async invokeActivityOnTaskQueue(activityName: string, args: any[], taskQueue?: string): Promise<any> {
    const activityProxy = proxyActivities({
      taskQueue: taskQueue || 'default',
      startToCloseTimeout: '1 minute',
      retry: { maximumAttempts: 3, initialInterval: 5000, maximumInterval: 10000 },
      heartbeatTimeout: 60000
    });

    return await activityProxy[activityName](...args);
  }
  // Replace with actual workflow invocation code
  async invokeChildWorkflow(workflowName: string, args: any[], taskQueue?: string): Promise<any> {
    console.log(`Invoking child workflow: ${workflowName} on task queue: ${taskQueue || 'default'}`);

    return {};
  }

  async runExecutionLoop() {
    while (true) {
      console.log('Executing workflow root...');
      await this.execute(this.dsl.plan, this.bindings);

      if (this.shouldContinueAsNew()) {
        await workflow.continueAsNew();
      }

      await workflow.sleep('1m'); // Sleep to prevent tight loop execution
    }
  }

  shouldContinueAsNew(): boolean {
    return this.bindings['iteration'] >= 100;
  }

  private evaluateVariable(expression: string): any {
    return expression; // Logic to evaluate initial state variables or expressions
  }
}

// Usage Example
const dslDocument: DSLDefinition = {
  state: { 'user.preferences.mealType': 'vegetarian', 'user.preferences.cuisine': 'italian' },
  plan: {
    sequence: {
      elements: [
        {
          execute: {
            type: 'activity',
            name: 'generateMealPlan',
            needs: ['user.preferences.mealType'],
            provides: ['meals.generated'],
            taskQueue: 'task-queue-1'
          }
        },
        {
          execute: {
            type: 'activity',
            name: 'sendNotification',
            needs: ['meals.generated'],
            provides: ['notifications.sent'],
            taskQueue: 'task-queue-2'
          }
        }
      ]
    }
  }
};

const engine = new DynamicExecutionEngine(dslDocument);
await engine.runExecutionLoop();
