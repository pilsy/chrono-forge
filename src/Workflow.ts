/* eslint-disable no-async-promise-executor */
/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable no-restricted-imports */
import * as workflow from '@temporalio/workflow';
import EventEmitter from 'eventemitter3';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { log } from '@temporalio/workflow';
import type { Duration } from '@temporalio/common';

export const ChronoFlow = (name: string, options: { [key: string]: any } = {}) => {
  return (constructor: any) => {
    const workflowName = name || constructor.name;

    if (!(constructor.prototype instanceof Workflow)) {
      abstract class DynamicChronoFlow extends Workflow {
        constructor(params: any) {
          super(params, options);
          Object.assign(this, new constructor(params, options));
        }
      }
      constructor = DynamicChronoFlow;
    }

    return new Function(
      'workflow', 'constructor', 'options',
      `
      return async function ${workflowName}(params) {
        const instance = new constructor(params, options);

        return await instance.executeWorkflow();
      };
    `
    )(workflow, constructor, options);
  };
};

export const ContinueAsNew = () => {
  return (target: any, propertyKey: string) => {
    if (!target.constructor.prototype._continueAsNewMethod) {
      target.constructor.prototype._continueAsNewMethod = propertyKey;
    } else {
      throw new Error(`@ContinueAsNew decorator can only be applied to one method in a class. It has already been applied to ${target.constructor.prototype._continueAsNewMethod}.`);
    }
  };
};

export const Signal = (name?: string) => {
  return (target: any, propertyKey: string) => {
    if (!target.constructor._signals) {
      target.constructor._signals = [];
    }
    target.constructor._signals.push([name || propertyKey, propertyKey]);
  };
};

export const Query = (name?: string) => {
  return (target: any, propertyKey: string) => {
    if (!target.constructor._queries) {
      target.constructor._queries = [];
    }
    target.constructor._queries.push([name || propertyKey, propertyKey]);
  };
};

export const Hook = (options: { before?: string; after?: string } = {}) => {
  return (target: any, propertyKey: string) => {
    if (!target.constructor._hooks) {
      target.constructor._hooks = {};
    }
    if (options.before) {
      target.constructor._hooks[options.before] = target.constructor._hooks[options.before] || {
        before: [],
        after: []
      };
      target.constructor._hooks[options.before].before.push(propertyKey);
    }
    if (options.after) {
      target.constructor._hooks[options.after] = target.constructor._hooks[options.after] || {
        before: [],
        after: []
      };
      target.constructor._hooks[options.after].after.push(propertyKey);
    }
  };
};

export const Before = (targetMethod: string) => Hook({ before: targetMethod });
export const After = (targetMethod: string) => Hook({ after: targetMethod });

export const Property = (options: { get?: boolean | string; set?: boolean | string } = {}) => {
  return (target: any, propertyKey: string) => {
    if (!target.constructor._properties) {
      target.constructor._properties = [];
    }

    // Register the property with its associated getter and setter
    target.constructor._properties.push({
      propertyKey,
      get: options.get || options.get === undefined,
      set: options.set || options.set === undefined,
      queryName: `query${capitalize(typeof options.get === 'string' ? options.get : propertyKey)}`,
      signalName: `signal${capitalize(typeof options.set === 'string' ? options.set : propertyKey)}`,
    });
  };
};

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}


export const Condition = (timeout?: string) => {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;
    descriptor.value = async function (...args: any[]) {
      await workflow.condition(() => originalMethod.apply(this, args), timeout as Duration);
    };
  };
};

export const On = (event: string) => {
  return (target: any, propertyKey: string) => {
    if (!target.constructor.prototype._eventHandlers) {
      target.constructor.prototype._eventHandlers = [];
    }
    target.constructor.prototype._eventHandlers.push({ event, method: propertyKey });
  };
};

export const Step = (options: { name?: string; on?: () => boolean; before?: string | string[]; after?: string | string[] } = {}) => {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    const stepName = options.name || propertyKey;
    if (!target.constructor._steps) {
      target.constructor._steps = [];
    }
    target.constructor._steps.push({
      name: stepName,
      method: propertyKey,
      on: options.on,
      before: options.before,
      after: options.after
    });
  };
};

export type WorkflowStatus = 'running' | 'paused' | 'complete' | 'cancelled' | 'errored';

