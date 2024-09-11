/* eslint-disable no-async-promise-executor */
/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable no-restricted-imports */
import * as workflow from '@temporalio/workflow';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { log } from '@temporalio/workflow';
import EventEmitter from 'eventemitter3';
import { get } from 'dottie';
import { registry } from '../WorkflowRegistry';
import * from '../decorators';

/**
 * `Workflow` Class
 *
 * This class serves as the base class for defining Temporal workflows. It provides a rich set of features,
 * including signal and query handling, dynamic function execution, and seamless integration with Temporal's
 * state management and child workflow orchestration.
 *
 * **Why Dynamic Function Assignment is Used:**
 * Temporal workflows require named functions to register and execute workflows. Temporal does not natively
 * recognize class constructors or instance methods as workflows. Instead, it relies on named functions that
 * are callable within its environment.
 *
 * To bridge this gap, the `ChronoFlow` decorator dynamically generates and assigns named functions for each
 * workflow class that extends this `Workflow` base class. This is accomplished using the JavaScript `Function`
 * constructor, allowing the creation of functions with specific names derived from the class name. These
 * dynamically created functions act as wrappers around the workflow class instances, ensuring that Temporal
 * can register and invoke them by name.
 *
 * This approach allows developers to work with class-based workflows while still adhering to Temporal's requirement
 * for named functions. It provides the flexibility of object-oriented programming and the power of Temporal's
 * workflow orchestration, without compromising on the underlying system's requirements.
 *
 * **Benefits of This Approach:**
 * - Enables Temporal to recognize and register class-based workflows.
 * - Provides a clean and intuitive way to define workflows using TypeScript/JavaScript classes.
 * - Supports advanced features such as signal handling, query execution, and continuation with dynamic function names.
 *
 * **Considerations:**
 * - While this approach enables class-based workflows, it requires careful handling of function binding and context
 *   (`this`) management. Developers extending this class must ensure that all signal, query, and method bindings are
 *   correctly implemented to avoid runtime errors.
 * - Extensive comments and documentation are provided to help understand the internal workings and customization points.
 *
 * Overall, this design choice is a balance between Temporal's system requirements and the flexibility of
 * modern JavaScript/TypeScript programming practices.
 */

export interface ChronoFlowOptions {
  name?: string;
  taskQueue?: string;
  [key: string]: any;
}

export function ChronoFlow(options?: ChronoFlowOptions) {
  return function (constructor: any) {
    const { name: optionalName, taskQueue, ...extraOptions } = options || {};
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
      'tracer',
      `
      return async function ${workflowName}(...args) {
        return await new Promise((resolve, reject) => {
          tracer.startActiveSpan('[Workflow]:${workflowName}', async (span) => {
            span.setAttributes({ workflowId: workflow.workflowInfo().workflowId, workflowType: workflow.workflowInfo().workflowType });
            try {
              const instance = new constructor(args, extraOptions);
              await instance.bindEventHandlers();
              await instance.emitAsync('hooks');
              await instance.emitAsync('init');
              if (!instance.continueAsNew) {
                instance
                  .execute(...args)
                  .then(resolve)
              } else {
                instance
                  .executeWorkflow(...args)
                  .then(resolve)
              }
            } catch(e) {
              span.recordException(e);
              reject(e);
            } finally {
              span.end();
            }
          });
        });
      };
    `
    )(workflow, constructor, extraOptions, trace.getTracer('temporal_worker'));

    // Register the workflow class in the WorkflowRegistry
    registry.registerWorkflow(workflowName, construct, taskQueue || 'default');

    return construct;
  };
}

export abstract class Workflow extends EventEmitter {
  private _hooksBound = false;
  private _eventsBound = false;
  private _signalsBound = false;
  private _queriesBound = false;
  private _propertiesBound = false;

  protected result: any;
  protected signalHandlers: { [key: string]: (args: any[]) => Promise<void> } = {};
  protected queryHandlers: { [key: string]: (...args: any[]) => any } = {};
  protected tracer = trace.getTracer('temporal_worker');
  protected handles: { [workflowId: string]: ReturnType<typeof workflow.getExternalWorkflowHandle> | workflow.ChildWorkflowHandle<any> } = {};
  protected log = log;

  @Property({ set: false })
  protected continueAsNew = false;

  @Property({ set: false })
  protected maxIterations = 10000;

