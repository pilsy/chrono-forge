import { sleep, CancellationScope, isCancellation } from '@temporalio/workflow';

export function Debounce(ms: number): MethodDecorator {
  let currentScope: CancellationScope | null = null;

  const executeOriginalMethod = async (originalMethod: Function, args: any[], context: any): Promise<any> => {
    return await CancellationScope.nonCancellable(async () => {
      return await Promise.resolve().then(() => {
        const result = originalMethod.apply(context, args);
        return result instanceof Promise ? result : result;
      });
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
