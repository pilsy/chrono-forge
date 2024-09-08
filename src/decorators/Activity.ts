import { ActivityFunction } from '@temporalio/common';
import { registry } from '../WorkflowRegistry';

export function Activity(name: string, taskQueue: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    if (typeof descriptor.value !== 'function') {
      throw new Error(`@Activity decorator can only be applied to methods.`);
    }

    // Register the remote activity function in the WorkflowRegistry
    registry.registerActivity(name, descriptor.value as ActivityFunction, false, taskQueue);
  };
}
