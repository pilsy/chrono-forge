import { sleep } from '@temporalio/workflow';

export function Delay(ms: number): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor): void => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      await sleep(ms);
      return originalMethod.apply(this, args);
    };
  };
}
