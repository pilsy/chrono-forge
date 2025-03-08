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
import { LRUCacheWithDelete } from 'mnemonist';

/**
 * Options for configuring a Temporal Workflow.
 *
 * This interface defines the configuration options that can be passed to a Temporal workflow
 * when it is created or registered with the Temporal service.
 */
export interface TemporalOptions {
  /**
   * The name of the workflow.
   * If not provided, the class name will be used as the workflow name.
   */
  name?: string;

  /**
   * The task queue for the workflow.
   * Specifies which task queue the workflow should be registered with.
   * Workers listening on this task queue will be able to execute this workflow.
   */
  taskQueue?: string;

  /**
   * Additional arbitrary options.
   * Any other configuration options that might be needed for specific workflow implementations.
   */
  [key: string]: any;
}

/**
 * Temporal Decorator
 *
 * A class decorator that transforms a TypeScript class into a Temporal workflow function.
 *
 * This decorator handles the registration, initialization, and lifecycle management of workflows
 * in the TemporalForge framework.
 *
 * Key Features:
 * - Automatically registers the class as a Temporal workflow
 * - Manages workflow initialization and lifecycle events
 * - Handles workflow naming and task queue assignment
 * - Provides automatic error handling and cancellation support
 * - Supports dynamic class extension for non-Workflow classes
 *
 * The decorator performs the following operations:
 * 1. Ensures the class extends the Workflow base class
 * 2. Sets up workflow metadata and configuration
 * 3. Binds event handlers, hooks, and signals
 * 4. Manages workflow execution flow and error handling
 *
 * @param options - Configuration options for the workflow
 * @returns A class decorator function that transforms the target class into a Temporal workflow
 */
