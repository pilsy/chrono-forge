import { sleep } from '@temporalio/workflow';

export function OnFailureRetry(retries: number, delayMs: number = 0): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor): void => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          return await originalMethod.apply(this, args);
        } catch (error) {
          if (attempt === retries) {
            throw error;
          }
          if (delayMs > 0) {
            console.log(`Retrying ${String(propertyKey)} in ${delayMs} ms (attempt ${attempt + 1} of ${retries})`);
            await sleep(delayMs);
          }
        }
      }
    };
  };
}
