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

export type DSLStatement = { when?: (dsl: DSLDefinition) => Promise<boolean>; until?: (dsl: DSLDefinition) => Promise<boolean> } & (
  | { execute: Execute }
  | { sequence: Sequence }
  | { parallel: Parallel }
  | { loop: Loop }
);

export type Sequence = { elements: DSLStatement[] };
export type Parallel = { branches: DSLStatement[] };
export type Execute = { name: string; taskQueue?: string; needs?: string[]; provides?: string[]; result?: string };
export type Loop = { condition: string; body: DSLStatement[] };

// Main Dynamic Execution Engine using StatefulWorkflow
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
    // Initialize state and bindings
    Object.keys(this.dsl.state).forEach((key) => {
      this.bindings[key] = this.evaluateVariable(this.dsl.state[key]);
    });

    // Dynamically create query and signal handlers for provided paths
    this.setupDynamicQueriesAndSignals();

    // Setup event-driven execution model for signals and queries
    this.on('signal', async (signalName, args) => {
      await this.handleSignal(signalName, args);
    });

    this.on('query', async (queryName, args, resolve) => {
      await this.handleQuery(queryName, args, resolve);
    });
  }

  setupDynamicQueriesAndSignals() {
    // Go through each statement and set up queries/signals for each 'provides'
    const setup = (statement: DSLStatement) => {
      if ('execute' in statement) {
        const { provides = [] } = statement.execute;
        provides.forEach((path) => {
          const queryName = `query_${path}`;
          const signalName = `signal_${path}`;

          // Setup Query handler to get value from state at 'path'
          this.queryHandlers[queryName] = () => dottie.get(this.bindings, path);

          // Setup Signal handler to set value in state at 'path'
          this.signalHandlers[signalName] = async (newValue: any) => {
            dottie.set(this.bindings, path, newValue);
          };

          // Register Query and Signal with Temporal workflow
          workflow.setHandler(workflow.defineQuery(queryName), this.queryHandlers[queryName]);
          workflow.setHandler(workflow.defineSignal(signalName), async (...args: any[]) => {
            await this.signalHandlers[signalName](...(args as []));
            this.emit(signalName, ...args); // Emit event for further handling if needed
          });
        });
      } else if ('sequence' in statement) {
        statement.sequence.elements.forEach(setup);
      } else if ('parallel' in statement) {
        statement.parallel.branches.forEach(setup);
      } else if ('loop' in statement) {
        setup(statement.loop.body as any); // Assuming loop.body is a single statement for simplicity
      }
    };

    // Initiate setup for the entire DSL plan
    setup(this.dsl.plan);
  }

  async handleSignal(signalName: string, args: any[]) {
    if (this.signalsQueue.some((signal) => signal === signalName)) return;
    this.signalsQueue.push(signalName);
    if (!this.processing) {
      await this.processQueue();
    }
  }

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
    // Implement additional signal handling logic as needed
  }

  async executeQueryHandler(queryName: string, args: any[]): Promise<any> {
    console.log(`Processing query: ${queryName}`);
    // Implement additional query handling logic as needed
    return {}; // Return result based on query logic
  }

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
        await this.execute(statement.loop.body, bindings);
      }
    } else if ('execute' in statement) {
      const { name, taskQueue, needs = [], provides = [], result } = statement.execute;

      // Use 'dottie' to resolve 'needs' paths from bindings
      const resolvedArgs = needs.map((path) => dottie.get(bindings, path));
      console.log(`Executing activity: ${name} on task queue: ${taskQueue || 'default'} with args: ${resolvedArgs}`);

      const activityResult = await this.invokeActivityOnTaskQueue(name, resolvedArgs, taskQueue);

      // Use 'dottie' to set 'provides' paths in bindings
      provides.forEach((path, index) => {
        dottie.set(bindings, path, activityResult[index]);
      });

      // Optionally store the last activity's result in 'result'
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
    // Logic to evaluate initial state variables or expressions
    return expression;
  }
}

// Usage Example
const dslDocument: DSLDefinition = {
  state: { 'user.preferences.mealType': 'vegetarian', 'user.preferences.cuisine': 'italian' },
  plan: {
    sequence: {
      elements: [
        {
          execute: { name: 'generateMealPlan', needs: ['user.preferences.mealType'], provides: ['meals.generated'], taskQueue: 'task-queue-1' }
        },
        { execute: { name: 'sendNotification', needs: ['meals.generated'], provides: ['notifications.sent'], taskQueue: 'task-queue-2' } }
      ]
    }
  }
};

const engine = new DynamicExecutionEngine(dslDocument);
await engine.runExecutionLoop();
