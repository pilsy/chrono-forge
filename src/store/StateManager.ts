import EventEmitter from 'eventemitter3';
import {
  EntitiesState,
  EntityAction,
  reducer,
  updateEntity,
  clearEntities,
  UPDATE_ENTITIES,
  PARTIAL_UPDATE,
  updateNormalizedEntity,
  deleteEntity
} from '../utils/entities';
import { DetailedDiff, detailedDiff } from 'deep-object-diff';
import { isEmpty, isObject } from 'lodash';
import { getEntityName, limitRecursion } from '../utils/limitRecursion';
import { Mutex } from '../decorators';
import { SchemaManager } from './SchemaManager';
import { get } from 'dottie';
import { schema } from 'normalizr';

export class StateManager extends EventEmitter {
  private constructor(private instanceId: string) {
    super();
    this.instanceId = instanceId;
    this._state = {};
  }

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

  private _processing = false;
  get processing() {
    return this._processing;
  }

  private _state!: EntitiesState;
  get state() {
    return this._state ?? {};
  }
  set state(newState) {
    const previousState = this._state;
    this._state = newState;
    this.emit('stateChange', { newState, previousState, differences: detailedDiff(previousState, newState) });
  }

  private cache: Map<string, { data: any; lastState: EntitiesState }> = new Map();
  private _queue: EntityAction[] = [];
  get queue() {
    return this._queue;
  }
  private origins: Set<string> = new Set();

  async dispatch(action: EntityAction, sync = true, origin: string | null = null): Promise<void> {
    // console.log(`[StateManager]: Dispatch...\n${JSON.stringify(action, null, 2)}`);
    const origins: Set<string> = sync ? new Set() : this.origins;
    if (origin) {
      origins.add(origin);
    }

    if (sync) {
      await this.processChanges([action], origins || Set<string>);
    } else {
      this._queue.push(action);
    }
  }

  @Mutex('stateManager')
  async processChanges(actions?: EntityAction[], origins = this.origins): Promise<void> {
    const pendingChanges = actions ?? this._queue;
    const previousState = this._state;

    this._processing = true;
    let newState;

    while (pendingChanges.length > 0) {
      const change = pendingChanges.shift();
      // console.log(`[StateManager]: Processing change`, JSON.stringify(change, null, 2));
      newState = reducer(newState || this._state, change as EntityAction);
    }

    if (newState) {
      const differences = detailedDiff(this._state, newState);
      if (!isEmpty(differences.added) || !isEmpty(differences.updated) || !isEmpty(differences.deleted)) {
        this._state = newState;
        this.invalidateCache(differences);
        this.emitStateChangeEvents(differences, previousState, newState, Array.from(origins));
      }
    }

    origins.clear();
    this._processing = false;
  }

  private emitStateChangeEvents(
    differences: DetailedDiff,
    previousState: EntitiesState,
    newState: EntitiesState,
    origins: string[]
  ): void {
    const changedPaths = ['added', 'updated', 'deleted'] as const;

    changedPaths.forEach((changeType) => {
      const entities = differences[changeType];
      if (!entities || typeof entities !== 'object') return;

      Object.entries(entities).forEach(([entityName, entityChanges]) => {
        if (!entityChanges || typeof entityChanges !== 'object') return;

        Object.keys(entityChanges).forEach((entityId) => {
          const eventName = `${entityName}.${entityId}:${changeType}`;

          if (origins.includes(this.instanceId)) {
            return;
          }

          if (this.listenerCount(eventName) > 0) {
            this.emit(eventName, { newState, previousState, changes: entityChanges[entityId], origins });
          }
        });
      });
    });

    this.emit('stateChange', { newState, previousState, differences, changeOrigins: origins });
  }

