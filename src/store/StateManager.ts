import EventEmitter from 'eventemitter3';
import {
  EntitiesState,
  EntityAction,
  reducer,
  clearEntities,
  updatePartialEntity,
  EntityStrategy,
  deleteEntity
} from '../store/entities';
import { DetailedDiff, detailedDiff } from 'deep-object-diff';
import { isEmpty } from 'lodash';
import { getEntityName, limitRecursion } from '../utils';
import { LRUCacheWithDelete } from 'mnemonist';
import { Relationship, SchemaManager } from './SchemaManager';

/**
 * Represents a queue item containing an entity action and optional origin
 */
export type QueueItem = {
  action: EntityAction;
  origin?: string;
};

/**
 * StateManager class manages application state and entity relationships
 * using a singleton pattern with instance management.
 * Extends EventEmitter to provide state change notifications.
 */
export class StateManager extends EventEmitter {
  /**
   * Gets the instance ID of this StateManager
   */
  get instanceId() {
    return this._instanceId;
  }

  /**
   * Private constructor for singleton pattern
   * @param _instanceId - Unique identifier for this StateManager instance
   */
  private constructor(private readonly _instanceId: string) {
    super();
    this._instanceId = _instanceId;
    this._state = {};
  }

  /**
   * Gets or creates a StateManager instance for the given ID
   * @param instanceId - Unique identifier for the StateManager instance
   * @returns StateManager instance
   * @throws Error if instanceId is not provided
   */
  static getInstance(instanceId: string): StateManager {
    if (!instanceId) {
      throw new Error(`You must provide a instanceId ${instanceId}!`);
    }
    if (!this.instances[instanceId]) {
      this.instances[instanceId] = new StateManager(instanceId);
    }
    return this.instances[instanceId];
  }

  private static instances: { [instanceId: string]: StateManager } = {};

  /**
   * Indicates whether the StateManager is currently processing changes
   */
  private _processing = false;
  get processing() {
    return this._processing;
  }

  /**
   * Gets the current state
   */
  private _state!: EntitiesState;
  get state() {
    return this._state ?? {};
  }

  /**
   * Sets the current state
   */
  set state(state: EntitiesState) {
    this._state = state;
  }

  /**
   * Updates the state and emits change events if necessary
   * @param newState - The new state to set
   */
  private async handleStateChange(newState: EntitiesState, previousState: EntitiesState, origins: Set<string>) {
    const differences = detailedDiff(previousState, newState);
    if (!isEmpty(differences.added) || !isEmpty(differences.updated) || !isEmpty(differences.deleted)) {
      this._state = newState;
      this.proxyCache.clear();
      this.invalidateCache(differences);
      await this.emitStateChangeEvents(differences, previousState, newState, Array.from(origins));
    }
  }

  async setState(newState: EntitiesState) {
    if (this._state === newState) return;
    const previousState = this._state;
    await this.handleStateChange(newState, previousState, new Set([this.instanceId]));
  }

  public readonly cache: LRUCacheWithDelete<string, Record<string, any>> = new LRUCacheWithDelete(10000);

  private readonly proxyCache: Map<string, { data: any; lastState: EntitiesState }> = new Map();
  private readonly _queue: QueueItem[] = [];
  get queue() {
    return this._queue;
  }

  /**
   * Dispatches entity actions either synchronously or asynchronously
   * @param actions - The entity action(s) to dispatch (can be single action or array)
   * @param sync - Whether to process the action(s) immediately
   * @param origin - Optional origin identifier for the action(s)
   */
  async dispatch(actions: EntityAction | EntityAction[], sync = true, origin?: string): Promise<void> {
    const actionArray = Array.isArray(actions) ? actions : [actions];
    const queueItems = actionArray.map((action) => ({ action, origin }));

    if (sync) {
      await this.processChanges(queueItems);
    } else {
      this._queue.push(...queueItems);
    }
  }

  /**
   * Processes queued changes or provided items
   * @param items - Optional array of QueueItems to process
   */
  async processChanges(items?: QueueItem[]): Promise<void> {
    const origins: Set<string> = new Set();
    const pendingChanges = items ?? this._queue;
    const previousState = this._state;

    this._processing = true;

    let newState;
    let itemsProcessed = 0;

    while (pendingChanges.length > 0 && itemsProcessed < 25) {
      const { action, origin }: QueueItem = pendingChanges.shift() as QueueItem;
      newState = reducer(newState || this._state, action);
      if (origin) {
        origins.add(origin);
      }
      itemsProcessed++;
    }

    if (newState && newState !== this._state) {
      await this.handleStateChange(newState, previousState, origins);
    }

    this._processing = false;
  }

