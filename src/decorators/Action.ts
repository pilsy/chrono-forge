import 'reflect-metadata';
import { ACTIONS_METADATA_KEY } from './metadata';

export interface ActionOptions<TInput = any, TOutput = any> {
  blocking?: boolean;
  inputType?: TInput;
  outputType?: TOutput;
}

/**
 * @Action Decorator
 *
 * A decorator that marks a class method as an action handler in a StatefulWorkflow.
 * Actions represent discrete operations that can modify the workflow's state in a
 * controlled and traceable manner.
 *
 * @typeParam TAction - The type of action this handler processes
 * @typeParam TReturn - The return type of the action handler
 *
 * @example
 * ```typescript
 * class MyWorkflow extends StatefulWorkflow {
 *   @Action<AddItemAction, Item>()
 *   protected async addItem(action: AddItemAction): Promise<Item> {
 *     // Handle adding item
 *     return newItem;
 *   }
 * }
 * ```
 *
 * Features:
 * - Type-safe action handling with action-specific payloads
 * - Automatic action tracking and state management
 * - Integration with workflow state updates
 * - Support for async operations
 *
 * Common Use Cases:
 * 1. CRUD operations on workflow entities
 * 2. State transitions
 * 3. Complex business logic that needs to modify workflow state
 * 4. Operations that need to be tracked or logged
 *
 * Notes:
 * - Action methods should be protected or private
 * - Actions should be idempotent when possible
 * - Actions can interact with other workflow components like Properties and ManagedPaths
 * - Actions can trigger state updates that propagate to persistent storage
 *
 * @see StatefulWorkflow
 * @see Property
 * @see ManagedPaths
 */
export function Action<TInput, TOutput>(options?: ActionOptions<TInput, TOutput>) {
  return (target: any, propertyKey: string) => {
    const actions = Reflect.getMetadata(ACTIONS_METADATA_KEY, target) || [];
    actions.push({
      method: propertyKey,
      options: options || {}
    });
    Reflect.defineMetadata(ACTIONS_METADATA_KEY, actions, target);
  };
}
