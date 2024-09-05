import { Workflow, workflow } from '@temporalio/workflow';
import EventEmitter from 'eventemitter3';
import { DSLInterpreter } from './DSLInterpreter';

class DynamicExecutionEngine extends EventEmitter {
  private dsl: any;
  private bindings: Record<string, any> = {};
  private queriesQueue: any[] = [];
  private signalsQueue: any[] = [];

  constructor(dsl: any) {
    super();
    this.dsl = dsl;
    this.initialize();
  }

  initialize() {
    Object.keys(this.dsl.variables).forEach((key) => {
      this.bindings[key] = this.evaluateVariable(this.dsl.variables[key]);
    });

    this.on('signal', async (signalName, args) => {
      await this.handleSignal(signalName, args);
    });

    this.on('query', async (queryName, args, resolve) => {
      await this.handleQuery(queryName, args, resolve);
    });
  }

  async handleSignal(signalName: string, args: any[]) {
    if (this.signalsQueue.includes(signalName)) return;
    this.signalsQueue.push(signalName);
    await this.processQueue();
  }

  async handleQuery(queryName: string, args: any[], resolve: Function) {
    if (this.queriesQueue.includes(queryName)) return;
    this.queriesQueue.push({ queryName, args, resolve });
    await this.processQueue();
  }

  async processQueue() {
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
  }

  async execute(statement: any, bindings: Record<string, string | undefined>): Promise<void> {
    if ('parallel' in statement) {
      await Promise.all(statement.parallel.branches.map((el) => this.execute(el, bindings)));
    } else if ('sequence' in statement) {
      for (const el of statement.sequence.elements) {
        await this.execute(el, bindings);
      }
    } else if ('loop' in statement) {
      // Handle loop constructs
      const conditionFn = new Function('bindings', `return ${statement.loop.condition}`);
      while (conditionFn(bindings)) {
        await this.execute(statement.loop.body, bindings);
      }
    } else {
      const activity = statement.activity;
      let args = activity.arguments || [];
      args = args.map((arg) => bindings[arg] ?? arg);
      const activityResult = await acts[activity.name](...args);
      if (activity.result) {
        bindings[activity.result] = activityResult;
      }
    }
  }

  async executeWorkflow() {
    await this.execute(this.dsl.root, this.bindings);
  }

  private evaluateVariable(expression: string): any {
    // Evaluate expressions or fetch initial data for variables
  }
}

// Usage
const engine = new DynamicExecutionEngine(dslDocument);
await engine.executeWorkflow();
