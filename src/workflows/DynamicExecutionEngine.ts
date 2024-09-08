import { proxyActivities, proxyLocalActivities, workflow, condition, sleep, continueAsNew } from '@temporalio/workflow';
import { StatefulWorkflow } from 'chrono-forge';
import * as dottie from 'dottie';
import { registry } from './WorkflowRegistry';
import SchemaManager from './SchemaManager'; // Import SchemaManager

export type DSLDefinition = {
  state: Record<string, any>; // Managed by SchemaManager
  plan: DSLStatement; // Execution plan
};

export type DSLStatement = { when?: (dsl: DSLDefinition) => Promise<boolean>; until?: (dsl: DSLDefinition) => Promise<boolean> } & (
  | { execute: Execute }
  | { sequence: Sequence }
  | { parallel: Parallel }
  | { loop: Loop }
);

export type Sequence = { elements: DSLStatement[] };
export type Parallel = { branches: DSLStatement[] };
export type Execute = { name: string; taskQueue?: string; needs?: string[]; provides?: string[]; result?: string; handler?: string };
export type Loop = { condition: string; body: DSLStatement[] };

export class DynamicExecutionEngine extends StatefulWorkflow {
  private dsl: DSLDefinition;
  private schemaManager: SchemaManager;
  private queriesQueue: any[] = [];
  private signalsQueue: any[] = [];
  private processing: boolean = false;

  constructor(dsl: DSLDefinition) {
    super();
    this.dsl = dsl;
    this.schemaManager = SchemaManager.getInstance(); // Initialize SchemaManager instance
    this.initialize();
  }

  initialize() {
    // Set initial state in SchemaManager
    this.schemaManager.setState(this.dsl.state);

    // Setup dynamic queries and signals
    this.setupDynamicQueriesAndSignals();
  }

  setupDynamicQueriesAndSignals() {
    const setup = (statement: DSLStatement) => {
      if ('execute' in statement) {
        const { provides = [] } = statement.execute;
        provides.forEach((path) => {
          const queryName = `query_${path}`;
          const signalName = `signal_${path}`;

          // Use SchemaManager to get and set state dynamically
          this.queryHandlers[queryName] = () => this.schemaManager.getState(path);
          this.signalHandlers[signalName] = async (newValue: any) => {
            this.schemaManager.dispatch({ type: 'UPDATE_ENTITY', entityName: path, entity: newValue });
          };

          workflow.setHandler(workflow.defineQuery(queryName), this.queryHandlers[queryName]);
          workflow.setHandler(workflow.defineSignal(signalName), async (...args: any[]) => {
            await this.signalHandlers[signalName](...(args as []));
            this.enqueueSignal(signalName);
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

  private enqueueSignal(signalName: string) {
    this.signalsQueue.push(signalName);
  }

  private enqueueQuery(queryName: string, args: any[], resolve: Function) {
    this.queriesQueue.push({ queryName, args, resolve });
  }

  async handleSignal(signalName: string, args: any[]) {
    this.enqueueSignal(signalName);
    if (!this.processing) {
      await this.processQueue();
    }
  }

  async handleQuery(queryName: string, args: any[], resolve: Function) {
    this.enqueueQuery(queryName, args, resolve);
    if (!this.processing) {
      await this.processQueue();
    }
  }

  async processQueue() {
    this.processing = true;

    while (true) {
      // Use Temporal's condition to wait until there's something in the queues to process
      await condition(() => this.signalsQueue.length > 0 || this.queriesQueue.length > 0, '1 minute');

      // Process signals
      while (this.signalsQueue.length > 0) {
        const signal = this.signalsQueue.shift();
        await this.executeSignalHandler(signal!);
      }

      // Process queries
      while (this.queriesQueue.length > 0) {
        const { queryName, args, resolve } = this.queriesQueue.shift()!;
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

  async invokeActivityOnTaskQueue(activityName: string, args: any[], taskQueue?: string): Promise<any> {
    const activityConfig = registry.getAllActivities().find((a) => a.name === activityName && a.taskQueue === taskQueue);

    if (!activityConfig) {
      throw new Error(`Activity ${activityName} not found for task queue: ${taskQueue}`);
    }

    const activityProxy = activityConfig.isLocal
      ? proxyLocalActivities({ taskQueue: taskQueue || 'default', startToCloseTimeout: '1 minute' })
      : proxyActivities({ taskQueue: taskQueue || 'default', startToCloseTimeout: '1 minute' });

    return await activityProxy[activityName](...args);
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
      const { name, taskQueue, needs = [], provides = [], result, handler } = statement.execute;

      const resolvedArgs = needs.map((path) => this.schemaManager.getState(path));

      // If a custom handler is defined, create a new function dynamically
      if (handler) {
        const handlerFn = new Function('args', 'bindings', handler).bind(this);
        try {
          const handlerResult = await handlerFn(resolvedArgs, bindings);

          // If 'provides' paths are defined, set the result in state using SchemaManager
          provides.forEach((path, index) => {
            this.schemaManager.dispatch({ type: 'UPDATE_ENTITY', entityName: path, entity: handlerResult[index] });
          });

          // If a 'result' key is defined, store the handler's output
          if (result) {
            this.schemaManager.dispatch({ type: 'UPDATE_ENTITY', entityName: result, entity: handlerResult });
          }
        } catch (error) {
          console.error(`Error executing handler for ${name}:`, error);
        }
      } else {
        // Use proxy activities to invoke Temporal activities
        console.log(`Executing activity: ${name} on task queue: ${taskQueue || 'default'} with args: ${resolvedArgs}`);
        try {
          const activityResult = await this.invokeActivityOnTaskQueue(name, resolvedArgs, taskQueue);

          // Set the results in the state using SchemaManager
          provides.forEach((path, index) => {
            this.schemaManager.dispatch({ type: 'UPDATE_ENTITY', entityName: path, entity: activityResult[index] });
          });

          // Optionally store the last activity's result in 'result'
          if (result) {
            this.schemaManager.dispatch({ type: 'UPDATE_ENTITY', entityName: result, entity: activityResult });
          }
        } catch (error) {
          console.error(`Error executing activity ${name} on task queue ${taskQueue || 'default'}:`, error);
        }
      }
    }
  }

  async runExecutionLoop() {
    while (true) {
      console.log('Executing workflow root...');
      await this.execute(this.dsl.plan, this.schemaManager.getState()); // Use SchemaManager to get current state

      if (this.shouldContinueAsNew()) {
        await continueAsNew();
      }

      await workflow.sleep('1m');
    }
  }

  shouldContinueAsNew(): boolean {
    return this.schemaManager.getState()['iteration'] >= 100;
  }

  private evaluateVariable(expression: string): any {
    return expression;
  }
}
