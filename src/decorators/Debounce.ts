import { sleep, CancellationScope, isCancellation } from '@temporalio/workflow';

/**
 * Debounce decorator to debounce method calls in Temporal workflows.
 *
 * This decorator uses Temporal's CancellationScope to implement debouncing:
 * - When a decorated method is called multiple times in quick succession, only the last call executes
 * - Previous pending calls are cancelled via CancellationScope
 * - The method execution is protected from cancellation using nonCancellable scope
 *
 * The implementation acts as an async mutex by:
 * - Tracking the current execution via the currentScope variable
 * - Cancelling any in-progress debounce wait period when a new call arrives
 * - Ensuring the actual method execution happens in a non-cancellable context
 * - Properly handling cancellation exceptions
 *
 * @param {number} ms - The debounce time in milliseconds.
 * @returns {MethodDecorator} - The debounce decorator.
 */
export function Debounce(ms: number): MethodDecorator {
  let currentScope: CancellationScope | null = null;

  const executeOriginalMethod = async (originalMethod: Function, args: any[], context: any): Promise<any> => {
    return await CancellationScope.nonCancellable(async () => {
      const result = originalMethod.apply(context, args);
      return result instanceof Promise ? await result : result;
    });
  };

  const debounceMethod = async (originalMethod: Function, args: any[], context: any): Promise<any> => {
    if (currentScope !== null) {
      currentScope.cancel();
    }

    try {
      return await CancellationScope.cancellable(async () => {
        currentScope = CancellationScope.current();
        await sleep(ms);
        const result = await executeOriginalMethod(originalMethod, args, context);
        currentScope = null;
        return result;
      });
    } catch (e) {
      if (!isCancellation(e)) {
        throw e;
      }
    }
  };

  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor): void => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      return await Promise.resolve().then(() => debounceMethod(originalMethod, args, this));
    };
  };
}
