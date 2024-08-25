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
    if (options.get !== false) {
      const queryName = typeof options.get === 'string' ? options.get : propertyKey;
      Query(queryName)(target, propertyKey);
    }
    if (options.set !== false) {
      const signalName = typeof options.set === 'string' ? options.set : propertyKey;
      Signal(signalName)(target, propertyKey);
    }
  };
};

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
  private signalHandlers: { [key: string]: (args: any) => Promise<void> } = {};
  private queryHandlers: { [key: string]: (...args: any) => any } = {};
  private tracer = trace.getTracer('chrono-forge');
  protected handles: { [workflowId: string]: ReturnType<typeof workflow.getExternalWorkflowHandle> | workflow.ChildWorkflowHandle<any> } = {};
  protected log = log;

  @Property({ set: false })
  protected continueAsNew = false;

  @Property()
  protected steps: { name: string; method: string; on?: () => boolean; before?: string | string[]; after?: string | string[] }[] = [];

  @Property({ set: false })
  protected iteration = 0;

  @Property({ set: false })
  protected MAX_ITERATIONS = 10000;

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
    this.bind();
  }

  protected abstract condition(): boolean | Promise<boolean>;
  protected abstract execute(...args: unknown[]): Promise<unknown>;

  public async signal(signalName: string, ...args: unknown[]): Promise<void> {
    if (this.signalHandlers[signalName]) { // @ts-ignore
      await this.signalHandlers[signalName](...args);
      await this.emitAsync(signalName, ...args);
    } else {
      throw new Error(`Signal ${signalName} is not defined on this workflow`);
    }
  }

  public async query(queryName: string, ...args: unknown[]): Promise<any> {
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

        while (this.iteration <= this.MAX_ITERATIONS && !this.isInTerminalState()) {
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

          if (++this.iteration >= this.MAX_ITERATIONS) {
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

  private async executeStep(step: { name: string, method: string }) {
    const stepMethod = (this as any)[step.method].bind(this);
    if (typeof stepMethod === 'function') {
      await stepMethod();
    }
  }

  private async executeSteps() {
    const stepsToExecute = this.steps.filter(step => !step.before);
    for (const step of stepsToExecute) {
      if (!step.on || (await step.on())) {
        await this.executeStep(step);
        await this.processDependentSteps(step.name);
      }
    }
  }

  private async processDependentSteps(stepName: string) {
    const dependentSteps = this.steps.filter(step => step.before && step.before.includes(stepName));
    for (const step of dependentSteps) {
      if (!step.on || (await step.on())) {
        await this.executeStep(step);
        await this.processDependentSteps(step.name);
      }
    }
  }

  protected async awaitCondition(): Promise<any> {
    if (typeof this.condition === 'function') {
      return await this.condition();
    } else {
      return await workflow.condition(() => this.pendingUpdate || this.status !== 'running');
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
          } catch (error) {
            console.error(error);
          }
        }
        throw err;
      });
    } else {
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      throw err;
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

  private bind() {
    const proto = Object.getPrototypeOf(this);

    // Bind signals
    const signals = proto.constructor._signals || [];
    signals.forEach(([signalName, signalMethod]: [name: string, method: string]) => {
      this.signalHandlers[signalName] = (this as any)[signalMethod].bind(this);
      workflow.setHandler(workflow.defineSignal(signalName), async (...args: any[]) => { // @ts-ignore
        await this.signalHandlers[signalName](...args);
        this.emit(signalName, ...args);
      });
    });

    // Bind queries
    const queries = proto.constructor._queries || [];
    queries.forEach(([queryName, queryMethod]: [name: string, method: string]) => {
      this.queryHandlers[queryName] = (this as any)[queryMethod].bind(this);
      workflow.setHandler(workflow.defineQuery(queryName), this.queryHandlers[queryName]);
    });

    // Bind hooks
    this.applyHooks(proto.constructor._hooks);

    // Register steps
    this.steps = proto.constructor._steps || [];

    // Bind the event handlers
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
      workflow.log.debug(`[HOOK]:${methodName}`);
      return new Promise(async (resolve, reject) => {
        await this.tracer.startActiveSpan(`Workflow:applyHooks[${methodName}]`, async span => {
          // @ts-ignore
          const { before, after } = hooks[methodName as string];
          span.setAttributes({ methodName, before, after });

          // Run the before hooks
          if (before instanceof Array) {
            for (const beforeHook of before) { // @ts-ignore
              if (typeof this[beforeHook] === "function") {
                workflow.log.debug(`[HOOK]:before(${methodName})`);
                await this.tracer.startActiveSpan(`[HOOK]:before(${methodName})`,
                  async () => await (this as any)[beforeHook](...args)
                );
              }
            }
          }

          workflow.log.debug(`[HOOK]:${methodName}.call()...`);
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
                workflow.log.debug(`[HOOK]:after(${methodName})`);
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

  protected async forwardSignalToChildren(signalName: string, ...args: unknown[]): Promise<void> {
    const childWorkflowHandles = Object.values(this.handles);
    for (const handle of childWorkflowHandles) {
      try {
        await handle.signal(signalName, ...args);
      } catch (err) {
        console.error(`Failed to forward signal '${signalName}' to child workflow:`, err);
      }
    }
  }
}