export abstract class Workflow extends EventEmitter {
  protected signalHandlers: { [key: string]: (args: any) => Promise<void> } = {};
  protected queryHandlers: { [key: string]: (...args: any) => any } = {};
  protected tracer = trace.getTracer('temporal-worker');
  protected handles: { [workflowId: string]: ReturnType<typeof workflow.getExternalWorkflowHandle> | workflow.ChildWorkflowHandle<any> } = {};
  protected log = log;

  @Property({ set: false })
  protected continueAsNew = false;

  @Property()
  protected steps: { name: string; method: string; on?: () => boolean; before?: string | string[]; after?: string | string[] }[] = [];

  @Property({ set: false })
  protected iteration = 0;

  @Property({ set: false })
  protected maxIterations = 10000;

  @Property()
  protected status: WorkflowStatus = 'running';

  @Signal()
  public pause(): void {
    this.status = 'paused';
  }

  @Signal()
  public resume(): void {
    this.status = 'running';
  }

  @Property()
  protected pendingUpdate = false;

  constructor(protected params: any, protected options?: { [key: string]: any }) {
    super();
    Object.assign(this, params);
    this.options = options;
    this.bindHooks();
  }

  protected abstract condition(): boolean | Promise<boolean>;
  protected abstract execute(...args: unknown[]): Promise<unknown>;

  protected async signal(signalName: string, ...args: unknown[]): Promise<void> {
    if (this.signalHandlers[signalName]) { // @ts-ignore
      await this.signalHandlers[signalName](...args);
      await this.emitAsync(signalName, ...args);
    } else {
      throw new Error(`Signal ${signalName} is not defined on this workflow`);
    }
  }

  protected async query(queryName: string, ...args: unknown[]): Promise<any> {
    if (this.queryHandlers[queryName]) {
      return await this.queryHandlers[queryName](...args);
    } else {
      throw new Error(`Query ${queryName} is not defined on this workflow`);
    }
  }

  protected async executeWorkflow(): Promise<any> {
    return this.tracer.startActiveSpan(`[Workflow]:${this.constructor.name}`, async (span) => {
      try {
        span.setAttributes({ workflowId: workflow.workflowInfo().workflowId, workflowType: workflow.workflowInfo().workflowType });

        while (this.iteration <= this.maxIterations && !this.isInTerminalState()) {
          await this.awaitCondition();

          if (this.status === 'paused') {
            await this.emitAsync('paused')
            await workflow.condition(() => this.status !== 'paused');
          }

          const result = await this.execute();

          if (!this.steps || this.steps.length === 0) {
            if (this.isInTerminalState()) {
              span.end();
              return result;
            }
          } else {
            await this.executeSteps();
            if (this.isInTerminalState()) {
              span.end();
              return result;
            }
          }

          if (++this.iteration >= this.maxIterations) {
            await this.handleMaxIterations();
          } else {
            this.pendingUpdate = false;
          }
        }
      } catch (err) {
        await this.handleExecutionError(err, span);
      }
      return;
    });
  }

  protected async executeStep(step: { name: string, method: string }) {
    const stepMethod = (this as any)[step.method].bind(this);
    if (typeof stepMethod === 'function') {
      await stepMethod();
    }
  }

  protected async executeSteps() {
    const stepsToExecute = this.steps.filter(step => !step.before);
    for (const step of stepsToExecute) {
      if (!step.on || (await step.on())) {
        await this.executeStep(step);
        await this.processDependentSteps(step.name);
      }
    }
  }

  protected async processDependentSteps(stepName: string) {
    const dependentSteps = this.steps.filter(step => step.before && step.before.includes(stepName));
    for (const step of dependentSteps) {
      if (!step.on || (await step.on())) {
        await this.executeStep(step);
        await this.processDependentSteps(step.name);
      }
    }
  }

  protected async awaitCondition(): Promise<any> {
    this.log.debug(`[Workflow]:${this.constructor.name}:awaitCondition`);
    if (typeof this.condition === 'function') {
      return await this.condition();
    } else {
      return await workflow.condition(() => this.pendingUpdate || this.status !== 'running', "1 day");
    }
  }

  protected async handleMaxIterations(): Promise<void> {
    const continueAsNewMethod = (this as any)._continueAsNewMethod;

    if (continueAsNewMethod && typeof (this as any)[continueAsNewMethod] === 'function') {
      return await (this as any)[continueAsNewMethod]();
    } else {
      throw new Error(`No method decorated with @ContinueAsNew found in ${this.constructor.name}. Cannot continue as new.`);
    }
  }

