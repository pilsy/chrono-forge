import { sleep, CancellationScope, isCancellation } from '@temporalio/workflow';

export function Debounce(ms: number): MethodDecorator {
  let currentScope: CancellationScope | null = null;

  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor): void => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      if (currentScope !== null) {
        currentScope.cancel();
      }

      try {
        await CancellationScope.cancellable(async () => {
          currentScope = CancellationScope.current();
          await sleep(ms);

          const result = await originalMethod.apply(this, args);
          currentScope = null;
          return result;
        });
      } catch (e) {
        if (!isCancellation(e)) {
          throw e;
        }
      }
    };
  };
}