export function Temporal(options?: TemporalOptions) {
  return function (constructor: any) {
    const { name: optionalName, taskQueue, tracerName = 'temporal_worker', ...extraOptions } = options || {};
    const workflowName: string = optionalName ?? constructor.name;

    if (!(constructor.prototype instanceof Workflow)) {
      throw new Error(
        `Workflows must extend the Workflow class, any class that extends Workflow is supported. ${constructor.name} does not extend Workflow.`
      );
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

          let result;
          try {
            result = await instance[executionMethod](...args);
          } finally {
            // Ensure cleanup happens in all cases: success, error, or continueAsNew
            if (typeof instance.cleanup === 'function') {
              try {
                instance.cleanup();
              } catch (cleanupError) {
                workflow.log.error('Error during workflow cleanup: ' + 
                  (cleanupError instanceof Error ? cleanupError.message : String(cleanupError)));
              }
            }
          }
          return result;
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
 * This class implements core Temporal workflow functionality including:
 * - Signal and query handling
 * - Event emission and subscription
 * - Workflow state management
 * - Child workflow management
 * - Execution flow control (pause, resume, cancel)
 * - Continuation (continueAsNew) support
 * - Structured logging
 *
 * @template P - Type of input parameters for the workflow constructor.
 * @template O - Type of configuration options for the workflow.
 */
export abstract class Workflow<P = unknown, O = unknown> extends EventEmitter {
  /**
   * Map to keep track of child workflow handles.
   * Uses LRU cache to efficiently manage a large number of child workflow references
   * without consuming excessive memory.
   */
  protected handles: LRUCacheWithDelete<string, workflow.ChildWorkflowHandle<any>> = new LRUCacheWithDelete(2000);

  /**
   * Internal flags used to determine if certain decorators have been bound to this workflow instance.
   * These flags prevent duplicate binding of handlers during workflow execution.
   */
  protected _eventsBound = false;
  private _hooksBound = false;
  private _signalsBound = false;
  private _queriesBound = false;
  private _propertiesBound = false;

  /**
   * Workflow logging instance provided by Temporal.
   *
   * Provides structured logging with workflow context information automatically included.
   * All log messages are prefixed with workflow class name and workflow ID for easier debugging.
   *
   * Available log levels: debug, info, warn, error, trace
   */
  protected log = {
    debug: (message: string, ...args: any[]) =>
      workflow.log.debug(`[${this.constructor.name}]:[${workflow.workflowInfo().workflowId}]: ${message}`, ...args),
    info: (message: string, ...args: any[]) =>
      workflow.log.info(`[${this.constructor.name}]:[${workflow.workflowInfo().workflowId}]: ${message}`, ...args),
    warn: (message: string, ...args: any[]) =>
      workflow.log.warn(`[${this.constructor.name}]:[${workflow.workflowInfo().workflowId}]: ${message}`, ...args),
    error: (message: string, ...args: any[]) =>
      workflow.log.error(`[${this.constructor.name}]:[${workflow.workflowInfo().workflowId}]: ${message}`, ...args),
    trace: (message: string, ...args: any[]) =>
      workflow.log.trace(`[${this.constructor.name}]:[${workflow.workflowInfo().workflowId}]: ${message}`, ...args)
  };

  /**
   * Workflow execution result.
   * Stores the final result of the workflow execution that will be returned to the caller.
   */
  protected result: any;

  /**
   * Handlers for workflow queries.
   * Maps query names to their handler functions.
   * Query handlers allow external systems to retrieve workflow state without modifying it.
   */
  protected queryHandlers: { [key: string]: (...args: any[]) => any } = {};

  /**
   * Handlers for workflow signals.
   * Maps signal names to their handler functions.
   * Signal handlers allow external systems to trigger actions within the workflow.
   */
  protected signalHandlers: { [key: string]: (args: any[]) => Promise<void> } = {};

  /**
   * Determines whether the workflow is a long running continueAsNew type workflow or a short lived one.
   * When true, the workflow will use the continueAsNew mechanism to restart itself with the same parameters
   * when it reaches certain limits (history size, iterations, etc.).
   */
  @Property({ set: false })
  protected continueAsNew = false;

  /**
   * Boolean flag indicating if workflow should continue as new immediately.
   * When set to true, the workflow will trigger the continueAsNew mechanism at the end of the current iteration.
   */
  @Property()
  protected shouldContinueAsNew = false;

  /**
   * Maximum number of iterations for the workflow.
   * Prevents infinite loops and ensures the workflow history doesn't grow too large.
   * When this limit is reached, the workflow will either continue as new or terminate.
   */
  @Property({ set: false })
  protected maxIterations = 10000;

  /**
   * Current workflow iteration count.
   * Tracks how many times the workflow has executed its main loop.
   */
  @Property({ set: false })
  protected iteration = 0;

  /**
   * Boolean flag indicating pending iteration.
   * Setting this to true will result in a full execute() loop being run.
   * This is useful if you have made changes and want the state or memo to update, or similar.
   */
  @Property()
  protected pendingIteration: boolean = false;

  /**
   * Current status of the workflow.
   * Possible values include: 'running', 'paused', 'cancelling', 'cancelled', 'complete', 'completed', 'error', etc.
   * This status is used to control workflow execution flow and can be queried externally.
   */
  @Property()
  protected status: string = 'running';

  /**
   * Boolean flag indicating a pending update.
   * Setting this to true will result in loadData() being called if it is defined.
   * Useful for triggering data refresh operations within the workflow.
   */
  @Property()
  protected pendingUpdate = true;

  /**
   * Signal to pause workflow execution.
   *
   * When this signal is received, the workflow will:
   * 1. Change its status to 'paused'
   * 2. Update the workflow memo with the new status
   * 3. Forward the pause signal to all child workflows
   * 4. Emit the 'paused' event
   * 5. Wait for a resume signal before continuing execution
   *
   * The workflow will not process any further iterations until resumed.
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
   *
   * When this signal is received, the workflow will:
   * 1. Change its status from 'paused' to 'running'
   * 2. Update the workflow memo with the new status
   * 3. Forward the resume signal to all child workflows
   * 4. Continue processing iterations
   *
   * If the workflow is already running, this signal has no effect.
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
   *
   * When this signal is received, the workflow will:
   * 1. Change its status to 'cancelling'
   * 2. Update the workflow memo with the new status
   * 3. Forward the cancel signal to all child workflows
   * 4. Eventually transition to 'cancelled' state
   *
   * The workflow will terminate after completing any necessary cleanup operations.
   * If the workflow is already cancelling, this signal has no effect.
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
   * Constructor for the Workflow base class.
   *
   * Initializes the workflow with the provided arguments and options.
   * Sets up the basic workflow state and prepares it for execution.
   *
   * @param args - Initial parameters for workflow execution. These parameters define the input data for the workflow.
   * @param options - Configuration options for the workflow. These options control workflow behavior and settings.
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
   *
   * When set, this duration limits how long the workflow will wait for conditions to be met
   * before continuing execution. If not set, the workflow will wait indefinitely.
   */
  @Property()
  protected conditionTimeout: Duration | undefined = undefined;

  /**
   * Check if workflow is in a terminal state.
   *
   * Terminal states indicate that the workflow has finished execution and will not
   * process any more iterations. This includes successful completion, cancellation,
   * and error states.
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
   * This method must be implemented by concrete workflow classes to define the
   * actual business logic of the workflow. It will be called repeatedly during
   * workflow execution until a terminal state is reached or the workflow continues as new.
   *
   * @param args - Arguments required for execution.
   * @returns {Promise<unknown>} Result of the workflow execution.
   */
  protected abstract execute(...args: unknown[]): Promise<unknown>;

  /**
   * Optional method that can be implemented by subclasses to define custom continue-as-new behavior.
   * If implemented, this method will be called when the workflow reaches its maximum iterations.
   * @returns A promise that resolves when the continue-as-new process is complete.
   */
  protected onContinue?(): Promise<void>;

  /**
   * Core method to manage workflow execution and its lifecycle.
   *
   * This method implements the main execution loop of the workflow, handling:
   * - Condition waiting
   * - Pause/resume/cancel signals
   * - Iteration counting
   * - Error handling
   * - ContinueAsNew logic
   * - Terminal state detection
   *
   * @param args - Arguments passed for workflow execution.
   * @returns {Promise<any>} Result of the workflow processing.
   */
  protected async executeWorkflow(...args: unknown[]): Promise<any> {
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
          this.result = await Promise.resolve().then(() => this.execute());
        }

        if (this.isInTerminalState()) {
          if (this.status !== 'errored') {
            return this.result;
          }
          throw this.result;
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

      return this.result;
    } catch (err) {
      await this.handleExecutionError(err, (error) => {
        throw error;
      });
      throw err;
    }
  }

  /**
   * Handle the scenario when maximum iterations are reached.
   *
   * This method is called when the workflow reaches its maximum iteration count
   * or when the history size becomes too large. It manages the continueAsNew process
   * by waiting for all handlers to finish and then calling the appropriate continueAsNew method.
   *
   * @returns {Promise<void>} Resolves when the continueAsNew process is complete.
   * @throws {Error} If no onContinue method is found.
   */
  protected async handleMaxIterations(): Promise<void> {
    await workflow.condition(() => workflow.allHandlersFinished(), '30 seconds');

    const continueFn = workflow.makeContinueAsNewFunc({
      workflowType: String(this.options.workflowType),
      memo: workflow.workflowInfo().memo,
      searchAttributes: workflow.workflowInfo().searchAttributes
    });

    // Default parameters for continue-as-new
    const defaultParams = {
      ...Object.keys(this.params).reduce(
        (params, key: string) => ({
          ...params, // @ts-ignore
          [key]: this[key]
        }),
        {}
      )
    };

    // If onContinue is defined, call it to get custom parameters, otherwise throw error
    if (typeof this.onContinue === 'function') {
      const customParams = await this.onContinue();
      await continueFn(customParams || defaultParams);
    } else {
      throw new Error(`No onContinue method found in ${this.constructor.name}. Cannot continue as new.`);
    }
  }

  /**
   * Handle errors encountered during workflow execution.
   *
   * This method provides centralized error handling for the workflow, with special
   * handling for cancellation errors. For cancellation errors, it ensures all child
   * workflows are also cancelled. For other errors, it logs the error and rejects
   * the workflow promise.
   *
   * @param err - Error encountered during workflow execution.
   * @param reject - Function to call with rejection error to propagate it up the call stack.
   * @returns {Promise<void>} Resolves when error handling is complete.
   */
  protected async handleExecutionError(err: any, reject: (err: Error) => void): Promise<void> {
    this.log.error(`Error encountered: ${err?.message}: ${err?.stack}`);

    if (workflow.isCancellation(err)) {
      this.log.debug(`Cancelling...`);

      await workflow.CancellationScope.nonCancellable(async () => {
        this.status = 'cancelling';
        await Promise.all(
          Array.from(this.handles.values()).flatMap((handles) =>
            Object.values(handles).map((handle) => async () => {
              try {
                const extHandle = workflow.getExternalWorkflowHandle(handle.workflowId);
                await extHandle.cancel();
              } catch (error) {
                this.log.error(`Failed to cancel child workflow:`, error);
              }
            })
          )
        );
        this.status = 'cancelled';
      });
      reject(err);
    } else if (!(err instanceof workflow.ContinueAsNew)) {
      this.log.error(`Handling non-cancellation error: ${err?.message} \n ${err.stack}`);
      reject(err);
    }
  }

  /**
   * Override of EventEmitter's emit method to prevent synchronous event emission.
   *
   * Temporal workflows must be deterministic, so synchronous event emission is not allowed.
   * This method throws an error to remind developers to use emitAsync instead.
   *
   * @param event - The event to emit.
   * @param args - Arguments to pass to the event listeners.
   * @throws {Error} Always throws an error directing the developer to use emitAsync.
   */
  emit<T extends string | symbol>(event: T, ...args: any[]): boolean {
    throw new Error('Workflows need to be deterministic, emitAsync should be used instead!');
  }

  /**
   * Emit events asynchronously to the necessary listeners.
   *
   * This method provides a deterministic way to emit events in Temporal workflows.
   * It ensures that all event listeners are called in sequence and any errors are
   * properly handled without affecting other listeners.
   *
   * @param event - The event to be emitted.
   * @param args - Arguments to pass to the listeners.
   * @returns {Promise<boolean>} True if there were listeners for the event, false otherwise.
   */
  protected async emitAsync(event: string, ...args: any[]): Promise<boolean> {
    const listeners = this.listeners(event);

    for (const listener of listeners) {
      try {
        await Promise.resolve().then(() => listener(...args));
      } catch (error) {
        console.error(`Error in listener for event '${event}':`, error);
      }
    }

    return listeners.length > 0;
  }

  /**
   * Cleans up event listeners and resets binding flags to prevent memory leaks in the shared V8 VM.
   *
   * This method should be called before a workflow completes or during continueAsNew
   * to ensure that event listeners don't persist between workflow executions in the
   * shared VM environment.
   *
   * ## Cleanup actions:
   * - Removes all event listeners from the workflow instance
   * - Resets all binding flags (_eventsBound, _hooksBound, _signalsBound, etc.)
   *
   * @returns {void}
   */
  protected cleanup(): void {
    try {
      this.removeAllListeners();

      this._eventsBound = false;
      this._hooksBound = false;
      this._signalsBound = false;
      this._queriesBound = false;
      this._propertiesBound = false;
    } catch (error) {
      this.log.error(`Error cleaning up event listeners: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Forward a signal to all child workflows.
   *
   * This method sends the specified signal to all child workflows managed by this workflow.
   * It's commonly used to propagate pause, resume, and cancel signals to ensure consistent
   * state across the workflow hierarchy.
   *
   * @param signalName - The name of the signal to be forwarded.
   * @param args - Additional arguments to pass with the signal.
   * @returns {Promise<void>} Resolves when all signals have been sent.
   */
  protected async forwardSignalToChildren(signalName: string, ...args: unknown[]): Promise<void> {
    for (const handle of this.handles.values()) {
      try {
        await Promise.resolve().then(() => handle.signal(signalName, ...args));
      } catch (error: any) {
        this.log.error(`Failed to forward signal '${signalName}' to child workflow:`, error);
      }
    }
  }

  /**
   * Bind event handlers based on metadata.
   *
   * This method uses reflection to find all methods decorated with @On and binds them
   * as event handlers. It ensures that event handlers are only bound once per workflow instance.
   *
   * @returns {Promise<void>} Resolves when all event handlers are bound.
   */
  protected async bindEventHandlers() {
    if (this._eventsBound) {
      return;
    }

    const eventHandlers = this.collectMetadata(EVENTS_METADATA_KEY, this.constructor.prototype);
    eventHandlers.forEach((handler: { event: string; method: string }) => {
      this.on(handler.event, async (...args: any[]) => {
        const method = this[handler.method as keyof this];
        if (typeof method === 'function') {
          await Promise.resolve().then(() => method.apply(this, args));
        }
      });
    });

    this._eventsBound = true;
  }

  /**
   * Bind lifecycle hooks to workflow methods.
   *
   * This method finds all methods with @Before and @After decorators and wraps the
   * target methods to execute the hooks at the appropriate times. It ensures hooks
   * are only bound once per workflow instance.
   *
   * @returns {Promise<void>} Resolves when all hooks are bound.
   */
  @On('hooks')
  private async bindHooks() {
    if (this._hooksBound) {
      return;
    }

    const hooks = this.collectHookMetadata(this.constructor.prototype);
    if (!hooks) return;

    for (const methodName of Object.keys(hooks)) {
      const originalMethod = (this as any)[methodName];
      if (typeof originalMethod === 'function') {
        (this as any)[methodName] = this.createHookedMethod(methodName, originalMethod, hooks[methodName]);
      }
    }

    this._hooksBound = true;
  }

  /**
   * Create a method wrapped with before and after hooks.
   *
   * This helper method creates a new function that wraps the original method with
   * the specified before and after hooks. The hooks are executed in the order they
   * were defined.
   *
   * @param methodName - The name of the method being wrapped.
   * @param originalMethod - The original method implementation.
   * @param hookConfig - Configuration specifying before and after hooks.
   * @returns {Function} A new function that executes the hooks and the original method.
   */
  private createHookedMethod(
    methodName: string,
    originalMethod: (...args: any[]) => any,
    hookConfig: { before: string[]; after: string[] }
  ) {
    return async (...args: any[]) => {
      const { before = [], after = [] } = hookConfig;

      for (const beforeHook of before) {
        if (typeof (this as any)[beforeHook] === 'function') {
          this.log.trace(`[HOOK]:(${beforeHook}):before(${methodName})`);
          await Promise.resolve().then(() => (this as any)[beforeHook].call(this, ...args));
        }
      }

      let result;
      try {
        result = await Promise.resolve().then(() => originalMethod.call(this, ...args));
      } catch (err) {
        throw err instanceof Error ? err : new Error(String(err));
      }

      for (const afterHook of after) {
        if (typeof (this as any)[afterHook] === 'function') {
          this.log.trace(`[HOOK]:(${afterHook}):after(${methodName})`);
          await Promise.resolve().then(() => (this as any)[afterHook].call(this, ...args));
        }
      }

      return result;
    };
  }

  /**
   * Bind property handlers based on metadata.
   *
   * This method finds all properties decorated with @Property and sets up the appropriate
   * query and signal handlers for them. It allows properties to be accessed via queries
   * and modified via signals.
   *
   * @returns {Promise<void>} Resolves when all property handlers are bound.
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
   *
   * This method finds all methods decorated with @Query and registers them as
   * Temporal query handlers. It allows external systems to query the workflow state
   * without modifying it.
   *
   * @returns {Promise<void>} Resolves when all query handlers are bound.
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
   *
   * This method finds all methods decorated with @Signal and registers them as
   * Temporal signal handlers. It allows external systems to trigger actions within
   * the workflow.
   *
   * @returns {Promise<void>} Resolves when all signal handlers are bound.
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
   * Collect custom metadata for decorators.
   *
   * This method traverses the prototype chain to collect all metadata for a specific
   * metadata key. It ensures that metadata from parent classes is properly inherited
   * and that duplicate metadata is filtered out.
   *
   * @param metadataKey - The metadata key symbol to collect.
   * @param target - The target object to collect metadata from.
   * @returns {any[]} The collected metadata as an array.
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
   * This method traverses the prototype chain to collect all hook metadata.
   * It ensures that hooks from parent classes are properly inherited and merged
   * with hooks from child classes.
   *
   * @param target - The target prototype to collect hook metadata from.
   * @returns {Object} An object mapping method names to their before and after hooks.
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
