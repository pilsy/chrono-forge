import { sleep } from '@temporalio/workflow';

export function Debounce(debounceTimeMs: number): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor): void => {
    const originalMethod = descriptor.value;
    let debouncePromise: Promise<any> | undefined = undefined;
    let lastCallTime: number = 0;

    descriptor.value = async function (...args: any[]) {
      const now = Date.now();
      const timeSinceLastCall = now - lastCallTime;

      if (timeSinceLastCall >= debounceTimeMs) {
        lastCallTime = now;
        return originalMethod.apply(this, args);
      }

      if (debouncePromise) {
        return debouncePromise;
      }

      debouncePromise = sleep(debounceTimeMs - timeSinceLastCall).then(async () => {
        lastCallTime = Date.now();
        debouncePromise = undefined;
        return originalMethod.apply(this, args);
      });

      return debouncePromise;
    };
  };
}
