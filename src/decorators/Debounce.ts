import { sleep } from '@temporalio/workflow';

export function Debounce(debounceTimeMs: number): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor): void => {
    const originalMethod = descriptor.value;
    let debouncePromise: Promise<any> | undefined = undefined;
    let latestArgs: any[] | null = null;

    descriptor.value = async function (...args: any[]) {
      latestArgs = args;

      if (debouncePromise) {
        return debouncePromise;
      }

      debouncePromise = sleep(debounceTimeMs)
        .then(async () => {
          if (latestArgs) {
            await originalMethod.apply(this, latestArgs);
          }
        })
        .finally(() => {
          debouncePromise = undefined;
        });

      return debouncePromise;
    };
  };
}