  protected async handleExecutionError(err: any, span: any): Promise<void> {
    if (workflow.isCancellation(err)) {
      span.setAttribute('cancelled', true);
      await workflow.CancellationScope.nonCancellable(async () => {
        for (const handle of Object.values(this.handles)) {
          try {
            if ('cancel' in handle && typeof (handle as workflow.ExternalWorkflowHandle).cancel === 'function') {
              await (handle as workflow.ExternalWorkflowHandle).cancel();
            }
          } catch (error: any) {
            this.log.error(`${error?.message ?? error}`);
          }
        }
        throw err;
      });
    } else {
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      throw err.message ?? err;
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

  private bindHooks() {
    const proto = Object.getPrototypeOf(this);

    this.applyHooks(proto.constructor._hooks);


    const signals = proto.constructor._signals || [];
    signals.forEach(([signalName, signalMethod]: [name: string, method: string]) => {
      this.signalHandlers[signalName] = (this as any)[signalMethod]?.bind(this);
      workflow.setHandler(workflow.defineSignal(signalName), async (...args: any[]) => { // @ts-ignore
        await this.signalHandlers[signalName](...args);
        this.emit(signalName, ...args);
      });
    });

    const queries = proto.constructor._queries || [];
    queries.forEach(([queryName, queryMethod]: [name: string, method: string]) => {
      this.queryHandlers[queryName] = (this as any)[queryMethod]?.bind(this);
      workflow.setHandler(workflow.defineQuery(queryName), this.queryHandlers[queryName]);
    });

    const properties = proto.constructor._properties || [];
    properties.forEach(({ propertyKey, get, set, queryName, signalName }: { propertyKey: string, get: boolean | string, set: boolean | string, queryName: string, signalName: string }) => {
      if (get) {
        // @ts-ignore
        this.queryHandlers[queryName] = () => this[propertyKey as string];
        workflow.setHandler(workflow.defineQuery(typeof get === "string" ? get : propertyKey), this.queryHandlers[queryName]);
      }

      if (set) {
        // @ts-ignore
        this.signalHandlers[signalName] = (value: any) => {
          // @ts-ignore
          this[propertyKey] = value;
        };
        workflow.setHandler(workflow.defineSignal(typeof set === "string" ? set : propertyKey), async (...args: any[]) => {
          // @ts-ignore
          await this.signalHandlers[signalName as string](...args);
          this.emit(signalName, ...args);
        });
      }
    });

    this.steps = proto.constructor._steps || [];

    const eventHandlers = (this as any)._eventHandlers || [];
    eventHandlers.forEach((handler: { event: string, method: string }) => {
      this.on(handler.event, async (...args: any[]) => {
        if (typeof (this as any)[handler.method] === 'function') {
          await (this as any)[handler.method](...args);
        }
      });
    });
  }

  private applyHooks(hooks: { before: { [name: string]: string[] }, after: { [name: string]: string[] } }) {
    if (!hooks) return;

    const applyHook = async (methodName: string, originalMethod: () => any, ...args: any[]) => {
      this.log.debug(`[HOOK]:${methodName}`);
      return new Promise(async (resolve, reject) => {
        await this.tracer.startActiveSpan(`Workflow:applyHooks[${methodName}]`, async span => {
          // @ts-ignore
          const { before, after } = hooks[methodName as string];
          span.setAttributes({ methodName, before, after });

          // Run the before hooks
          if (before instanceof Array) {
            for (const beforeHook of before) { // @ts-ignore
              if (typeof this[beforeHook] === "function") {
                this.log.debug(`[HOOK]:before(${methodName})`);
                await this.tracer.startActiveSpan(`[HOOK]:before(${methodName})`,
                  async () => await (this as any)[beforeHook](...args)
                );
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

          // Run the after hooks
          if (after instanceof Array) {
            for (const afterHook of after) { // @ts-ignore
              if (typeof this[afterHook] === "function") {
                this.log.debug(`[HOOK]:after(${methodName})`);
                await this.tracer.startActiveSpan(`[HOOK]:after(${methodName})`,
                  async () => await (this as any)[afterHook](...args)
                );
              }
            }
          }

          resolve(result);
        });
      });
    };

    for (const methodName of Object.keys(hooks)) { // @ts-ignore
      const originalMethod = this[methodName]; // @ts-ignore
      this[methodName] = async (...args: any[]) => { // @ts-ignore
        return await applyHook(methodName, originalMethod, ...args);
      };
    }
  }
}
