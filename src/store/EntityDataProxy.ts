import { StateManager } from './StateManager';
import { SchemaManager } from './SchemaManager';
import { getEntityName } from '../utils';
import { EntityAction, EntityStrategy, updatePartialEntity, deleteEntity, updateEntity } from './entities';

/**
 * EntityDataProxy provides a reactive interface to entity data with automatic state updates
 * and relationship handling.
 */
export class EntityDataProxy {
  // Static cache of proxies to avoid recreating them
  private static readonly proxyCache = new Map<string, EntityDataProxy>();

  // The raw entity data
  private readonly data: any;

  // The StateManager instance that owns this proxy
  private readonly stateManager: StateManager;

  /**
   * Creates a new EntityDataProxy or returns a cached instance
   * @param entityName The entity type name
   * @param entityId The entity ID
   * @param data The entity data
   * @param stateManager The StateManager instance
   * @returns An EntityDataProxy instance
   */
  public static create(entityName: string, entityId: string, data: any, stateManager: StateManager): any {
    const cacheKey = `${entityName}::${entityId}`;

    // Return cached proxy if it exists and the state hasn't changed
    if (this.proxyCache.has(cacheKey)) {
      const cachedProxy = this.proxyCache.get(cacheKey)!;
      if (cachedProxy.data === data) {
        return cachedProxy.proxy;
      }
      this.proxyCache.delete(cacheKey);
    }

    // Create new proxy
    const instance = new EntityDataProxy(entityName, entityId, data, stateManager);
    this.proxyCache.set(cacheKey, instance);
    return instance.proxy;
  }

  /**
   * Clear the proxy cache
   */
  public static clearCache(): void {
    this.proxyCache.clear();
  }

  /**
   * Remove a specific proxy from the cache
   * @param entityName The entity type name
   * @param entityId The entity ID
   */
  public static removeFromCache(entityName: string, entityId: string): void {
    const cacheKey = `${entityName}::${entityId}`;
    if (this.proxyCache.has(cacheKey)) {
      this.proxyCache.delete(cacheKey);
    }
  }

  /**
   * The JavaScript Proxy object that wraps the entity data
   */
  public readonly proxy: any;

  private constructor(
    private readonly entityName: string,
    private readonly entityId: string,
    data: any,
    stateManager: StateManager
  ) {
    this.data = data;
    this.stateManager = stateManager;
    this.proxy = new Proxy(this.data, this.createHandler());
  }

  /**
   * Creates the proxy handler for the entity
   */
  private createHandler(): ProxyHandler<any> {
    return {
      get: (target, prop) => this.handleGet(target, prop),
      set: (target, prop, value) => this.handleSet(target, prop, value)
    };
  }

  /**
   * Handles property access on the proxy
   */
  private handleGet(target: any, prop: string | symbol): any {
    // Handle toJSON specially for serialization
    if (prop === 'toJSON') {
      return () => JSON.parse(JSON.stringify(target));
    }

    const value = target[prop];

    // Handle primitive values directly
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      value === null ||
      value === undefined ||
      typeof value === 'boolean'
    ) {
      return value;
    }

    // Get relationship information from SchemaManager
    const relationships = SchemaManager.relationshipMap[this.entityName];
    const relation = relationships?.[prop as string];

    // Handle arrays
    if (Array.isArray(value)) {
      return this.handleArrayGet(value, prop as string, relation);
    }

    // Handle objects
    if (typeof value === 'object') {
      return this.handleObjectGet(value, prop as string, relation);
    }

