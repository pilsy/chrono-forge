import 'reflect-metadata';
import { HOOKS_METADATA_KEY } from './metadata';

/**
 * Decorator that defines a method as a lifecycle hook to be executed before or after another method.
 * Hooks provide a way to inject custom logic at specific points in a workflow's execution without
 * modifying the core method logic.
 *
 * ## Parameters
 * @param options - Configuration object for the hook
 * @param {string} [options.before] - Name of the method this hook should execute before
 * @param {string} [options.after] - Name of the method this hook should execute after
 *
 * ## Features
 * - **Method Interception**: Injects custom logic before or after specific workflow methods
 * - **Cross-Cutting Concerns**: Ideal for logging, monitoring, validation, and resource management
 * - **Multiple Hook Support**: Multiple hooks can be registered for the same target method
 *
 * ## Usage Examples
 *
 * ### Basic Hook
 * ```typescript
 * @Hook({ before: 'execute' })
 * protected async logBeforeExecution(): Promise<void> {
 *   console.log('Before executing main workflow logic...');
 * }
 * ```
 *
 * ### Multiple Hooks
 * ```typescript
 * @Hook({ after: 'execute' })
 * protected async cleanup(): Promise<void> {
 *   await this.releaseResources();
 * }
 *
 * @Hook({ after: 'execute' })
 * protected async audit(): Promise<void> {
 *   await this.logAuditTrail();
 * }
 * ```
 *
 * ## Notes
 * - Keep hooks lightweight to avoid impacting performance
 * - Ensure hooks are idempotent when possible
 * - Use for cross-cutting concerns rather than core business logic
 * - Hooks are executed in the order they are defined
 */
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
