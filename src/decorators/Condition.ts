import { condition, CancellationScope } from '@temporalio/workflow';
import type { Duration } from '@temporalio/common';

export const Condition = (conditionFn: () => boolean, timeout?: Duration) => {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      return await CancellationScope.cancellable(async () => {
        if (timeout) {
          await condition(conditionFn, timeout);
        } else {
          await condition(conditionFn);
        }
        return originalMethod.apply(this, args);
      });
    };
  };
};
