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
  HOOKS_METADATA_KEY,
  STEP_METADATA_KEY,
  ACTIONS_METADATA_KEY,
  VALIDATOR_METADATA_KEY
} from '../decorators';
import type { ActionOptions } from '../decorators/Action';
import {
  ApplicationFailure,
  CancelledFailure,
  Duration,
  HandlerUnfinishedPolicy,
  TemporalFailure
} from '@temporalio/common';
import { LRUCacheWithDelete } from 'mnemonist';
import { DSLInterpreter, DSLDefinition, DSLGeneration, convertStepsToDSL } from './DSLInterpreter';
import { getMetadata, getOwnMetadata } from '../utils/metadata';

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
   * Activity functions to use with the DSL interpreter.
   * If not provided, will use default activity proxy.
   */
  activities?: Record<string, (...args: string[]) => Promise<string | undefined>>;

  /**
   * 2.0: register the `pause`, `resume` and `cancel` signals. Off by default, because anyone who can signal the
   * workflow could otherwise pause or end it. Calling `this.pause()`, `this.resume()` or `this.cancel()` from the
   * workflow's own code works either way.
   */
  controlSignals?: boolean;

  /**
   * 2.0 (StatefulWorkflow): register the `subscribe` and `unsubscribe` signals. Off by default, because anyone who can
   * signal the workflow could otherwise have it send its state to any workflow ID. Subscriptions made in code
   * (parents and children) work either way.
   */
  subscribeSignals?: boolean;

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
    const { name: optionalName, taskQueue, activities, ...extraOptions } = options || {};
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
      'activities',
      `
      return async function ${workflowName}(...args) {
        const instance = new constructor(args[0], { ...extraOptions, activities });
        
        try {
          instance.workflowType = '${workflowName}';

          await instance.bindEventHandlers();
          await instance.startUp();

          const executionMethod = instance.isContinueable
            ? 'executeWorkflow'
            : 'execute';

          let result;
          try {
            result = await instance[executionMethod](...args);
          } finally {
            try {
              instance.cleanup();
            } catch (cleanupError) {
              workflow.log.error('Error during workflow cleanup: ' + 
                (cleanupError instanceof Error ? cleanupError.message : String(cleanupError)));
            }
          }
          return result;
        } catch (e) {
          // 2.0: cancellation finishes here for every workflow. 1.x waited for status 'cancelled', which only the
          // continueAsNew path ever set, so a cancelled plain workflow never closed.
          if (workflow.isCancellation(e) && instance.status !== 'cancelled') {
            await workflow.CancellationScope.nonCancellable(async () => {
              instance.status = 'cancelling';
              await instance.cancelChildren();
              instance.status = 'cancelled';
            });
          }
          throw e;
        }
      }
    `
    )(workflow, constructor, extraOptions, activities);

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
  protected workflowType!: string;

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
  private _stepsBound = false;
  private _actionsBound = false;

  /**
   * Lifecycle events emitted while the workflow starts. An error in one of their listeners (for example a handler that
   * cannot be bound) fails the workflow instead of being logged and ignored, so a workflow never runs half-configured.
   */
  protected static readonly LIFECYCLE_EVENTS: ReadonlySet<string> = new Set(['setup', 'hooks', 'init']);

  /**
   * What happens when the workflow finishes while an @Action Update is still running. Defaults to Temporal's own
   * default (abandon with a warning); an @Action can set its own with `unfinishedPolicy`.
   */
  protected actionUnfinishedPolicy: HandlerUnfinishedPolicy = HandlerUnfinishedPolicy.WARN_AND_ABANDON;

  @Property()
  protected dsl!: DSLDefinition;

  /**
   * Workflow logging instance provided by Temporal.
   *
   * Provides structured logging with workflow context information automatically included.
   * All log messages are prefixed with workflow class name and workflow ID for easier debugging.
   *
   * Available log levels: debug, info, warn, error, trace
   */
  private createLogger(level: keyof typeof workflow.log) {
    return (message: string, ...args: any[]) =>
      workflow.log[level](`[${this.constructor.name}]:[${workflow.workflowInfo().workflowId}]: ${message}`, ...args);
  }

  protected log = {
    debug: this.createLogger('debug'),
    info: this.createLogger('info'),
    warn: this.createLogger('warn'),
    error: this.createLogger('error'),
    trace: this.createLogger('trace')
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
   * Handlers for workflow steps.
   * Maps step names to their handler functions.
   * Step handlers allow external systems to trigger actions within the workflow.
   */
  protected stepHandlers: Record<string, (...args: string[]) => Promise<string | undefined>> = {};

  @Property()
  protected startDelay: Duration | undefined = undefined;

  /**
   * Determines whether the workflow is a long running continueAsNew type workflow or a short lived one.
   * When true, the workflow will use the continueAsNew mechanism to restart itself with the same parameters
   * when it reaches certain limits (history size, iterations, etc.).
   */
  @Property({ set: false })
  protected isContinueable = false;

  /**
   * Boolean flag indicating if workflow should continue as new immediately.
   * When set to true, the workflow will trigger the continueAsNew mechanism at the end of the current iteration.
   */
  @Property()
  protected continueAsNew = false;

  /**
   * Maximum number of iterations for the workflow.
   * Prevents infinite loops and ensures the workflow history doesn't grow too large.
   *
   * When this limit is reached, the workflow will either continue as new or terminate.
   */
  @Property({ set: false })
  protected maxIterations = 10000;

  /**
   * Maximum number of history size for the workflow represented in bytes.
   * This is used to prevent the workflow history from growing too large.
   *
   * Default is 25MB.
   */
  @Property({ set: false })
  protected maxHistorySize = 26214400;

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
   * Pause workflow execution. 2.0: a signal only when the workflow opts in with @Temporal({ controlSignals: true });
   * calling it from the workflow's own code always works.
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
   * Resume workflow execution. 2.0: a signal only with @Temporal({ controlSignals: true }).
   *
   * When this signal is received, the workflow will:
   * 1. Change its status from 'paused' to 'running'
   * 2. Update the workflow memo with the new status
   * 3. Forward the resume signal to all child workflows
   * 4. Continue processing iterations
   *
   * If the workflow is already running, this signal has no effect.
   */
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
   * Cancel workflow execution. 2.0: a signal only with @Temporal({ controlSignals: true }). The workflow stops before
   * its next step, cancels its children and fails with a CancelledFailure ('Cancelled by the cancel signal'), so the
   * caller never sees a cancelled run as a success. Use Temporal's own cancel (handle.cancel()) for a CANCELLED close.
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

  /** Status values the `cancel` signal or method sets. */
  protected isCancelRequested(): boolean {
    return this.status === 'cancel' || this.status === 'cancelling' || this.status === 'cancelled';
  }

  /**
   * Finish a cancel requested by the `cancel` signal or method: cancel the children, mark the workflow cancelled and
   * fail it with a CancelledFailure. Nothing else runs after it. 1.x returned normally (the run ended COMPLETED), and a
   * continue-as-new workflow ran one more iteration first.
   */
  protected async finishCancel(): Promise<never> {
    await workflow.CancellationScope.nonCancellable(async () => {
      this.status = 'cancelling';
      await this.cancelChildren();
      this.status = 'cancelled';
      workflow.upsertMemo({ status: this.status, lastUpdated: new Date().toISOString() });
    });
    throw new CancelledFailure('Cancelled by the cancel signal');
  }

  /**
   * Wait while the workflow is paused. Returns when it resumes or is cancelled.
   */
  protected async waitWhilePaused(): Promise<void> {
    if (this.status !== 'paused') {
      return;
    }
    await this.emitAsync('paused');
    await this.forwardSignalToChildren('pause');
    await workflow.condition(() => this.status !== 'paused');
  }

  /**
   * Run the start-up events (setup, hooks, init). 2.0: any error in their listeners fails the workflow. A plain Error
   * would otherwise fail only the workflow task, which Temporal retries forever while the workflow stays RUNNING.
   */
  protected async startUp(): Promise<void> {
    try {
      await this.emitAsync('setup');
      await this.emitAsync('hooks');
      await this.emitAsync('init');
    } catch (error) {
      throw toNonRetryableFailure(error, 'WorkflowStartupError');
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

    if (args && typeof args === 'object') {
      // @ts-ignore
      this.status = this.args?.status ?? 'running';
      // @ts-ignore
      this.dsl = this.args?.dsl ?? undefined;
      // @ts-ignore
      this.startDelay = this.args?.startDelay ?? undefined;
    }
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
   * Optional method that can be implemented by subclasses to define custom continue-as-new behavior.
   * If implemented, this method will be called when the workflow reaches its maximum iterations.
   * @returns A promise that resolves when the continue-as-new process is complete.
   */
  protected onContinue?(): Promise<Record<string, unknown>>;

  /**
   * Base method to execute the workflow logic using DSL.
   *
   * This method executes the workflow's DSL definition if one exists.
   * Subclasses can override this method to provide custom logic,
   * and can optionally call super.execute() to run the DSL steps.
   *
   * @param args - Arguments required for execution.
   * @returns {Promise<unknown>} Result of the workflow execution.
   */
  protected interpreter: AsyncGenerator<DSLGeneration, void, unknown> | undefined;
  protected currentGeneration: DSLGeneration | undefined;

  protected async execute(...args: unknown[]): Promise<unknown> {
    if (this.dsl && this.interpreter) {
      try {
        if (this.isContinueable) {
          if (!this.currentGeneration) {
            const next = await this.interpreter.next();
            if (next.done) {
              this.status = 'completed';
              return this.result;
            }
            this.currentGeneration = next.value;
          }

          // Execute the current generation
          const result = await this.currentGeneration.execute();

          // After execution, get the next generation for the next iteration
          const next = await this.interpreter.next();
          if (next.done) {
            this.currentGeneration = undefined;
            this.status = 'completed';
          } else {
            this.currentGeneration = next.value;
          }
          return result;
        } else {
          // For non-continueAsNew workflows, process all generations in a single call
          let result;
          let next;

          // Process all generations until done
          do {
            // Get the next generation if we don't have one
            if (!this.currentGeneration) {
              next = await this.interpreter.next();
              if (next.done) {
                this.status = 'completed';
                return this.result;
              }
              this.currentGeneration = next.value;
            }

            // Execute the current generation
            result = await this.currentGeneration.execute();

            // Get the next generation for the next iteration
            next = await this.interpreter.next();
            if (next.done) {
              this.currentGeneration = undefined;
              this.status = 'completed';
            } else {
              this.currentGeneration = next.value;
            }

            // 2.0: a pause waits here and the next step runs after resume (1.x broke out of the loop, so the run
            // ended COMPLETED with steps skipped); a cancel stops before the next step and fails the run.
            if (this.status === 'paused' && this.currentGeneration) {
              await this.waitWhilePaused();
            }
            if (this.isCancelRequested()) {
              await this.finishCancel();
            }
            if (this.status !== 'running') {
              break;
            }
          } while (this.currentGeneration);

          return result;
        }
      } catch (error) {
        this.log.error(`Error executing generation ${this.currentGeneration?.nodeId}: ${error}`);
        throw error;
      }
    }
    return undefined;
  }

  /**
   * Checks if there are more nodes to execute in the DSL.
   * This is used in the workflow condition to determine if execution should continue.
   *
   * @returns {boolean} True if there is a current generation to execute, false otherwise.
   */
  protected hasDSLNodesToExecute(): boolean {
    return Boolean(this.dsl && this.interpreter && this.currentGeneration);
  }

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
    this.log.trace(`executeWorkflow`);

    if (this.startDelay) await workflow.sleep(this.startDelay);

    try {
      while (this.iteration <= this.maxIterations) {
        if (this.pendingIteration) {
          this.pendingIteration = false;
        }

        await workflow.condition(
          () =>
            (typeof (this as any).condition === 'function' && (this as any).condition()) ||
            this.hasDSLNodesToExecute() ||
            this.pendingIteration ||
            this.pendingUpdate ||
            this.continueAsNew ||
            this.status !== 'running',
          // @ts-ignore
          this.conditionTimeout ?? undefined
        );

        await this.waitWhilePaused();

        if (this.isCancelRequested()) {
          await this.finishCancel();
        }

        this.result = await Promise.resolve().then(() => this.execute());

        if (this.isCancelRequested()) {
          await this.finishCancel();
        }

        if (this.isInTerminalState()) {
          if (this.status !== 'errored') {
            return this.result;
          }
          throw this.result;
        }

        if (
          ++this.iteration >= this.maxIterations ||
          (workflow.workflowInfo().continueAsNewSuggested &&
            workflow.workflowInfo().historySize >= this.maxHistorySize) ||
          this.continueAsNew
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
      workflowType: String(this.workflowType),
      memo: workflow.workflowInfo().memo,
      typedSearchAttributes: workflow.workflowInfo().typedSearchAttributes
    });

    // If onContinue is defined, call it to get custom parameters, otherwise throw error
    if (typeof this.onContinue === 'function') {
      const customArgs = await this.onContinue();
      await continueFn(customArgs || this.args);
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
        await this.cancelChildren();
        this.status = 'cancelled';
      });
      reject(err);
    } else if (!(err instanceof workflow.ContinueAsNew)) {
      this.log.error(`Handling non-cancellation error: ${err?.message} \n ${err.stack}`);
      reject(err);
    }
  }

  /**
   * How long a cancelled workflow waits for its child workflows to close after asking them to cancel.
   */
  protected childCancellationTimeout: Duration = '30 seconds';

  /**
   * Ask every child workflow this workflow started to cancel, then wait (up to `childCancellationTimeout`) for them
   * to close. Children therefore end CANCELLED instead of being terminated by the parent-close policy when this
   * workflow closes. 1.x built the cancel calls but never invoked them.
   */
  protected async cancelChildren(): Promise<void> {
    const handles = Array.from(this.handles.values());
    if (!handles.length) {
      return;
    }
    await Promise.all(
      handles.map(async (handle) => {
        try {
          await workflow.getExternalWorkflowHandle(handle.workflowId).cancel();
        } catch (error) {
          this.log.error(
            `Failed to cancel child workflow ${handle.workflowId}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      })
    );
    await Promise.race([
      Promise.allSettled(handles.map((handle) => handle.result())),
      workflow.sleep(this.childCancellationTimeout)
    ]);
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
        await Promise.resolve().then(() => listener.apply(this, args));
      } catch (error) {
        if (Workflow.LIFECYCLE_EVENTS.has(event)) {
          throw error;
        }
        this.log.error(
          `Error in listener for event '${event}': ${error instanceof Error ? error.message : String(error)}`
        );
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

      // Clear all handler maps
      this.queryHandlers = {};
      this.signalHandlers = {};
      this.stepHandlers = {};

      // Reset the DSL interpreter
      this.interpreter = undefined;
      this.currentGeneration = undefined;

      // Reset binding flags
      this._eventsBound = false;
      this._hooksBound = false;
      this._signalsBound = false;
      this._queriesBound = false;
      this._propertiesBound = false;
      this._stepsBound = false;
      this._actionsBound = false;
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
        workflow.setHandler(workflow.defineSignal(typeof s === 'string' ? s : signalName), setter);
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
    for (const [queryName, queryMethod, options] of queries) {
      if (typeof (this as any)[queryMethod] === 'function') {
        const originalHandler = (this as any)[queryMethod].bind(this);
        const wrappedHandler = (...args: any[]) => {
          try {
            // 2.0: a query only reads. 1.x also emitted an event here, running listeners inside a query.
            this.log.trace(`[QUERY]:(${queryName})`);
            return originalHandler(...args);
          } catch (err) {
            if (options?.onError) {
              try {
                return options.onError(err);
              } catch (errorHandlerErr) {
                this.log.error(`[QUERY]:(${queryName}):error handler threw`, errorHandlerErr);
                throw errorHandlerErr;
              }
            } else {
              this.log.error(`[QUERY]:(${queryName}):error`, err);
              throw err;
            }
          }
        };
        this.queryHandlers[queryName] = wrappedHandler;
        workflow.setHandler(workflow.defineQuery(queryName), wrappedHandler);
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
    for (const [signalName, signalMethod, options] of signals) {
      if (typeof (this as any)[signalMethod] === 'function') {
        const originalHandler = (this as any)[signalMethod].bind(this);
        const wrappedHandler = async (...args: any[]) => {
          try {
            this.log.trace(`[SIGNAL]:(${signalName})`);
            await this.emitAsync(signalName);
            return await originalHandler(...args);
          } catch (err) {
            if (options?.onError) {
              try {
                const result = options.onError(err);
                if (result instanceof Promise) {
                  return await result;
                }
                return result;
              } catch (errorHandlerErr) {
                this.log.error(`[SIGNAL]:(${signalName}):error handler threw`, errorHandlerErr);
                throw errorHandlerErr;
              }
            } else {
              this.log.error(`[SIGNAL]:(${signalName}):error`, err);
              throw err;
            }
          }
        };
        this.signalHandlers[signalName] = wrappedHandler;
        workflow.setHandler(workflow.defineSignal(signalName), wrappedHandler);
      }
    }

    this._signalsBound = true;
  }

  /**
   * Register the `pause`, `resume` and `cancel` signals when the workflow opts in with
   * @Temporal({ controlSignals: true }). 2.0: off by default.
   */
  @On('init')
  protected bindControlSignals() {
    // @ts-ignore
    if (this.options?.controlSignals !== true) {
      return;
    }
    for (const name of ['pause', 'resume', 'cancel'] as const) {
      const handler = async () => {
        this.log.trace(`[SIGNAL]:(${name})`);
        await this.emitAsync(name);
        this[name]();
      };
      this.signalHandlers[name] = handler;
      workflow.setHandler(workflow.defineSignal(name), handler);
    }
  }

  /**
   * Bind step handlers for the workflow.
   *
   * This method finds all methods decorated with @Step and registers them as
   * workflow step handlers. These steps can then be used by the DSL interpreter.
   */
  @On('init')
  protected bindSteps() {
    if (this._stepsBound) {
      return;
    }

    const steps = this.collectMetadata(STEP_METADATA_KEY, this.constructor.prototype);

    if (steps.length) {
      for (const step of steps) {
        if (typeof (this as any)[step.method] === 'function') {
          const handler = (this as any)[step.method].bind(this);
          this.stepHandlers[step.name] = async (...args: string[]): Promise<string | undefined> => {
            return await handler(...args);
          };
        }
      }

      if (!this.dsl) {
        this.dsl = convertStepsToDSL(steps, {}, this);
      }
    }

    this._stepsBound = true;
  }

  /**
   * Bind @Action methods as Temporal Workflow Updates.
   *
   * Each @Action becomes an Update named after the method (or `options.name`). A @Validator for that name runs before
   * the Update is accepted: if it throws, the Update is rejected and nothing is written to the workflow history.
   * Validators must be synchronous, because Temporal ignores a validator's return value: an async validator that
   * rejects would still let the Update through. An async validator therefore fails the workflow when it starts, and
   * a validator that returns a Promise rejects the Update.
   *
   * Actions and validators are collected along the class chain; a subclass's validator for a name wins.
   */
  @On('init')
  protected async bindActions() {
    if (this._actionsBound) {
      return;
    }

    const actions = this.collectMetadata(ACTIONS_METADATA_KEY, this.constructor.prototype) as {
      method: string;
      options?: ActionOptions;
    }[];
    const validators = this.collectValidatorMetadata(this.constructor.prototype);

    // 2.0: a validator must name an action. A misspelt name ('aprove') would otherwise be ignored and the action
    // would run unvalidated.
    const actionNames = new Set(actions.flatMap(({ method, options }) => [options?.name ?? method, method]));
    const orphans = Object.keys(validators).filter((name) => !actionNames.has(name));
    if (orphans.length) {
      const known = Array.from(new Set(actions.map(({ method, options }) => options?.name ?? method)));
      throw ApplicationFailure.nonRetryable(
        `@Validator(${orphans.map((name) => `'${name}'`).join(', ')}) in ${this.constructor.name} names no @Action. ` +
          `Actions: ${known.length ? known.map((name) => `'${name}'`).join(', ') : 'none'}`,
        'InvalidValidator'
      );
    }

    for (const { method, options } of actions) {
      const updateName = options?.name ?? method;
      const handlerOptions: { validator?: (...args: any[]) => void; unfinishedPolicy?: HandlerUnfinishedPolicy } = {
        unfinishedPolicy: options?.unfinishedPolicy ?? this.actionUnfinishedPolicy
      };
      const validatorMethod = validators[updateName] ?? validators[method];
      if (validatorMethod) {
        const validate = (this as any)[validatorMethod];
        if (typeof validate !== 'function') {
          throw ApplicationFailure.nonRetryable(
            `@Validator('${updateName}') names '${validatorMethod}', which is not a method of ${this.constructor.name}`,
            'InvalidValidator'
          );
        }
        if (validate.constructor?.name === 'AsyncFunction') {
          throw ApplicationFailure.nonRetryable(
            `@Validator for '${updateName}' must be synchronous: Temporal ignores a validator's return value, so an ` +
              `async validator that rejects would still accept the Update`,
            'InvalidValidator'
          );
        }
        handlerOptions.validator = (...args: any[]) => {
          const result = validate.apply(this, args);
          if (result && typeof result.then === 'function') {
            // 2.0: handle the Promise first. Left unhandled, its rejection fails the workflow task, the Update is
            // never rejected and the workflow eventually times out.
            Promise.resolve(result).catch(() => undefined);
            throw ApplicationFailure.nonRetryable(
              `Validator for '${updateName}' returned a Promise; validators must be synchronous`,
              'InvalidValidator'
            );
          }
        };
      }
      workflow.setHandler(
        workflow.defineUpdate<any, any[]>(updateName),
        (...args: any[]) => this.runAction(method, ...args),
        handlerOptions
      );
    }

    this._actionsBound = true;
  }

  /**
   * Run an @Action method for its Update. Subclasses can wrap it (StatefulWorkflow waits for state processing).
   */
  protected async runAction(methodName: string, ...args: any[]): Promise<any> {
    try {
      return await (this as any)[methodName].apply(this, args);
    } catch (error) {
      // 2.0: a plain Error fails the Update, not the workflow task. Left as it is, Temporal would retry the task, the
      // caller would hang and the workflow would time out. Temporal failures and cancellation pass through unchanged.
      throw toNonRetryableFailure(error, 'ActionError');
    }
  }

  /** Validator names along the class chain, base class first, so a subclass's validator for an action wins. */
  private collectValidatorMetadata(target: any): Record<string, string> {
    const chain: any[] = [];
    let current = target;
    while (current && current !== Object.prototype) {
      chain.unshift(current);
      current = Object.getPrototypeOf(current);
    }
    return chain.reduce(
      (merged, proto) => ({
        ...merged,
        ...(getOwnMetadata<Record<string, string>>(VALIDATOR_METADATA_KEY, proto) ?? {})
      }),
      {} as Record<string, string>
    );
  }

  @On('init')
  protected initDSL() {
    if (this.dsl && !this.interpreter) {
      // 2.0: plans no longer see the workflow instance as a `workflow` variable (1.x exposed its activities, status
      // and handlers to any plan), and code statements run only with @Temporal({ allowDSLCode: true }).
      this.interpreter = DSLInterpreter(
        this.dsl,
        // @ts-ignore
        this.options?.activities,
        this.stepHandlers,
        // @ts-ignore
        { allowCode: this.options?.allowDSLCode === true }
      );
    }
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
  protected collectMetadata(metadataKey: symbol | string, target: any): any[] {
    const collectedMetadata: any[] = [];
    const seen = new Set();

    let currentProto = target;
    while (currentProto && currentProto !== Object.prototype) {
      const metadata = getMetadata(metadataKey, currentProto) ?? [];
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
      const metadata = getOwnMetadata(HOOKS_METADATA_KEY, proto) ?? {};
      for (const key of Object.keys(metadata)) {
        if (!collectedMetadata[key]) {
          collectedMetadata[key] = { before: [], after: [] };
        }
        collectedMetadata[key].before.push(...(metadata[key].before ?? []));
        collectedMetadata[key].after.push(...(metadata[key].after ?? []));
      }
    }

    return collectedMetadata;
  }
}

/**
 * Turn any error into a non-retryable ApplicationFailure, so it fails the workflow (or the Update) instead of the
 * workflow task. Temporal failures, cancellation and continue-as-new pass through unchanged.
 */
export function toNonRetryableFailure(error: unknown, type: string): unknown {
  if (error instanceof TemporalFailure || error instanceof workflow.ContinueAsNew || workflow.isCancellation(error)) {
    return error;
  }
  const cause = error instanceof Error ? error : undefined;
  const message = error instanceof Error ? error.message : String(error);
  const errorType = error instanceof Error && error.name && error.name !== 'Error' ? error.name : type;
  return ApplicationFailure.create({ message, type: errorType, nonRetryable: true, cause });
}
