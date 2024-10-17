import 'reflect-metadata';
import * as workflow from '@temporalio/workflow';
import { log, CancellationScope } from '@temporalio/workflow';
import EventEmitter from 'eventemitter3';
import {
  Property,
  Signal,
  On,
  PROPERTY_METADATA_KEY,
  QUERY_METADATA_KEY,
  SIGNAL_METADATA_KEY,
  EVENTS_METADATA_KEY,
  HOOKS_METADATA_KEY
} from '../decorators';
import { Duration } from '@temporalio/common';

export interface ChronoFlowOptions {
  name?: string;
  taskQueue?: string;
  [key: string]: any;
}

/**
 * `ChronoFlow` Decorator
 *
 * Decorator to transform a class into a Temporal workflow function. This function dynamically creates and assigns
 * named functions for each workflow class that extends the `Workflow` base class. This ensures that Temporal can
 * register and invoke them by name while providing a clean class-based API for developers.
 *
 * @param options - Configuration options for the workflow.
 */
export function ChronoFlow(options?: ChronoFlowOptions) {
  return function (constructor: any) {
    const { name: optionalName, taskQueue, tracerName = 'temporal_worker', ...extraOptions } = options || {};
    const workflowName = optionalName || constructor.name;

    if (!(constructor.prototype instanceof Workflow)) {
      abstract class DynamicChronoFlow extends Workflow {
        constructor(params: any, options: ChronoFlowOptions = {}) {
          super(params, options);
          Object.assign(this, new constructor(params, options));
        }
      }
      constructor = DynamicChronoFlow;
    }

    const construct = new Function(
      'workflow',
      'constructor',
      'extraOptions',
      `
      return async function ${workflowName}(...args) {
        const instance = new constructor(args[0], extraOptions);

        try {
          await instance.bindEventHandlers();
          await instance.emitAsync('hooks');
          await instance.emitAsync('init');

          const executionMethod = instance.continueAsNew
            ? 'executeWorkflow'
            : 'execute';

          return await instance[executionMethod](...args);
        } catch (e) {
          if (workflow.isCancellation(e)) {
            await workflow.CancellationScope.nonCancellable(async () => {
              await workflow.condition(() => instance.status === 'cancelled');
            });
          }
          throw e;
        }
      }
    `
    )(workflow, constructor, extraOptions);

    return construct;
  };
}

export abstract class Workflow<P = unknown, O = unknown> extends EventEmitter {
  protected handles: { [workflowId: string]: workflow.ChildWorkflowHandle<any> } = {};

  private _hooksBound = false;
  private _eventsBound = false;
  private _signalsBound = false;
  private _queriesBound = false;
  private _propertiesBound = false;

  protected log = log;
  protected result: any;
  protected queryHandlers: { [key: string]: (...args: any[]) => any } = {};
  protected signalHandlers: { [key: string]: (args: any[]) => Promise<void> } = {};

  @Property({ set: false })
  protected continueAsNew = false;

  @Property()
  protected shouldContinueAsNew = false;

  @Property({ set: false })
  protected maxIterations = 10000;

  @Property({ set: false })
  protected iteration = 0;

  @Property()
  protected pendingIteration: boolean = false;

  @Property()
  protected status: string = 'running';

  @Property()
  protected pendingUpdate = true;

  @Signal()
  public pause(): void {
    if (this.status !== 'paused') {
      this.log.info(`Pausing...`);
      this.status = 'paused';
      this.forwardSignalToChildren('pause');
    } else {
      this.log.info(`Already paused!`);
    }
  }

  @Signal()
  public resume(): void {
    if (this.status !== 'running') {
      this.log.info(`Resuming...`);
      this.status = 'running';
      this.forwardSignalToChildren('resume');
    } else {
      this.log.info(`Already running...`);
    }
  }

  @Signal()
  public cancel(): void {
    if (this.status !== 'cancelling') {
      this.log.info(`Cancelling...`);
      this.status = 'cancelling';
      this.forwardSignalToChildren('cancel');
    } else {
      this.log.info(`Already cancelling...`);
    }
  }

  constructor(
    protected args: P,
    protected options: O
  ) {
    super();
    this.args = args;
    this.options = options;
  }

  @Property()
  protected conditionTimeout: Duration = '1 day';

  protected isInTerminalState(): boolean {
    return ['complete', 'completed', 'cancel', 'cancelling', 'cancelled', 'error', 'erroring', 'errored'].includes(
      this.status
    );
  }

  protected abstract execute(...args: unknown[]): Promise<unknown>;