  @Property({ set: false })
  protected iteration = 0;

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
    }
  }

  @Signal()
  public resume(): void {
    if (this.status !== 'running') {
      this.log.info(`Resuming...`);
      this.status = 'running';
      this.forwardSignalToChildren('resume');
    }
  }

  @Property()
  protected steps: { name: string; method: string; on?: () => boolean; before?: string | string[]; after?: string | string[] }[] = [];

  constructor(
    protected args: any,
    protected options: ChronoFlowOptions
  ) {
    super();
    this.args = args;
    this.options = options;
    this.steps = Object.getPrototypeOf(this).constructor._steps || [];
  }

  protected async condition(): Promise<any> {
    this.log.debug(`[Workflow]:${this.constructor.name}:awaitCondition`);
    return await workflow.condition(() => this.pendingUpdate || this.status !== 'running', '1 day');
  }

  protected abstract execute(...args: unknown[]): Promise<unknown>;

  protected async executeSteps() {
    const stepsToExecute = this.steps.filter((step) => !step.before);
    for (const step of stepsToExecute) {
      if (!step.on || (await step.on())) {
        await this.executeStep(step);
        await this.processDependentSteps(step.name);
      }
    }
  }

  protected async executeStep(step: { name: string; method: string }) {
    const stepMethod = (this as any)[step.method].bind(this);
    if (typeof stepMethod === 'function') {
      await stepMethod();
    }
  }

  protected async processDependentSteps(stepName: string) {
    const dependentSteps = this.steps.filter((step) => step.before && step.before.includes(stepName));
    for (const step of dependentSteps) {
      if (!step.on || (await step.on())) {
        await this.executeStep(step);
        await this.processDependentSteps(step.name);
      }
    }
  }

  // @ts-ignore
  protected async executeWorkflow(...args: unknown[]): Promise<any> {
    return new Promise(async (resolve, reject) => {
      try {
        while (this.iteration <= this.maxIterations && !this.isInTerminalState()) {
          await this.condition();

          if (this.status === 'paused') {
            await this.emitAsync('paused');
            await workflow.condition(() => this.status !== 'paused');
          }

          if (this.status === 'cancelled') {
            break;
          }

          if (!this.isInTerminalState()) this.result = await this.execute();

          if (!this.steps || this.steps.length === 0) {
            if (this.isInTerminalState()) {
              return this.status !== 'errored' ? resolve(this.result) : reject(this.result);
            }
          } else {
            if (!this.isInTerminalState()) {
              await this.executeSteps();
            }
            if (this.isInTerminalState()) {
              return this.status !== 'errored' ? resolve(this.result) : reject(this.result);
            }
          }

          if (++this.iteration >= this.maxIterations) {
            await this.handleMaxIterations();
            resolve('Continued as a new workflow execution...');
          } else {
            this.pendingUpdate = false;
          }
        }

        resolve(this.result);
      } catch (err) {
        await this.handleExecutionError(err, reject);
      }
    });
  }

  protected async handleMaxIterations(): Promise<void> {
    const continueAsNewMethod = (this as any)._continueAsNewMethod;

    if (continueAsNewMethod && typeof (this as any)[continueAsNewMethod] === 'function') {
      return await (this as any)[continueAsNewMethod]();
    } else {
      throw new Error(`No method decorated with @ContinueAsNew found in ${this.constructor.name}. Cannot continue as new.`);
    }
  }

  protected async handleExecutionError(err: any, reject: (err: Error) => void): Promise<void> {
    this.log.debug(`[Workflow]:${this.constructor.name}:handleExecutionError`);
    this.log.error(`${err?.message}: ${err?.stack}`);
    if (workflow.isCancellation(err)) {
      await workflow.CancellationScope.nonCancellable(async () => {
        for (const handle of Object.values(this.handles)) {
          try {
            this.log.debug(`[Workflow]:${this.constructor.name}:handleExecutionError:child.cancel`);
            if ('cancel' in handle && typeof (handle as workflow.ExternalWorkflowHandle).cancel === 'function') {
              this.log.debug(`Cancelling child workflow...`);
              await (handle as workflow.ExternalWorkflowHandle).cancel();
            }
          } catch (error: any) {
            this.log.error(`${error?.message ?? error}`);
          }
        }
        reject(err);
      });
    } else {
      reject(err);
    }
  }

  protected isInTerminalState(): boolean {
    return ['complete', 'cancelled', 'errored'].includes(this.status);
  }

  protected async emitAsync(event: string, ...args: any[]): Promise<void> {
    const listeners = this.listeners(event);
    for (const listener of listeners) {
      await listener(...args);
    }
  }

  protected async signal(signalName: string, ...args: unknown[]): Promise<void> {
    await this.tracer.startActiveSpan(`Workflow:signal.${signalName}`, async (span) => {
      try {
        if (typeof this.signalHandlers[signalName] === 'function') {
          // @ts-ignore
          await this.signalHandlers[signalName](...args);
          await this.emitAsync(`signal:${signalName}`, ...args);
        }
      } catch (error: any) {
        span.recordException(error);
      } finally {
        span.end();
      }
    });
  }

  protected async query(queryName: string, ...args: unknown[]): Promise<any> {
    return await this.tracer.startActiveSpan(`Workflow:query.${queryName}`, async (span) => {
      let result: any;
      try {
        if (typeof this.queryHandlers[queryName] === 'function') {
          result = await this.queryHandlers[queryName](...args);
        }
      } catch (error: any) {
        span.recordException(error);
      } finally {
        span.end();
      }
      return result;
    });
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
    const proto = Object.getPrototypeOf(this);
    if (!!proto._eventsBound) {
      return;
    }
    (proto.constructor._eventHandlers || []).forEach((handler: { event: string; method: string }) => {
      this.on(handler.event, async (...args: any[]) => {
        if (typeof (this as any)[handler.method] === 'function') {
          return await (this as any)[handler.method](...args);
        }
      });
    });
    this._eventsBound = true;
  }

  @On('hooks')
  private async bindHooks() {
    const proto = Object.getPrototypeOf(this);
    if (!!proto._hooksBound) {
      return;
    }
    this._hooksBound = true;

    const hooks: { before: { [name: string]: string[] }; after: { [name: string]: string[] } } = proto.constructor._hooks;
    if (!hooks) return;

    const applyHook = async (methodName: string, originalMethod: () => any, ...args: any[]) => {
      return new Promise(async (resolve, reject) => {
        // @ts-ignore
        await this.tracer.startActiveSpan(`Workflow:applyHooks[${methodName}]`, async (span) => {
          // @ts-ignore
          const { before, after } = hooks[methodName as string];
          span.setAttributes({ methodName, before, after });

          if (before instanceof Array) {
            for (const beforeHook of before) {
              if (typeof (this as any)[beforeHook] === 'function') {
                this.log.debug(`[HOOK]:before(${methodName})`);
                await this.tracer.startActiveSpan(`[HOOK]:before(${methodName})`, async () => await (this as any)[beforeHook](...args));
              }
            }
          }

          this.log.debug(`[HOOK]:${methodName}.call()...`);
          let result;
          try {
            result = await originalMethod.apply(this, args as any);
          } catch (err) {
            return reject(err);
          }

          if (after instanceof Array) {
            for (const afterHook of after) {
              if (typeof (this as any)[afterHook] === 'function') {
                this.log.debug(`[HOOK]:after(${methodName})`);
                await this.tracer.startActiveSpan(`[HOOK]:after(${methodName})`, async () => await (this as any)[afterHook](...args));
              }
            }
          }

          resolve(result);
        });
      });
    };

    for (const methodName of Object.keys(hooks)) {
      const originalMethod = (this as any)[methodName];
      // @ts-ignore
      this[methodName] = async (...args: any[]) => {
        return await applyHook(methodName, originalMethod, ...args);
      };
    }
  }

  @On('init')
  protected async bindProperties() {
    const proto = Object.getPrototypeOf(this);
    if (!!proto._propertiesBound) {
      return;
    }
    (proto.constructor._properties || []).forEach(
      ({
        propertyKey,
        get: g,
        set: s,
        queryName,
        signalName
      }: {
        propertyKey: string;
        get: boolean | string;
        set: boolean | string;
        queryName: string;
        signalName: string;
      }) => {
        if (g) {
          const getter = get(proto, `constructor._getters.${propertyKey}`, () => (this as any)[propertyKey]);
          // @ts-ignore
          this.queryHandlers[propertyKey] = getter.bind(this);
        }

        if (s) {
          const setter = get(proto, `constructor._setters.${propertyKey}`, (value: any) => {
            (this as any)[propertyKey] = value;
          });
          // @ts-ignore
          this.signalHandlers[propertyKey] = setter.bind(this);
        }
      }
    );
    this._propertiesBound = true;
  }

  @On('init')
  protected bindQueries() {
    const proto = Object.getPrototypeOf(this);
    if (!!proto._queriesBound) {
      return;
    }
    (Object.getPrototypeOf(this).constructor._queries || []).forEach(([queryName, queryMethod]: [string, string]) => {
      this.queryHandlers[queryName] =
        queryMethod && typeof (this as any)[queryMethod] === 'function' ? (this as any)[queryMethod]?.bind(this) : this.queryHandlers[queryName];
    });
    for (const [name, method] of Object.entries(this.queryHandlers)) {
      workflow.setHandler(workflow.defineQuery(name), method);
    }
    this._queriesBound = true;
  }

  @On('init')
  protected bindSignals() {
    const proto = Object.getPrototypeOf(this);
    if (!!proto._signalsBound) {
      return;
    }
    (Object.getPrototypeOf(this).constructor._signals || []).forEach(([signalName, signalMethod]: [string, string]) => {
      this.signalHandlers[signalName] = this.signalHandlers[signalName] || (this as any)[signalMethod]?.bind(this);
      workflow.setHandler(workflow.defineSignal(signalName), async (...args: any[]) => {
        await this.emitAsync(signalName, args);
        // @ts-ignore
        return await this.signalHandlers[signalName](...(args as []));
      });
    });
    this._signalsBound = true;
  }
}