    return value;
  }

  /**
   * Handles array property access
   */
  private handleArrayGet(array: any[], propName: string, relation: any): any {
    // Create a proxy for the array that will track modifications
    return new Proxy(array, {
      get: (target, prop) => {
        // Handle standard array properties and methods
        if (prop === 'length' || typeof prop === 'symbol') {
          return target[prop as any];
        }

        // Handle numeric indices
        if (typeof prop === 'number' || !isNaN(Number(prop))) {
          const index = typeof prop === 'number' ? prop : Number(prop);

          // If this is a relationship array, handle ID references
          if (relation && index >= 0 && index < target.length) {
            const item = target[index];
            const relatedEntityName = getEntityName(relation);
            if (typeof item === 'string' || typeof item === 'number') {
              return item;
            } else {
              // Extract the ID from the item using the schema's idAttribute
              const idAttribute = SchemaManager.schemas[relatedEntityName].idAttribute;
              const itemId = typeof idAttribute === 'function' ? idAttribute(item) : item[idAttribute];
              return EntityDataProxy.create(relatedEntityName, itemId, item, this.stateManager);
            }
          }

          return target[prop as any];
        }

        // Handle array modification methods
        if (
          prop === 'push' ||
          prop === 'pop' ||
          prop === 'shift' ||
          prop === 'unshift' ||
          prop === 'splice' ||
          prop === 'sort' ||
          prop === 'reverse'
        ) {
          const method = Array.prototype[prop as any];

          return (...args: any[]) => {
            // Make a copy of the array before modification
            const oldArray = [...array];

            // For relationship arrays, we need to extract IDs from entities
            if (relation && prop === 'push') {
              const relatedEntityName = getEntityName(relation);
              const idAttribute = SchemaManager.schemas[relatedEntityName].idAttribute;

              // Convert entities to IDs before pushing
              const idsToAdd = args.map((item: any) => {
                if (typeof item === 'string' || typeof item === 'number') {
                  return item.toString();
                }
                return typeof idAttribute === 'function' ? idAttribute(item) : item[idAttribute];
              });

              // Call push with the IDs instead of entities
              const result = method.apply(target, idsToAdd);

              // Create a clean array with just IDs for all elements
              const cleanIdArray = target.map((item: any) => {
                if (typeof item === 'string' || typeof item === 'number') {
                  return item.toString();
                }
                return typeof idAttribute === 'function' ? idAttribute(item) : item[idAttribute];
              });

              // Update the entity with the clean ID array
              this.updateEntityField(propName, cleanIdArray);

              return result;
            }

            // For other methods or non-relationship arrays
            const result = method.apply(target, args);

            // For relationship arrays, ensure we're only storing IDs
            if (relation) {
              const relatedEntityName = getEntityName(relation);
              const idAttribute = SchemaManager.schemas[relatedEntityName].idAttribute;

              // Create a new array with just the IDs
              const idArray = target.map((item: any) => {
                if (typeof item === 'string' || typeof item === 'number') {
                  return item.toString();
                }
                return typeof idAttribute === 'function' ? idAttribute(item) : item[idAttribute];
              });

              // Update the entity with just the IDs
              this.updateEntityField(propName, idArray);
            } else {
              // Update the entity with the modified array
              this.updateEntityField(propName, target);
            }

            return result;
          };
        }

        return target[prop as any];
      },

      set: (target, prop, value) => {
        // Handle array element assignments (e.g., arr[0] = 'value')
        if (typeof prop === 'number' || !isNaN(Number(prop))) {
          const oldValue = target[prop as any];

          // For relationship arrays, convert entity to ID
          if (relation && typeof value === 'object' && value !== null) {
            const relatedEntityName = getEntityName(relation);
            const idAttribute = SchemaManager.schemas[relatedEntityName].idAttribute;
            const newId = typeof idAttribute === 'function' ? idAttribute(value) : value[idAttribute];

            if (oldValue !== newId) {
              target[prop as any] = newId;
              this.updateEntityField(propName, target);
            }
          } else if (oldValue !== value) {
            target[prop as any] = value;
            this.updateEntityField(propName, target);
          }

          return true;
        }

        // Handle other property assignments
        target[prop as any] = value;
        return true;
      }
    });
  }

  /**
   * Handles object property access
   */
  private handleObjectGet(obj: any, propName: string, relation: any): any {
    // If this is a relationship object, return a proxy for the related entity
    if (relation) {
      const relatedEntityName = getEntityName(relation);
      const idAttribute = SchemaManager.schemas[relatedEntityName].idAttribute;

      // Get the ID of the related entity
      if (typeof obj === 'string' || typeof obj === 'number') {
        return obj;
      } else {
        // Return a proxy for the related entity
        return EntityDataProxy.create(
          relatedEntityName,
          typeof idAttribute === 'function' ? idAttribute(obj) : obj[idAttribute],
          obj,
          this.stateManager
        );
      }
    }

    // For non-relationship objects, return a nested proxy
    return new Proxy(obj, {
      set: (target, key, value) => {
        if (target[key] === value) {
          return true;
        }

        // Update the local object
        target[key] = value;

        // Update the parent entity
        this.updateEntityField(propName, obj);

        return true;
      },
      get: (target, key) => {
        const value = target[key];

        if (typeof value === 'object' && value !== null) {
          // Recursively wrap nested objects
          return new Proxy(value, {
            set: (nestedTarget, nestedKey, nestedValue) => {
              if (nestedTarget[nestedKey] === nestedValue) {
                return true;
              }

              // Update the local object
              nestedTarget[nestedKey] = nestedValue;

              // Update the parent entity
              this.updateEntityField(propName, obj);

              return true;
            }
          });
        }

        return value;
      }
    });
  }

  /**
   * Handles property assignment on the proxy
   */
  private handleSet(target: any, prop: string | symbol, value: any): boolean {
    const oldValue = target[prop];

    // No change, return early
    if (oldValue === value) {
      return true;
    }

    // Get relationship information
    const relationships = SchemaManager.relationshipMap[this.entityName];
    const relation = relationships?.[prop as string];

    // Process the value based on relationship type
    let processedValue = value;
    let removedEntityIds: string[] = [];
    let addedEntities: any[] = [];

    if (relation) {
      const relatedEntityName = getEntityName(relation);
      const idAttribute = SchemaManager.schemas[relatedEntityName].idAttribute;

      if (Array.isArray(value)) {
        // Handle array relationships
        if (Array.isArray(oldValue)) {
          // Track removed entities
          const oldIds = oldValue.map((item: any) =>
            typeof item === 'string' || typeof item === 'number'
              ? item.toString()
              : typeof idAttribute === 'function'
                ? idAttribute(item)
                : item[idAttribute]
          );

          // Process new values and track added entities
          const newIds: string[] = [];
          addedEntities = value.filter((item: any) => {
            // Skip if it's just an ID reference
            if (typeof item === 'string' || typeof item === 'number') {
              const id = item.toString();
              newIds.push(id);
              return !oldIds.includes(id);
            }

            // It's an entity object
            const id = typeof idAttribute === 'function' ? idAttribute(item) : item[idAttribute];
            newIds.push(id);
            return !oldIds.includes(id) && typeof item === 'object';
          });

          removedEntityIds = oldIds.filter((id: string) => !newIds.includes(id));
        } else {
          // If oldValue wasn't an array, all entities are new
          addedEntities = value.filter((item: any) => typeof item === 'object' && item !== null);
        }

        // Convert array of entities to array of IDs
        processedValue = value.map((item: any) => {
          if (typeof item === 'string' || typeof item === 'number') {
            return item.toString(); // Already an ID
          }
          return typeof idAttribute === 'function' ? idAttribute(item) : item[idAttribute];
        });
      } else if (value && typeof value === 'object') {
        // Handle single entity relationships
        if (oldValue && typeof oldValue !== 'undefined') {
          const oldId =
            typeof oldValue === 'string' || typeof oldValue === 'number'
              ? oldValue.toString()
              : typeof idAttribute === 'function'
                ? idAttribute(oldValue)
                : oldValue[idAttribute];

          const newId = typeof idAttribute === 'function' ? idAttribute(value) : value[idAttribute];

          if (oldId && oldId !== newId) {
            removedEntityIds.push(oldId);
            addedEntities.push(value);
          }
        } else {
          // If there was no previous value, this is a new entity
          addedEntities.push(value);
        }

        // Convert single entity reference to ID
        processedValue = typeof idAttribute === 'function' ? idAttribute(value) : value[idAttribute];
      }
    }

    // Update the local data
    target[prop] = value;

    // Determine update strategy
    let strategy: EntityStrategy = '$merge';
    if (Array.isArray(oldValue)) {
      strategy = Array.isArray(value) ? '$set' : '$push';
    } else if (value === null || value === undefined) {
      strategy = '$unset';
    }

    // Create actions
    const actions: EntityAction[] = [];

    // Add actions for added entities
    if (addedEntities.length > 0 && relation) {
      const relatedEntityName = getEntityName(relation);

      addedEntities.forEach((entity: any) => {
        // Only add if it's a valid entity object
        if (entity && typeof entity === 'object') {
          const idAttribute = SchemaManager.schemas[relatedEntityName].idAttribute;
          const entityId = typeof idAttribute === 'function' ? idAttribute(entity) : entity[idAttribute];

          if (entityId) {
            actions.push(updateEntity(entity, relatedEntityName));
          }
        }
      });
    }

    actions.push(
      updatePartialEntity(
        this.entityName,
        this.entityId,
        {
          [this.entityId]: {
            [prop as string]: relation ? processedValue : JSON.parse(JSON.stringify(processedValue))
          }
        },
        strategy
      )
    );

    // Add deleteEntity actions for removed entities if they're no longer referenced
    if (removedEntityIds.length > 0 && relation) {
      const relatedEntityName = getEntityName(relation);

      removedEntityIds.forEach((entityId: string) => {
        if (
          !this.stateManager.isEntityReferenced(relatedEntityName, entityId, {
            entityName: this.entityName,
            fieldName: prop as string
          })
        ) {
          actions.push(deleteEntity(entityId, relatedEntityName));
        }
      });
    }

    // Dispatch all actions
    this.stateManager.dispatch(actions, false, this.stateManager.instanceId);

    return true;
  }

  /**
   * Updates an entity field in the state
   */
  private updateEntityField(fieldName: string, newValue: any, oldValue?: any): void {
    // Determine update strategy
    let strategy: EntityStrategy = '$merge';

    // Use $set strategy for arrays to ensure complete replacement
    if (Array.isArray(newValue)) {
      strategy = '$set';
    } else if (newValue === null || newValue === undefined) {
      strategy = '$unset';
    }

    // Create the update action
    const action = updatePartialEntity(
      this.entityName,
      this.entityId,
      {
        [this.entityId]: {
          [fieldName]: JSON.parse(JSON.stringify(newValue))
        }
      },
      strategy
    );

    // Dispatch the action
    this.stateManager.dispatch([action], false, this.stateManager.instanceId);
  }
}
