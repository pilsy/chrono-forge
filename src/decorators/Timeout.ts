import { CancellationScope, sleep } from '@temporalio/workflow';

// Timeout decorator that cancels the method if it exceeds the given time limit
function Timeout(ms: number): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor): void => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      return await CancellationScope.cancellable(async () => {
        const timeout = sleep(ms).then(() => {
          throw new Error(`Method ${String(propertyKey)} timed out after ${ms} ms`);
        });

        const method = originalMethod.apply(this, args);

        // Propagate the cancellation from the scope to the method
        // const timeoutPromise = method.finally(() => scope.cancel());
        return await sleep;
        // return await Promise.race([timeoutPromise, timeout]);
      });
    };
  };
}
