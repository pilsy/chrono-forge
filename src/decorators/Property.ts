import 'reflect-metadata';
import { PROPERTY_METADATA_KEY, GETTER_METADATA_KEY, SETTER_METADATA_KEY } from './metadata';

export type PropertyOptions = {
  get?: boolean | string;
  set?: boolean | string;
  path?: string;
  memo?: string | boolean;
  option?: string | boolean;
  signalName?: string;
  queryName?: string;
};

/**
 * Decorator that defines and configures a workflow property with optional memoization and signal/query access.
 * Properties decorated with `@Property` are automatically managed by the workflow system, providing
 * features like state persistence, memoization, and signal/query access control.
 *
 * ## Configuration Options
 * @param options - Configuration object for the property
 * @param {boolean} [options.set=true] - Whether to generate a signal handler for setting this property.
 *   When false, no signal will be created to modify this property externally.
 * @param {boolean} [options.get=true] - Whether to generate a query handler for reading this property.
 *   When false, no query will be created to read this property externally.
 * @param {string | boolean} [options.memo=false] - Memoization configuration:
 *   - If string: Uses the provided key for memoization
 *   - If true: Uses the property name as the memoization key
 *   - If false: Disables memoization for this property
 * @param {string} [options.path] - Specifies a path within the workflow's state where this property's
 *   data should be stored/retrieved
 *
 * ## Features
 * - **Signal/Query Control**: Configure whether properties can be modified or read via external signals/queries
 * - **Memoization**: Properties can persist their values across workflow executions
 * - **State Path Mapping**: Properties can be mapped to specific paths in the workflow state
 * - **Automatic State Management**: Changes to properties are automatically tracked and persisted
 *
 * ## Usage Examples
 *
 * ### Basic Property (Accessible via Signals and Queries)
 * ```typescript
 * @Property()
 * protected status: string = 'pending';
 * ```
 *
 * ### Internal-Only Property (No External Access)
 * ```typescript
 * @Property({ set: false, get: false })
 * protected internalState: string;
 * ```
 *
 * ### Read-Only Property (Query Only)
 * ```typescript
 * @Property({ set: false })
 * protected id: string;
 * ```
 *
 * ### Write-Only Property (Signal Only)
 * ```typescript
 * @Property({ get: false })
 * protected secretKey: string;
 * ```
 *
 * ### Memoized Property
 * ```typescript
 * @Property({ memo: 'apiToken', set: false })
 * protected apiToken?: string;
 * ```
 *
 * ### State-Mapped Property
 * ```typescript
 * @Property({ path: 'items' })
 * protected items: Item[];
 * ```
 *
 * ## Behavior
 * - Properties are automatically bound during workflow initialization
 * - When `set: true`, a signal handler is generated to allow external modification of the property
 * - When `get: true`, a query handler is generated to allow external reading of the property
 * - Memoized properties persist their values across workflow executions using Temporal's memo feature
 * - State-mapped properties automatically sync with the specified path in the workflow's state
 *
 * ## Notes
 * - Properties with `set: false` can only be modified internally within the workflow
 * - Properties with `get: false` can only be read internally within the workflow
 * - Memoized properties should be used judiciously as they contribute to the workflow's memory footprint
 *
 * @example
 * ```typescript
 * @Temporal()
 * class OrderWorkflow extends StatefulWorkflow {
 *   // Generates both signal and query handlers
 *   @Property()
 *   protected status: string = 'pending';
 *
 *   // No signal handler - can only be modified internally
 *   @Property({ set: false })
 *   protected readonly orderId: string;
 *
 *   // No query handler - can only be read internally
 *   @Property({ get: false })
 *   protected secretApiKey: string;
 *
 *   // Memoized property with no external setter
 *   @Property({ memo: 'apiToken', set: false })
 *   protected apiToken?: string;
 *
 *   // State-mapped property with full external access
 *   @Property({ path: 'items' })
 *   protected orderItems: OrderItem[];
 * }
 * ```
 */
export const Property = (options: PropertyOptions = {}) => {
  return (target: any, propertyKey: string) => {
    const properties = Reflect.getOwnMetadata(PROPERTY_METADATA_KEY, target) ?? [];
    properties.push({
      propertyKey,
      path: options.path,
      get: options.get || options.get === undefined,
      set: options.set || options.set === undefined,
      queryName: options.queryName ?? propertyKey,
      signalName: options.signalName ?? propertyKey,
      memo: options.memo,
      option: options.option
    });

    Reflect.defineMetadata(PROPERTY_METADATA_KEY, properties, target);

    if (options.get) {
      const getterName = typeof options.get === 'string' ? options.get : propertyKey;
      const getters = Reflect.getOwnMetadata(GETTER_METADATA_KEY, target) ?? {};
      getters[getterName] = propertyKey;
      Reflect.defineMetadata(GETTER_METADATA_KEY, getters, target);
    }

    if (options.set) {
      const setterName = typeof options.set === 'string' ? options.set : propertyKey;
      const setters = Reflect.getOwnMetadata(SETTER_METADATA_KEY, target) ?? {};
      setters[setterName] = propertyKey;
      Reflect.defineMetadata(SETTER_METADATA_KEY, setters, target);
    }
  };
};