  protected async executeWorkflow(...args: unknown[]): Promise<any> {
    return new Promise(async (resolve, reject) => {
      try {
        while (this.iteration <= this.maxIterations) {
          await workflow.condition(
            () =>
              (typeof (this as any).condition === 'function' && (this as any).condition()) ||
              this.pendingIteration ||
              this.pendingUpdate ||
              this.status !== 'running',
            this.conditionTimeout
          );

          if (this.status === 'paused') {
            await this.emitAsync('paused');
            await this.forwardSignalToChildren('pause');
            await workflow.condition(() => this.status !== 'paused');
          }

          if (this.status === 'cancelled') {
            break;
          } else {
            this.result = await this.execute();
          }

          if (this.isInTerminalState()) {
            return this.status !== 'errored' ? resolve(this.result) : reject(this.result);
          }

          if (
            ++this.iteration >= this.maxIterations ||
            (workflow.workflowInfo().continueAsNewSuggested && workflow.workflowInfo().historySize >= 20971520) ||
            this.shouldContinueAsNew
          ) {
            await this.handleMaxIterations();
            break;
          }

          if (this.pendingUpdate) {
            this.pendingUpdate = false;
          }

          if (this.pendingIteration) {
            this.pendingIteration = false;
          }
        }

        resolve(this.result);
      } catch (err) {
        await this.handleExecutionError(err, reject);
      }
    });
  }

  protected async handleMaxIterations(): Promise<void> {
    await workflow.condition(() => workflow.allHandlersFinished(), '30 seconds');

    const continueAsNewMethod = (this as any)._continueAsNewMethod;
    if (continueAsNewMethod && typeof (this as any)[continueAsNewMethod] === 'function') {
      return await (this as any)[continueAsNewMethod]();
    } else {
      throw new Error(
        `No method decorated with @ContinueAsNew found in ${this.constructor.name}. Cannot continue as new.`
      );
    }
  }

  protected async handleExecutionError(err: any, reject: (err: Error) => void): Promise<void> {
    this.log.debug(`[Workflow]:${this.constructor.name}:handleExecutionError`);
    this.log.error(`Error encountered: ${err?.message}: ${err?.stack}`);

    if (workflow.isCancellation(err)) {
      this.log.debug(`[Workflow]:${this.constructor.name}: Cancelling...`);

      await workflow.CancellationScope.nonCancellable(async () => {
        await Promise.all([
          workflow.condition(() => workflow.allHandlersFinished()),
          ...Object.values(this.handles).map(async (handle: workflow.ChildWorkflowHandle<any>) => {
            try {
              const extHandle = workflow.getExternalWorkflowHandle(handle.workflowId);
              await extHandle.cancel();
            } catch (e) {}
          })
        ]);
        this.status = 'cancelled';
      });
      reject(err);
    } else {
      this.log.error(`Handling non-cancellation error: ${err?.message} \n ${err.stack}`);
      reject(err);
    }
  }

  protected async emitAsync(event: string, ...args: any[]): Promise<void> {
    const listeners = this.listeners(event);
    for (const listener of listeners) {
      await listener(...args);
    }
  }

  protected async signal(signalName: string, ...args: unknown[]): Promise<void> {
    try {
      if (typeof this.signalHandlers[signalName] === 'function') {
        // @ts-ignore
        await this.signalHandlers[signalName](...args);
        await this.emitAsync(`signal:${signalName}`, ...args);
      }
    } catch (error: any) {
      this.log.error(error);
    }
  }

  protected async query(queryName: string, ...args: unknown[]): Promise<any> {
    let result: any;
    try {
      if (typeof this.queryHandlers[queryName] === 'function') {
        result = await this.queryHandlers[queryName](...args);
      }
    } catch (error: any) {
      this.log.error(error);
    }
    return result;
  }

  protected async forwardSignalToChildren(signalName: string, ...args: unknown[]): Promise<void> {
    const childWorkflowHandles = Object.values(this.handles);
    for (const handle of childWorkflowHandles) {
      try {
        await handle.signal(signalName, ...args);
      } catch (error: any) {
        this.log.error(`Failed to forward signal '${signalName}' to child workflow:`, error);
      }
    }
  }

  private async bindEventHandlers() {
    if (this._eventsBound) {
      return;
    }

    const eventHandlers = this.collectMetadata(EVENTS_METADATA_KEY, this.constructor.prototype);
    eventHandlers.forEach((handler: { event: string; method: string }) => {
      // @ts-ignore
      (/^state/.test(handler.event) ? this.stateManager : this).on(handler.event, async (...args: any[]) => {
        if (typeof (this as any)[handler.method] === 'function') {
          return await (this as any)[handler.method](...args);
        }
      });
    });

    this._eventsBound = true;
  }

