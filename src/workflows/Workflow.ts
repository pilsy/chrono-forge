import 'reflect-metadata';
import * as workflow from '@temporalio/workflow';
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
import { LRUHandleCache } from '../utils';

/**
 * Options for configuring a ChronoFlow.
 */
export interface ChronoFlowOptions {
  /**
   * The name of the workflow.
   */
  name?: string;

  /**
   * The task queue for the workflow.
   */
  taskQueue?: string;

  /**
   * Additional arbitrary options.
   */
  [key: string]: any;
}

/**
 * ChronoFlow Decorator
 *
 * Transforms a class into a Temporal workflow function.
 * This function creates and assigns named workflow functions
 * for each class extending the Workflow base class, allowing
 * Temporal to register and invoke workflows by name with a clean class-based API.
 *
 * @param options - Configuration options for the workflow.
 */
export function ChronoFlow(options?: ChronoFlowOptions) {
  return function (constructor: any) {
    const { name: optionalName, taskQueue, tracerName = 'temporal_worker', ...extraOptions } = options || {};
    const workflowName: string = optionalName ?? constructor.name;

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
        extraOptions.workflowType = '${workflowName}';
        const instance = new constructor(args[0], extraOptions);

        try {
          await instance.bindEventHandlers();
          await instance.emitAsync('setup');
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

/**
 * Base Workflow class for Temporal workflows.
 *
 * Represents a base class that provides essential infrastructure for creating workflows.
 * Includes mechanisms for handling signals, queries, event handling, and more.
 * Extends the EventEmitter to aid in workflow event management.
 *
 * @template P - Type of input parameters for the workflow constructor.
 * @template O - Type of configuration options for the workflow.
 */
export abstract class Workflow<P = unknown, O = unknown> extends EventEmitter {
  /**
   * Map to keep track of child workflow handles.
   */
  protected handles: LRUHandleCache<workflow.ChildWorkflowHandle<any>> = new LRUHandleCache<
    workflow.ChildWorkflowHandle<any>
  >(2500);

  /**
   * Internal flags used to determine if certain decorators have been bound to this workflow instance.
   */
  private _hooksBound = false;
  protected _eventsBound = false;
  private _signalsBound = false;
  private _queriesBound = false;
  private _propertiesBound = false;

  /**
   * Workflow logging instance provided by Temporal.
   */
  protected log = workflow.log;

  /**
   * Workflow execution result.
   */
  protected result: any;

  /**
   * Handlers for workflow queries.
   */
  protected queryHandlers: { [key: string]: (...args: any[]) => any } = {};

  /**
   * Handlers for workflow signals.
   */
  protected signalHandlers: { [key: string]: (args: any[]) => Promise<void> } = {};

  /**
   * Determines whether the workflow is a long running continueAsNew type workflow or a short lived one.
   */
  @Property({ set: false })
  protected continueAsNew = false;

  /**
   * Boolean flag indicating if workflow should continue as new immediately.
   */
  @Property()
  protected shouldContinueAsNew = false;

  /**
   * Maximum number of iterations for the workflow.
   */
  @Property({ set: false })
  protected maxIterations = 10000;

  /**
   * Current workflow iteration count.
   */
  @Property({ set: false })
  protected iteration = 0;

  /**
   * Boolean flag indicating pending iteration, setting this to true will result in a full execute() loop being run.
   * This is useful if you have made changes and want the state or memo to update, or similar.
   */
  @Property()
  protected pendingIteration: boolean = false;

  /**
   * Current status of the workflow.
   */
  @Property()
  protected status: string = 'running';

  /**
   * Boolean flag indicating a pending update, setting this to true will result in loadData() being called if it is defined.
   */
  @Property()
  protected pendingUpdate = true;

  /**
   * Signal to pause workflow execution.
   */
  @Signal()
  public pause(): void {
    if (this.status !== 'paused') {
      this.log.info(`Pausing...`);
      this.status = 'paused';
      workflow.upsertMemo({
        status: this.status,
        lastUpdated: new Date().toISOString()
      });
      this.forwardSignalToChildren('pause');
    } else {
      this.log.info(`Already paused!`);
    }
  }

  /**
   * Signal to resume workflow execution.
   */
  @Signal()
  public resume(): void {
    if (this.status !== 'running') {
      this.log.info(`Resuming...`);
      this.status = 'running';
      workflow.upsertMemo({
        status: this.status,
        lastUpdated: new Date().toISOString()
      });
      this.forwardSignalToChildren('resume');
    } else {
      this.log.info(`Already running...`);
    }
  }

  /**
   * Signal to cancel workflow execution.
   */
  @Signal()
  public cancel(): void {
    if (this.status !== 'cancelling') {
      this.log.info(`Cancelling...`);
      this.status = 'cancelling';
      workflow.upsertMemo({
        status: this.status,
        lastUpdated: new Date().toISOString()
      });
      this.forwardSignalToChildren('cancel');
    } else {
      this.log.info(`Already cancelling...`);
    }
  }

  /**
   * Basic constructor for Workflow.
   *
   * @param args - Initial parameters for workflow execution.
   * @param options - Configuration options for the workflow.
   */
  constructor(
    protected args: P,
    protected options: O
  ) {
    super();
    this.args = args;
    this.options = options;
  }

  /**
   * Optional duration for condition timeout.
   */
  @Property()
  protected conditionTimeout: Duration | undefined = undefined;

  /**
   * Check if workflow is in a terminal state.
   *
   * @returns {boolean} True if the workflow is in a terminal state, false otherwise.
   */
  protected isInTerminalState(): boolean {
    return ['complete', 'completed', 'cancel', 'cancelling', 'cancelled', 'error', 'erroring', 'errored'].includes(
      this.status
    );
  }

  /**
   * Abstract method to execute the workflow logic.
   *
   * @param args - Arguments required for execution.
   * @returns {Promise<unknown>} Result of the workflow execution.
   */
  protected abstract execute(...args: unknown[]): Promise<unknown>;

  /**
   * Core method to manage workflow execution and its lifecycle.
   *
   * @param args - Arguments passed for workflow execution.
   * @returns {Promise<any>} Result of the workflow processing.
   */
  protected async executeWorkflow(...args: unknown[]): Promise<any> {
    const executeWorkflowLogic = async (resolve: (value: any) => void, reject: (reason?: any) => void) => {
      try {
        while (this.iteration <= this.maxIterations) {
          await workflow.condition(
            () =>
              (typeof (this as any).condition === 'function' && (this as any).condition()) ||
              this.pendingIteration ||
              this.pendingUpdate ||
              this.status !== 'running',
            // @ts-ignore
            !this.conditionTimeout ? undefined : this.conditionTimeout
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
            (workflow.workflowInfo().continueAsNewSuggested && workflow.workflowInfo().historySize >= 41943040) ||
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
    };

    return new Promise(executeWorkflowLogic);
  }

  /**
   * Handle the scenario when maximum iterations are reached.
   *
   * @returns {Promise<void>} Denotes successful handling of max iterations.
   */
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

  /**
   * Generic method to handle errors encountered during workflow execution.
   *
   * @param err - Error encountered.
   * @param reject - Function to call with rejection error.
   * @returns {Promise<void>}
   */
  protected async handleExecutionError(err: any, reject: (err: Error) => void): Promise<void> {
    this.log.debug(`[Workflow]:${this.constructor.name}:handleExecutionError`);
    this.log.error(`Error encountered: ${err?.message}: ${err?.stack}`);

    if (workflow.isCancellation(err)) {
      this.log.debug(`[Workflow]:${this.constructor.name}: Cancelling...`);

      await workflow.CancellationScope.nonCancellable(async () => {
        await Promise.all([
          workflow.condition(() => workflow.allHandlersFinished()),
          ...Array.from(this.handles.values()).map(async (handle: workflow.ChildWorkflowHandle<any>) => {
            try {
              const extHandle = workflow.getExternalWorkflowHandle(handle.workflowId);
              await extHandle.cancel();
            } catch (e) {}
          })
        ]);
        this.status = 'cancelled';
      });
      reject(err);
    } else if (!(err instanceof workflow.ContinueAsNew)) {
      this.log.error(`Handling non-cancellation error: ${err?.message} \n ${err.stack}`);
      reject(err);
    }
  }

  /**
   * Emit events asynchronously to the necessary listeners.
   *
   * @param event - The event to be emitted.
   * @param args - Arguments to pass to the listeners.
   */
  protected async emitAsync(event: string, ...args: any[]): Promise<void> {
    const listeners = this.listeners(event);
    for (const listener of listeners) {
      await (listener as (...args: any[]) => Promise<void>)(...args);
    }
  }

  /**
   * Send a signal to the workflow.
   *
   * @param signalName - The name of the signal.
   * @param args - The arguments associated with the signal.
   */
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

  /**
   * Execute a query over the workflow.
   *
   * @param queryName - Name of the query.
   * @param args - Arguments for the query.
   * @returns {Promise<any>} Result of the query execution.
   */
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

  /**
   * Forward a signal to all child workflows.
   *
   * @param signalName - The name of the signal to be forwarded.
   * @param args - Additional arguments to pass.
   */
  protected async forwardSignalToChildren(signalName: string, ...args: unknown[]): Promise<void> {
    for (const handle of this.handles.values()) {
      try {
        await handle.signal(signalName, ...args);
      } catch (error: any) {
        this.log.error(`Failed to forward signal '${signalName}' to child workflow:`, error);
      }
    }
  }

  protected async bindEventHandlers() {
    if (this._eventsBound) {
      return;
    }

    const eventHandlers = this.collectMetadata(EVENTS_METADATA_KEY, this.constructor.prototype);
    eventHandlers.forEach((handler: { event: string; method: string }) => {
      this.on(handler.event, async (...args: any[]) => {
        const method = this[handler.method as keyof this];
        if (typeof method === 'function') {
          return await method.apply(this, args);
        }
      });
    });

    this._eventsBound = true;
  }

  /**
   * Bind lifecycle hooks to workflow methods.
   */
  @On('hooks')
  private async bindHooks() {
    if (this._hooksBound) {
      return;
    }

    const hooks = this.collectHookMetadata(this.constructor.prototype);
    if (!hooks) return;

    const applyHook = async (methodName: string, originalMethod: () => any, ...args: any[]) => {
      // Create an inner async function to handle asynchronous operations
      const executeHooks = async () => {
        const { before, after } = hooks[methodName] || { before: [], after: [] };

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
          throw err instanceof Error ? err : new Error(err as string);
        }

        if (Array.isArray(after)) {
          for (const afterHook of after) {
            if (typeof (this as any)[afterHook] === 'function') {
              this.log.trace(`[HOOK]:after(${methodName})`);
              await (this as any)[afterHook](...args);
            }
          }
        }

        return result;
      };

      // Use the non-async promise executor and call the async function
      return new Promise((resolve, reject) => {
        executeHooks().then(resolve).catch(reject);
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

  /**
   * Bind property handlers based on metadata.
   */
  @On('init')
  protected async bindProperties() {
    if (this._propertiesBound) {
      return;
    }
    const properties = this.collectMetadata(PROPERTY_METADATA_KEY, this.constructor.prototype);
    properties.forEach(({ propertyKey, get: g, set: s, queryName, signalName }) => {
      if (g) {
        const getter = () => (this as any)[propertyKey];
        this.queryHandlers[queryName] = getter.bind(this);
        // @ts-ignore
        workflow.setHandler(workflow.defineQuery(typeof g === 'string' ? g : queryName), getter);
      }

      if (s) {
        const setter = (value: any) => ((this as any)[propertyKey] = value);
        this.signalHandlers[signalName] = setter.bind(this);
        // @ts-ignore
        workflow.setHandler(workflow.defineSignal(typeof g === 'string' ? s : signalName), setter);
      }
    });
    this._propertiesBound = true;
  }

  /**
   * Bind query handlers for the workflow.
   */
  @On('init')
  protected bindQueries() {
    if (this._queriesBound) {
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

  /**
   * Bind signal handlers for the workflow.
   */
  @On('init')
  protected bindSignals() {
    if (this._signalsBound) {
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

  /**
   * Collect custom metadata for event handlers.
   *
   * @param metadataKey - The metadata key symbol.
   * @param target - The target to collect metadata from.
   * @returns {any[]} The collected metadata.
   */
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

  /**
   * Collect hook metadata for processing lifecycle hooks.
   *
   * @param target - The target prototype.
   * @returns {Object} The collected hook metadata.
   */
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