  query(entityName: string, id: string, denormalizeData = true): any {
    if (!entityName || !id) {
      return null;
    }

    const cacheKey = `${entityName}.${id}`;

    if (this.cache.has(cacheKey)) {
      const cachedEntry = this.cache.get(cacheKey)!;
      if (cachedEntry.lastState === this._state) {
        return cachedEntry.data;
      } else {
        console.log(`[StateManager]: Cache invalidated for ${cacheKey} due to state change`);
        this.cache.delete(cacheKey);
      }
    }

    const entity = this._state[entityName]?.[id];
    if (!entity) {
      return null;
    }

    let result: any;
    if (denormalizeData) {
      const denormalized = limitRecursion(id, entityName, this._state);
      const handler = {
        set: (target: any, prop: string | symbol, value: any) => {
          if (target[prop] === value) {
            return true;
          }
          target[prop] = value;
          this.dispatch(updateEntity(denormalized, entityName), false, this.instanceId);
          return true;
        },
        get: (target: any, prop: string | symbol) => {
          if (prop === 'toJSON') {
            return () => {
              return JSON.parse(JSON.stringify(target)); // Deep copy to break proxy
            };
          }

          const val = target[prop];
          if (Array.isArray(val) || (typeof val === 'object' && val !== null)) {
            return new Proxy(val, handler);
          }
          return val;
        }
      };
      result = new Proxy(denormalized, handler);
      this.cache.set(cacheKey, { data: result, lastState: this._state });
      // const denormalized = JSON.parse(JSON.stringify(limitRecursion(id, entityName, this._state)));

      // const createHandler = (entityName: string, entityId: string, parentPath: string[] = []) => ({
      //   set: (target: any, prop: string | symbol, value: any): boolean => {
      //     // Early exit if no change
      //     if (Object.is(target[prop], value)) {
      //       return true;
      //     }

      //     // Build the context for determining schema, paths, and other relevant information
      //     const { currentSchema, propKey, currentPath, childKey, parentSchema, targetSchema, index } = buildContext(
      //       target,
      //       prop,
      //       entityName,
      //       parentPath
      //     );

      //     // Build updates for the given property based on the entity and schema
      //     const updates = buildUpdates(target, prop, value, entityId, currentPath, targetSchema, parentSchema);

      //     // Apply nested entity updates (e.g., add Like to Photo's likes array)
      //     applyNestedEntityUpdates(targetSchema, value, target, prop, entityId, parentSchema);

      //     // Only dispatch the partial update if updates are not empty
      //     if (Object.keys(updates).length > 0) {
      //       dispatchPartialUpdate(entityName, entityId, updates);
      //     }

      //     // Reflect the change in the original target object
      //     Reflect.set(target, prop, value);

      //     return true;
      //   },

      //   get: (target: any, prop: string | symbol) => {
      //     // Custom `toJSON` method to handle JSON serialization
      //     if (prop === 'toJSON') {
      //       return () => JSON.parse(JSON.stringify(target));
      //     }

      //     // Navigate to the property and find its value, next path, and schema details
      //     const { val, propKey, nextPath, nextEntityName } = navigateToProp(target, prop, entityName, parentPath);

      //     // If the value is an object or an array, create a proxy to continue tracking changes
      //     if (Array.isArray(val) || (typeof val === 'object' && val !== null)) {
      //       return new Proxy(val, createHandler(nextEntityName, entityId, nextPath));
      //     }

      //     // Return the value directly if it's not an object or array
      //     return val;
      //   }
      // });

      // const buildContext = (target: any, prop: string | symbol, entityName: string, parentPath: string[]) => {
      //   const targetIsArray = Array.isArray(target);
      //   const schemaManager = SchemaManager.getInstance();
      //   const currentSchema = schemaManager.getSchema(entityName);
      //   const propKey = String(prop);
      //   const currentPath = [...parentPath, propKey];
      //   if (targetIsArray && propKey === 'length') {
      //     currentPath.pop();
      //   }

      //   let targetSchema!: schema.Entity & { _idAttribute: string };
      //   let parentSchema!: schema.Entity & { _idAttribute: string };
      //   let targetPath;
      //   let schemaPath = [];
      //   let childKey = propKey;

      //   // Traverse the parent path to find the exact targetSchema
      //   let traversedSchema: schema.Entity & { _idAttribute: string; schema: any } = currentSchema as any;

      //   for (const segment of parentPath.slice(0, -2)) {
      //     if (traversedSchema && traversedSchema.schema) {
      //       if (isNaN(parseInt(segment)) && traversedSchema.schema[segment]) {
      //         traversedSchema = Array.isArray(traversedSchema.schema[segment])
      //           ? traversedSchema.schema[segment][0]
      //           : traversedSchema.schema[segment];
      //       }
      //     }
      //   }

      //   // Now get the child schema based on property key in the target context
      //   if (traversedSchema && traversedSchema.schema && traversedSchema.schema[parentPath[parentPath.length - 1]]) {
      //     parentSchema = traversedSchema;
      //     targetSchema = traversedSchema.schema[parentPath[parentPath.length - 1]];
      //     targetSchema = Array.isArray(targetSchema) ? targetSchema[0] : targetSchema;
      //   }

      //   const index = Array.isArray(target) ? Number(prop) : -1;

      //   return { currentSchema, propKey, currentPath, childKey, parentSchema, targetSchema, index };
      // };

      // const buildUpdates: any = (
      //   target: any,
      //   prop: string | symbol,
      //   value: any,
      //   entityId: string,
      //   currentPath: string[],
      //   targetSchema: schema.Entity & { _idAttribute: string },
      //   parentSchema: schema.Entity & { _idAttribute: string }
      // ) => {
      //   const updates: Record<string, any> = {};

      //   if (Array.isArray(target)) {
      //     const mappedValue = mapValueToSchema(value, targetSchema);
      //     if (value[targetSchema._idAttribute] === mappedValue) {
      //       // @ts-ignore Use the property name instead of array index when updating arrays
      //       const path = buildNestedPath(
      //         // @ts-ignore
      //         [...currentPath.slice(-2, 1), !isNaN(parseInt(prop)) ? currentPath[currentPath.length - 2] : prop],
      //         {
      //           $push: [mappedValue] // Ensure the correct property name is used
      //         }
      //       );
      //       updates[entityId] = path;
      //     } else {
      //       console.warn('Mapped value is undefined. Skipping update.');
      //     }

      //     // Dispatch partial update for the parent entity
      //     dispatchPartialUpdate(getEntityName(parentSchema), entityId, updates);
      //   }

      //   return updates; // Return the updates to avoid empty dispatches
      // };

      // const handleArrayOperations = (
      //   target: any,
      //   prop: string | symbol,
      //   value: any,
      //   entityId: string,
      //   currentPath: string[],
      //   targetSchema: schema.Entity & { _idAttribute: string },
      //   index: number,
      //   updates: Record<string, any>
      // ) => {
      //   const pathPrefix = currentPath.slice(0, -1); // Path excluding index
      //   const mappedValue = mapValueToSchema(value, targetSchema);

      //   if (index === target.length) {
      //     // Handle array push operation (new item)
      //     updates[entityId] = buildNestedPath(pathPrefix, {
      //       $push: [mappedValue]
      //     });
      //   } else {
      //     // Handle update of an existing array item
      //     updates[entityId] = buildNestedPath(pathPrefix, {
      //       $splice: [[index, 1, mappedValue]]
      //     });
      //   }

      //   // Also dispatch an updateEntity action for the new entity
      //   if (typeof value === 'object' && value !== null) {
      //     this.dispatch(updateEntity(value, getEntityName(targetSchema)), false, this.instanceId);
      //   }
      // };

      // const handleObjectOperations = (
      //   value: any,
      //   entityId: string,
      //   currentPath: string[],
      //   targetSchema: schema.Entity & { _idAttribute: string },
      //   updates: Record<string, any>
      // ) => {
      //   const mappedValue = mapValueToSchema(value, targetSchema);
      //   if (typeof mappedValue === 'object' && mappedValue !== null && !isEmpty(mappedValue)) {
      //     updates[entityId] = buildNestedPath(currentPath, {
      //       $merge: mappedValue
      //     });
      //   } else {
      //     updates[entityId] = buildNestedPath(currentPath, {
      //       $set: mappedValue
      //     });
      //   }
      // };

      // const mapValueToSchema = (value: any, targetSchema: any) => {
      //   if (targetSchema && targetSchema._idAttribute) {
      //     const { _idAttribute } = targetSchema;
      //     return Array.isArray(value)
      //       ? value.map((item) => (typeof item === 'object' ? item[_idAttribute] || item : item))
      //       : typeof value === 'object'
      //         ? value[_idAttribute] || value
      //         : value;
      //   }
      //   return value;
      // };

      // const applyNestedEntityUpdates = (
      //   targetSchema: schema.Entity & { _idAttribute: string },
      //   value: any,
      //   target: any,
      //   prop: string | symbol,
      //   parentId: string,
      //   parentSchema: schema.Entity & { _idAttribute: string }
      // ) => {
      //   if (targetSchema && value !== undefined && value !== null) {
      //     const entityName = getEntityName(targetSchema);
      //     const entityId = typeof value === 'object' ? value[targetSchema._idAttribute] : value;

      //     // Ensure entityId is defined before pushing
      //     if (entityId) {
      //       const updates = {
      //         [parentId]: {
      //           [prop]: {
      //             $push: [entityId] // Ensure the correct property (e.g., likes) is used, not an array index
      //           }
      //         }
      //       };

      //       // Update the parent entity (e.g., Photo.likes)
      //       // dispatchPartialUpdate(getEntityName(parentSchema), parentId, updates);

      //       // Upsert the nested entity (e.g., Like)
      //       this.dispatch(updateEntity(value, entityName), false, this.instanceId);
      //     } else {
      //       console.warn('Entity ID is undefined. Skipping nested entity update.');
      //     }
      //   }
      // };

      // const dispatchPartialUpdate = (entityName: string, entityId: string, updates: Record<string, any>) => {
      //   // Only dispatch if updates are not empty
      //   if (updates && Object.keys(updates).length > 0) {
      //     // Check for existing partial updates to avoid duplicates
      //     const existingUpdate = this.queue.find(
      //       (action: any) =>
      //         action.type === PARTIAL_UPDATE && action.entityName === entityName && action.entityId === entityId
      //     );

      //     if (existingUpdate) {
      //       // Merge updates if the same entity is already queued
      //       existingUpdate.updates = {
      //         ...existingUpdate.updates,
      //         ...updates
      //       };
      //     } else {
      //       // Dispatch a new partial update for the entity
      //       this.dispatch(
      //         {
      //           type: PARTIAL_UPDATE,
      //           entityName,
      //           entityId,
      //           updates
      //         },
      //         false,
      //         this.instanceId
      //       );
      //     }
      //   }
      // };

      // const navigateToProp = (target: any, prop: string | symbol, entityName: string, parentPath: string[]) => {
      //   const val = Reflect.get(target, prop);
      //   const propKey = String(prop);
      //   const nextPath = [...parentPath, propKey];
      //   const nextEntityName = val && Array.isArray(target) && entityName ? getEntityName(entityName) : entityName;
      //   return { val, propKey, nextPath, nextEntityName };
      // };

      // const buildNestedPath = (path: string[], value: any): any => {
      //   return path.reduceRight((acc, key) => ({ [key]: acc }), value);
      // };

      // result = new Proxy(denormalized, createHandler(entityName, id));
      // this.cache.set(cacheKey, { data: result, lastState: this._state });
    } else {
      result = entity;
    }

    return result;
  }

  private invalidateCache(differences: DetailedDiff) {
    const changedPaths = ['added', 'updated', 'deleted'] as const;

    changedPaths.forEach((changeType) => {
      const entities = differences[changeType];
      if (!entities || typeof entities !== 'object') return;

      Object.entries(entities).forEach(([entityName, entityChanges]) => {
        if (!entityChanges || typeof entityChanges !== 'object') return;

        Object.keys(entityChanges).forEach((entityId) => {
          const cacheKey = `${entityName}.${entityId}`;
          this.cache.delete(cacheKey); // Invalidate cache for parent entity

          // Also invalidate cache for nested entities if necessary
          if (entityChanges[entityId] && typeof entityChanges[entityId] === 'object') {
            Object.keys(entityChanges[entityId]).forEach((nestedEntityId) => {
              const nestedCacheKey = `${entityName}.${nestedEntityId}`;
              this.cache.delete(nestedCacheKey);
            });
          }
        });
      });
    });
  }

  clear() {
    this.dispatch(clearEntities(), true, this.instanceId);
  }
}

export default StateManager;
