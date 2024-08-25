/* eslint-disable no-async-promise-executor */
/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable no-restricted-imports */
import * as workflow from '@temporalio/workflow';
import EventEmitter from 'eventemitter3';
import { trace, context, SpanStatusCode } from '@opentelemetry/api';
import { buildCancelablePromise } from '../../utils/buildCancelablePromise';
import { log } from '@temporalio/workflow';

export const Workflow = (options: { name?: string } = {}) => {
  return (constructor: any) => {
    const workflowName = options.name || constructor.name;
    const tracer = trace.getTracer('temporal-worker');
    
    // Check if the class already extends WorkflowClass
    if (!(constructor.prototype instanceof WorkflowClass)) {
      // Dynamically create a new class that extends WorkflowClass
      abstract class DynamicWorkflowClass extends WorkflowClass {
        constructor(...args: any[]) {
          super(...args);
          Object.assign(this, new constructor(...args)); // Copy properties from original constructor
        }
      }

      constructor = DynamicWorkflowClass;
    }
    
    // Create a named function to serve as the entry point for the workflow
    const workflowFunction = new Function(
      'workflow',
      'constructor',
      `tracer`,
      `SpanStatusCode`,
      `
      return async function ${workflowName}(...args) {
        const instance = new constructor(...args);
        instance.bindQueriesAndSignals();

        return new Promise(async (resolve, reject) => {
          tracer.startActiveSpan("[Workflow]:${workflowName}", async (span) => {
            try {
              const result = await instance.execute(...args);
              span.setStatus({result, code: SpanStatusCode.OK});
              resolve(result);
            } catch (err) {
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: err.message,
              });
              reject(err);
            } finally {
              span.end();
            }
          });
        });
      };
    `
    )(workflow, constructor, tracer, SpanStatusCode);

    return workflowFunction;
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

export const On = (event: string, workflowType?: string, options?: { forwardToChildren?: boolean }) => {
  return (target: any, propertyKey: string) => {
    if (!target.constructor._events) {
      target.constructor._events = [];
    }
    target.constructor._events.push({ event, workflowType, handler: propertyKey, forwardToChildren: options?.forwardToChildren });
  };
};

export abstract class WorkflowClass extends EventEmitter {
  private signalHandlers: { [key: string]: (args: any) => Promise<void> } = {};
  private queryHandlers: { [key: string]: (...args: any) => any } = {};
  protected handles: { [workflowId: string]: ReturnType<typeof workflow.getExternalWorkflowHandle> | workflow.ChildWorkflowHandle<any> } = {};
  protected continueAsNew = false;
  protected log = log;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(...args: unknown[]) {
    super();
  }

  private bindQueriesAndSignals() {
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
  }

  private applyHooks(hooks: {before: {[name: string]: string[]}, after: {[name: string]: string[]}}) {
    if (!hooks) return;

    const applyHook = async (methodName: string, originalMethod: () => any, ...args: any[]) => {
      workflow.log.debug(`[HOOK]:${methodName}`);
      return new Promise(async (resolve, reject) => {
        await trace.getTracer(`temporal-worker`).startActiveSpan(`Workflow:applyHooks[${methodName}]`, async span => {
          // @ts-ignore
          const { before, after } = hooks[methodName as string];
          span.setAttributes({
            methodName,
            before,
            after,
          });
  
          // Run the before hooks
          if (before instanceof Array) {
            for (const beforeHook of before) { // @ts-ignore
              if (typeof this[beforeHook] === "function") {
                workflow.log.debug(`[HOOK]:before(${methodName})`);
                await trace.getTracer('temporal-worker').startActiveSpan(`[HOOK]:before(${methodName})`,
                  async () => await (this as any)[beforeHook](...args)
                );
              }
            }
          }
  
          workflow.log.debug(`[HOOK]:${methodName}.call()...`);
          let result;
          try {
            result = await originalMethod.apply(this, args as any);
          } catch(err) {
            return reject(err);
          }
  
          // Run the after hooks
          if (after instanceof Array) {
            for (const afterHook of after) { // @ts-ignore
              if (typeof this[afterHook] === "function") {
                workflow.log.debug(`[HOOK]:after(${methodName})`);
                await trace.getTracer('temporal-worker').startActiveSpan(`[HOOK]:after(${methodName})`,
                  async () => await (this as any)[afterHook](...args)
                );
              }
            }
          }
  
          resolve(result);
        })
      })

    };

    for (const methodName of Object.keys(hooks)) { // @ts-ignore
      const originalMethod = this[methodName]; // @ts-ignore
      this[methodName] = async (...args: any[]) => { // @ts-ignore
        return await applyHook(methodName, originalMethod, ...args);
      };
    }
  }

  // Methods to signal and query the workflow directly
  public async signal(signalName: string, ...args: unknown[]): Promise<void> {
    if (this.signalHandlers[signalName]) { // @ts-ignore
      await this.signalHandlers[signalName](...args);
      this.emit(signalName, ...args);
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

  // Developers can override this method to implement their specific logic
  protected abstract execute(...args: unknown[]): Promise<unknown>;
}
