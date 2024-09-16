import 'reflect-metadata';
import { HOOKS_METADATA_KEY } from './metadata';

export const Hook = (options: { before?: string; after?: string } = {}) => {
  return (target: any, propertyKey: string) => {
    // Collect hooks from the prototype chain to include inherited hooks
    const hooks = Reflect.getMetadata(HOOKS_METADATA_KEY, target) || {};

    // Helper function to ensure no duplicate hooks
    const addHook = (hookType: string, methodName: string, position: 'before' | 'after') => {
      hooks[hookType] = hooks[hookType] || { before: [], after: [] };

      if (!hooks[hookType][position].includes(methodName)) {
        hooks[hookType][position].push(methodName);
      }
    };

    if (options.before) {
      addHook(options.before, propertyKey, 'before');
    }

    if (options.after) {
      addHook(options.after, propertyKey, 'after');
    }

    Reflect.defineMetadata(HOOKS_METADATA_KEY, hooks, target);
  };
};
