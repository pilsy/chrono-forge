import { condition } from '@temporalio/workflow';
import type { Duration } from '@temporalio/common';

export const Condition = (timeout?: string) => {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;
    descriptor.value = async function (...args: any[]) {
      return await condition(() => originalMethod.apply(this, args), timeout as Duration);
    };
  };
};