  /**
   * Emits state change events for all affected entities
   * @param differences - Detailed diff of state changes
   * @param previousState - Previous state before changes
   * @param newState - New state after changes
   * @param origins - Array of origin identifiers for the changes
   */
  private async emitStateChangeEvents(
    differences: DetailedDiff,
    previousState: EntitiesState,
    newState: EntitiesState,
    origins: string[]
  ): Promise<void> {
    const changedPaths = ['added', 'updated', 'deleted'] as const;

    const emitMatchingEvents = async (event: string, details: object) => {
      if (this.listenerCount(event) > 0) {
        await this.emitAsync(event, details);
      }

      const [entityName, eventIdAndType] = event.split('.');
      const [eventId, eventType] = eventIdAndType.split(':');

      const wildcardPatterns = [
        `${entityName}.*:${eventType}`,
        `*.*:${eventType}`,
        `${entityName}.${eventId}:*`,
        `${entityName}.*:*`,
        '*.*:*'
      ];

      // Emit for any wildcard patterns that have listeners
      for (const pattern of wildcardPatterns) {
        if (this.listenerCount(pattern) > 0) {
          await this.emitAsync(pattern, details);
        }
      }
    };

    for (const changeType of changedPaths) {
      const entities = differences[changeType];
      if (!entities || typeof entities !== 'object') continue;

      for (const [entityName, entityChanges] of Object.entries(entities)) {
        if (!entityChanges || typeof entityChanges !== 'object') continue;

        for (const entityId of Object.keys(entityChanges)) {
          const eventName = `${entityName}.${entityId}:${changeType}`;

          if (origins.includes(this.instanceId)) {
            continue;
          }

          const eventDetails = { newState, previousState, changeType, changes: entityChanges[entityId], origins };

          await emitMatchingEvents(eventName, eventDetails);
        }
      }
    }

    await this.emitAsync('stateChange', { newState, previousState, differences, changeOrigins: origins });
  }

