import { VALIDATOR_METADATA_KEY } from './metadata';
import { defineMetadata, getOwnMetadata } from '../utils/metadata';

/**
 * Validator decorator for type-safe action validation in StatefulWorkflow.
 * Allows defining validator methods that run before actions are executed.
 *
 * @typeParam T - The type of action this validator validates
 *
 * @example
 * ```typescript
 * class MyWorkflow extends StatefulWorkflow {
 *   @Validator<AddItemAction>('addItem')
 *   protected validateAddItem(action: AddItemAction) {
 *     if (!action.payload.item) {
 *       throw new Error('Item is required');
 *     }
 *   }
 * }
 * ```
 */
export function Validator<T = any>(actionName: string) {
  return (target: any, propertyKey: string) => {
    const validators = { ...(getOwnMetadata(VALIDATOR_METADATA_KEY, target) ?? {}) };
    validators[actionName] = propertyKey;

    defineMetadata(VALIDATOR_METADATA_KEY, validators, target);
  };
}