  @On('hooks')
  private async bindHooks() {
    if (this._hooksBound) {
      return;
    }

    const hooks = this.collectHookMetadata(this.constructor.prototype);
    if (!hooks) return;

    const applyHook = async (methodName: string, originalMethod: () => any, ...args: any[]) => {
      return new Promise(async (resolve, reject) => {
        const { before, after } = hooks[methodName as string] || { before: [], after: [] };
        if (Array.isArray(before)) {
          for (const beforeHook of before) {
            if (typeof (this as any)[beforeHook] === 'function') {
              this.log.trace(`[HOOK]:before(${methodName})`);
              await (this as any)[beforeHook](...args);
            }
          }
        }

        this.log.info(`[HOOK]:${methodName}.call()...`);
        let result;
        try {
          result = await originalMethod.apply(this, args as any);
        } catch (err) {
          return reject(err);
        }

        if (Array.isArray(after)) {
          for (const afterHook of after) {
            if (typeof (this as any)[afterHook] === 'function') {
              this.log.trace(`[HOOK]:after(${methodName})`);
              await (this as any)[afterHook](...args);
            }
          }
        }

        resolve(result);
      });
    };

    for (const methodName of Object.keys(hooks)) {
      const originalMethod = (this as any)[methodName];
      if (typeof originalMethod === 'function') {
        (this as any)[methodName] = async (...args: any[]) => {
          return await applyHook(methodName, originalMethod, ...args);
        };
      }
    }

    this._hooksBound = true;
  }

  @On('init')
  protected async bindProperties() {
    if (!!this._propertiesBound) {
      return;
    }
    const properties = this.collectMetadata(PROPERTY_METADATA_KEY, this.constructor.prototype);
    properties.forEach(({ propertyKey, get: g, set: s, queryName, signalName }) => {
      if (g) {
        const getter = () => (this as any)[propertyKey];
        this.queryHandlers[queryName] = getter.bind(this);
        // @ts-ignore
        workflow.setHandler(workflow.defineQuery(queryName), getter);
      }

      if (s) {
        const setter = (value: any) => ((this as any)[propertyKey] = value);
        this.signalHandlers[signalName] = setter.bind(this);
        // @ts-ignore
        workflow.setHandler(workflow.defineSignal(signalName), setter);
      }
    });
    this._propertiesBound = true;
  }

  @On('init')
  protected bindQueries() {
    if (!!this._queriesBound) {
      return;
    }
    const queries = this.collectMetadata(QUERY_METADATA_KEY, this.constructor.prototype);
    for (const [queryName, queryMethod] of queries) {
      if (typeof (this as any)[queryMethod] === 'function') {
        const handler = (this as any)[queryMethod].bind(this);
        this.queryHandlers[queryName] = handler;
        workflow.setHandler(workflow.defineQuery(queryName), handler);
      }
    }
    this._queriesBound = true;
  }

  @On('init')
  protected bindSignals() {
    if (!!this._signalsBound) {
      return;
    }
    const signals = this.collectMetadata(SIGNAL_METADATA_KEY, this.constructor.prototype);
    for (const [signalName, signalMethod] of signals) {
      if (typeof (this as any)[signalMethod] === 'function') {
        const handler = (this as any)[signalMethod].bind(this);
        this.signalHandlers[signalName] = handler;
        workflow.setHandler(workflow.defineSignal(signalName), handler);
      }
    }
    this._signalsBound = true;
  }

  protected collectMetadata(metadataKey: Symbol, target: any): any[] {
    const collectedMetadata: any[] = [];
    const seen = new Set();

    let currentProto = target;
    while (currentProto && currentProto !== Object.prototype) {
      const metadata = Reflect.getMetadata(metadataKey, currentProto) || [];
      for (const item of metadata) {
        const itemString = JSON.stringify(item);
        if (!seen.has(itemString)) {
          seen.add(itemString);
          collectedMetadata.push(item);
        }
      }
      currentProto = Object.getPrototypeOf(currentProto);
    }

    return collectedMetadata;
  }

  private collectHookMetadata(target: any): { [key: string]: { before: string[]; after: string[] } } {
    const collectedMetadata: { [key: string]: { before: string[]; after: string[] } } = {};
    const protoChain: any[] = [];

    let currentProto = target;
    while (currentProto && currentProto !== Workflow.prototype) {
      protoChain.unshift(currentProto);
      currentProto = Object.getPrototypeOf(currentProto);
    }

    for (const proto of protoChain) {
      const metadata = Reflect.getOwnMetadata(HOOKS_METADATA_KEY, proto) || {};
      for (const key of Object.keys(metadata)) {
        if (!collectedMetadata[key]) {
          collectedMetadata[key] = { before: [], after: [] };
        }
        collectedMetadata[key].before.push(...(metadata[key].before || []));
        collectedMetadata[key].after.push(...(metadata[key].after || []));
      }
    }

    return collectedMetadata;
  }
}