  /**
   * Queries an entity by name and ID, optionally denormalizing the data
   * @param entityName - Name of the entity type
   * @param id - ID of the entity
   * @param denormalizeData - Whether to denormalize the entity data
   * @returns The requested entity or null if not found
   */
  query(entityName: string, id: string, denormalizeData = true): any {
    if (!entityName || !id) {
      return null;
    }

    const cacheKey = `${entityName}::${id}`;

    if (this.proxyCache.has(cacheKey)) {
      const cachedEntry = this.proxyCache.get(cacheKey)!;
      if (cachedEntry.lastState === this._state) {
        return cachedEntry.data;
      } else {
        this.proxyCache.delete(cacheKey);
      }
    }

    const entity = this._state[entityName]?.[id];
    if (!entity) {
      return null;
    }

    let result: any;
    if (denormalizeData) {
      const denormalized = limitRecursion(id, entityName, this._state, this);

      const createPropagationHandler = (parentProxy: any, prop: string | symbol): ProxyHandler<any> => ({
        set: (target: any, key: string | symbol, value: any): boolean => {
          if (target[key] === value) {
            return true;
          }

          if (Object.isFrozen(target)) {
            return false;
          }

          // Update the local target
          target[key] = value;

          // Trigger the parent proxy's set trap
          parentProxy[prop] = target;

          return true;
        },
        get: (target: any, key: string | symbol): any => {
          if (key === 'toJSON') {
            return () => JSON.parse(JSON.stringify(target));
          }

          const val = target[key];
          if (typeof val === 'string' || typeof val === 'number') {
            return val;
          }

          if (Array.isArray(val) || (typeof val === 'object' && val !== null)) {
            // Recursively wrap nested objects/arrays in propagation handlers
            return new Proxy(val, createPropagationHandler(target, key));
          }

          return val;
        }
      });

      const createHandler = (currentEntityName: string, currentEntityId: string): ProxyHandler<any> => ({
        set: (target: any, prop: string | symbol, value: any): boolean => {
          const oldValue = target[prop];
          if (oldValue === value) {
            return true;
          }

          if (Object.isFrozen(target)) {
            return false;
          }

          // Update the proxy's local state
          target[prop] = value;

          // Handle removals (both array and object)
          const relation = SchemaManager.schemas[currentEntityName].schema[prop as string];

          let removedEntityIds: string[] = [];

          if (relation) {
            const nestedEntityName = getEntityName(relation);
            const idAttribute = SchemaManager.schemas[nestedEntityName].idAttribute;

            if (Array.isArray(value)) {
              if (Array.isArray(oldValue)) {
                const oldIds = oldValue.map((item: any) =>
                  typeof idAttribute === 'function' ? idAttribute(item) : item[idAttribute]
                );
                const newIds = value.map((item: any) =>
                  typeof idAttribute === 'function' ? idAttribute(item) : item[idAttribute]
                );
                removedEntityIds = oldIds.filter((id: string) => !newIds.includes(id));
              }

              // Convert array of entities to array of IDs
              value = value.map((item: any) => {
                if (typeof item === 'string' || typeof item === 'number') {
                  return item; // Already an ID
                }
                return typeof idAttribute === 'function' ? idAttribute(item) : item[idAttribute];
              });
            } else if (value && typeof value === 'object') {
              if (oldValue && typeof oldValue === 'object') {
                const oldId = typeof idAttribute === 'function' ? idAttribute(oldValue) : oldValue[idAttribute];
                const newId = typeof idAttribute === 'function' ? idAttribute(value) : value[idAttribute];

                if (oldId && oldId !== newId) {
                  removedEntityIds.push(oldId);
                }
              }

              // Convert single entity reference to ID
              value = typeof idAttribute === 'function' ? idAttribute(value) : value[idAttribute];
            }
          }

          // Determine the appropriate strategy based on the property type
          let strategy: EntityStrategy = '$merge';
          if (Array.isArray(target[prop])) {
            if (Array.isArray(value)) {
              strategy = '$set';
            } else {
              strategy = '$push';
            }
          } else if (value === null || value === undefined) {
            strategy = '$unset';
          }

          // Create actions array
          const actions: EntityAction[] = [
            updatePartialEntity(
              currentEntityName,
              currentEntityId,
              {
                [currentEntityId]: {
                  [prop]: relation ? value : JSON.parse(JSON.stringify(value))
                }
              },
              strategy
            )
          ];

          // Add deleteEntity actions if needed
          if (removedEntityIds.length > 0 && relation) {
            const nestedEntityName = getEntityName(relation);
            removedEntityIds.forEach((entityId: string) => {
              if (
                !this.isEntityReferenced(nestedEntityName, entityId, {
                  entityName: currentEntityName,
                  fieldName: prop as string
                })
              ) {
                actions.push(deleteEntity(entityId, nestedEntityName));
              }
            });
          }

          // Dispatch all actions at once
          this.dispatch(actions, false, this.instanceId);

          return true;
        },
        get: (target: any, prop: string | symbol): any => {
          if (prop === 'toJSON') {
            return () => JSON.parse(JSON.stringify(target));
          }

          const val = target[prop];
          if (typeof val === 'string' || typeof val === 'number') {
            return val;
          }

          const relation = SchemaManager.schemas[currentEntityName].schema[prop as string];

          if (Array.isArray(val)) {
            return new Proxy(
              val.map((item: any) => {
                if (typeof item === 'string' || typeof item === 'number') {
                  return item;
                }
                if (relation) {
                  const nestedEntityName = getEntityName(relation);
                  const idAttribute = SchemaManager.schemas[nestedEntityName].idAttribute;
                  const id = typeof idAttribute === 'function' ? idAttribute(item) : item[idAttribute];
                  return new Proxy(item, createHandler(nestedEntityName, id));
                }
                // For non-relationship arrays, wrap in propagation handler
                if (typeof item === 'object' && item !== null) {
                  return new Proxy(item, createPropagationHandler(target, prop));
                }
                return item;
              }),
              createHandler(currentEntityName, currentEntityId)
            );
          }

          if (typeof val === 'object' && val !== null) {
            if (relation) {
              const nestedEntityName = getEntityName(relation);
              const idAttribute = SchemaManager.schemas[nestedEntityName].idAttribute;
              const id = typeof idAttribute === 'function' ? idAttribute(val) : val[idAttribute];
              return new Proxy(val, createHandler(nestedEntityName, id));
            }
            // For non-relationship objects, wrap in propagation handler
            return new Proxy(val, createPropagationHandler(target, prop));
          }

          return val;
        }
      });

      result = new Proxy(denormalized, createHandler(entityName, id));
      this.proxyCache.set(cacheKey, { data: result, lastState: this._state });
    } else {
      result = entity;
    }

    return result;
  }

  /**
   * Invalidates forward relationships for an entity
   * @param relationships - The entity's relationships
   * @param entityChanges - Changes to the entity
   * @param entityId - ID of the entity
   */
  private invalidateForwardRelationships(relationships: any, entityChanges: any, entityId: string) {
    if (!relationships) return;

    Object.entries(relationships).forEach(([fieldName, relation]) => {
      if (fieldName === '_referencedBy') return;

      const { relatedEntityName, isMany } = relation as Relationship;
      const relatedIds = entityChanges[entityId]?.[fieldName];

      if (relatedIds) {
        // Handle array-like objects (from DetailedDiff)
        const idsToInvalidate = isMany
          ? Object.values(relatedIds) // Convert array-like object to array
          : [relatedIds]; // Single value, wrap in array

        idsToInvalidate.forEach((id: string) => {
          if (id) {
            // Ensure id is not null/undefined
            this.deleteCache(relatedEntityName, id);
          }
        });
      }
    });
  }

