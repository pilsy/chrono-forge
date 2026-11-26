import { ApplicationFailure } from '@temporalio/common';

export function Guard(checkFunction: (...args: any[]) => boolean | Promise<boolean>): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor): void => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const canExecute = await checkFunction.apply(this, args);
      if (!canExecute) {
        // 2.0: a workflow failure the caller can catch. A plain Error would fail the workflow task and retry forever.
        throw ApplicationFailure.create({
          type: 'GuardFailed',
          message: `Guard check failed for method ${String(propertyKey)}`,
          nonRetryable: true
        });
      }
      return originalMethod.apply(this, args);
    };
  };
}