  /**
   * Invalidates reverse relationships for an entity
   * @param relationships - The entity's relationships
   * @param entityId - ID of the entity
   */
  private invalidateReverseRelationships(relationships: any, entityId: string) {
    if (!relationships._referencedBy) return;

    Object.entries(relationships._referencedBy).forEach(([referencingEntityName, relation]) => {
      const { fieldName, isMany } = relation as { fieldName: string; isMany: boolean };
      this.invalidateReferencingEntities(referencingEntityName, fieldName, isMany, entityId);
    });
  }

  /**
   * Invalidates entities that reference the given entity
   * @param referencingEntityName - Name of the referencing entity type
   * @param fieldName - Field name that references the entity
   * @param isMany - Whether the relationship is one-to-many
   * @param entityId - ID of the referenced entity
   */
  private invalidateReferencingEntities(
    referencingEntityName: string,
    fieldName: string,
    isMany: boolean,
    entityId: string
  ) {
    const referencingEntities = this._state[referencingEntityName];
    if (!referencingEntities) return;

    Object.entries(referencingEntities).forEach(([id, entity]) => {
      if (this.entityReferencesTarget(entity, fieldName, isMany, entityId)) {
        this.deleteCache(referencingEntityName, id);
      }
    });
  }

  /**
   * Checks if an entity references the target entity
   * @param entity - The entity to check
   * @param fieldName - Field name that references the target
   * @param isMany - Whether the relationship is one-to-many
   * @param entityId - ID of the target entity
   * @returns True if the entity references the target
   */
  private entityReferencesTarget(entity: any, fieldName: string, isMany: boolean, entityId: string): boolean {
    return (
      entity[fieldName] === entityId ||
      (isMany && Array.isArray(entity[fieldName]) && entity[fieldName].includes(entityId))
    );
  }

  /**
   * Invalidates cache entries based on state changes
   * @param differences - Detailed diff of state changes
   */
  private invalidateCache(differences: DetailedDiff) {
    const changedPaths = ['added', 'updated', 'deleted'] as const;

    changedPaths.forEach((changeType) => {
      const entities = differences[changeType];
      if (!entities || typeof entities !== 'object') return;

      Object.entries(entities).forEach(([entityName, entityChanges]) => {
        if (!entityChanges || typeof entityChanges !== 'object') return;

        Object.keys(entityChanges).forEach((entityId) => {
          this.deleteCache(entityName, entityId);

          const relationships = SchemaManager.relationshipMap[entityName];
          if (!relationships) return;

          if (changeType !== 'deleted') {
            this.invalidateForwardRelationships(relationships, entityChanges, entityId);
          }

          this.invalidateReverseRelationships(relationships, entityId);
        });
      });
    });
  }

  /**
   * Deletes cache entries for a specific entity
   * @param entityName - Name of the entity type
   * @param entityId - ID of the entity
   */
  private deleteCache(entityName: string, entityId: string) {
    const cacheKey = `${entityName}::${entityId}`;
    if (this.cache.has(cacheKey)) {
      this.cache.delete(cacheKey);
    }
    if (this.proxyCache.has(cacheKey)) {
      this.proxyCache.delete(cacheKey);
    }
  }

  /**
   * Clears all entities from the state
   */
  clear() {
    this.dispatch(clearEntities(), true, this.instanceId);
  }

  /**
   * Emits events asynchronously to all registered listeners
   * @param event - The event name to emit
   * @param args - Arguments to pass to the listeners
   * @returns Promise that resolves to true if there were listeners, false otherwise
   */
  protected async emitAsync(event: string, ...args: any[]): Promise<boolean> {
    const listeners = this.listeners(event);

    for (const listener of listeners) {
      try {
        await Promise.resolve().then(() => listener(...args));
      } catch (error) {
        console.error(`Error in listener for event '${event}':`, error);
      }
    }

    return listeners.length > 0;
  }

  // Add this helper method to check if an entity is still referenced
  private isEntityReferenced(
    entityName: string,
    entityId: string,
    ignoreReference?: { entityName: string; fieldName: string }
  ): boolean {
    const entityState = this.state[entityName];
    if (!entityState) return false;

    const relationships = SchemaManager.relationshipMap[entityName];
    if (!relationships?._referencedBy) return false;

    return Object.entries(relationships._referencedBy).some(([referencingEntityName, reference]) => {
      // Skip the reference we're about to delete
      if (
        ignoreReference &&
        referencingEntityName === ignoreReference.entityName &&
        reference.fieldName === ignoreReference.fieldName
      ) {
        return false;
      }

      const entities = this.state[referencingEntityName];
      if (!entities) return false;

      return Object.values(entities).some((entity: any) => {
        const value = entity[reference.fieldName];
        if (Array.isArray(value)) {
          return value.includes(entityId);
        }
        return value === entityId;
      });
    });
  }
}

export default StateManager;
