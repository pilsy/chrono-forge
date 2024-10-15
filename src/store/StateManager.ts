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
      const denormalized = JSON.parse(JSON.stringify(limitRecursion(id, entityName, this._state)));

      const createHandler = (entityName: string, entityId: string, parentPath: string[] = []) => ({
        set: (target: any, prop: string | symbol, value: any): boolean => {
          if (Object.is(target[prop], value)) {
            return true; // Early exit if no change
          }

          const { currentSchema, propKey, currentPath, childKey, targetSchema, index } = buildContext(
            target,
            prop,
            entityName,
            parentPath
          );
          const updates = buildUpdates(target, prop, value, entityId, currentPath, targetSchema, index);

          applyNestedEntityUpdates(targetSchema, value, target, prop, this);
          dispatchPartialUpdate(entityName, entityId, updates, this);

          Reflect.set(target, prop, value); // Reflect the change in the target object

          return true;
        },
        get: (target: any, prop: string | symbol) => {
          if (prop === 'toJSON') {
            return () => JSON.parse(JSON.stringify(target)); // Custom toJSON method
          }

          const { val, propKey, nextPath, nextEntityName } = navigateToProp(target, prop, entityName, parentPath);

          if (Array.isArray(val) || (typeof val === 'object' && val !== null)) {
            return new Proxy(val, createHandler(nextEntityName, entityId, nextPath));
          }

          return val;
        }
      });

      function buildContext(target: any, prop: string | symbol, entityName: string, parentPath: string[]) {
        const schemaManager = SchemaManager.getInstance();
        const currentSchema = schemaManager.getSchema(entityName);
        const propKey = String(prop);
        const currentPath = [...parentPath, propKey];
        const childKey = Array.isArray(target) ? parentPath[parentPath.length - 1] : propKey;
        const targetSchema: schema.Entity & { _idAttribute: string } = get(
          currentSchema,
          `schema.${childKey}${Array.isArray(target) ? '.0' : ''}`
        );
        const index = Array.isArray(target) ? Number(prop) : -1;
        return { currentSchema, propKey, currentPath, childKey, targetSchema, index };
      }

      function buildUpdates(
        target: any,
        prop: string | symbol,
        value: any,
        entityId: string,
        currentPath: string[],
        targetSchema: schema.Entity & { _idAttribute: string },
        index: number
      ) {
        const updates: Record<string, any> = {};
        if (Array.isArray(target)) {
          handleArrayOperations(target, prop, value, entityId, currentPath, targetSchema, index, updates);
        } else {
          handleObjectOperations(value, entityId, currentPath, targetSchema, updates);
        }
        return updates;
      }

      function handleArrayOperations(
        target: any,
        prop: string | symbol,
        value: any,
        entityId: string,
        currentPath: string[],
        targetSchema: schema.Entity & { _idAttribute: string },
        index: number,
        updates: Record<string, any>
      ) {
        if (!isNaN(index)) {
          if (index < target.length) {
            updates[entityId] = buildNestedPath(currentPath.slice(0, -1), {
              $splice: [[index, 1, targetSchema ? value[targetSchema._idAttribute] : value]]
            });
          } else {
            updates[entityId] = buildNestedPath(currentPath.slice(0, -1), {
              $push: [targetSchema ? value[targetSchema._idAttribute] : value]
            });
          }
        }
      }

      function handleObjectOperations(
        value: any,
        entityId: string,
        currentPath: string[],
        targetSchema: schema.Entity & { _idAttribute: string },
        updates: Record<string, any>
      ) {
        updates[entityId] = buildNestedPath(currentPath, {
          [typeof value === 'object' ? '$merge' : '$set']: targetSchema ? value[targetSchema._idAttribute] : value
        });
      }

      function applyNestedEntityUpdates(
        targetSchema: schema.Entity & { _idAttribute: string },
        value: any,
        target: any,
        prop: string | symbol,
        context: any
      ) {
        if (targetSchema && value !== undefined && value !== null) {
          context.dispatch(updateEntity(value, getEntityName(targetSchema)), false, context.instanceId);
        } else if (targetSchema && (value === undefined || value === null)) {
          context.dispatch(
            deleteEntity(Reflect.get(target, prop), getEntityName(targetSchema)),
            false,
            context.instanceId
          );
        }
      }

      function dispatchPartialUpdate(entityName: string, entityId: string, updates: Record<string, any>, context: any) {
        context.dispatch(
          {
            type: PARTIAL_UPDATE,
            entityName,
            entityId,
            updates
          },
          false,
          context.instanceId
        );
      }

      function navigateToProp(target: any, prop: string | symbol, entityName: string, parentPath: string[]) {
        const val = Reflect.get(target, prop);
        const propKey = String(prop);
        const nextPath = [...parentPath, propKey];
        const nextEntityName = val && Array.isArray(target) && entityName ? getEntityName(entityName) : entityName;
        return { val, propKey, nextPath, nextEntityName };
      }

      /**
       * Constructs a nested path structure.
       */
      function buildNestedPath(path: string[], value: any): any {
        return path.reduceRight((acc, key) => ({ [key]: acc }), value);
      }

      result = new Proxy(denormalized, createHandler(entityName, id));
      this.cache.set(cacheKey, { data: result, lastState: this._state });
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
          this.cache.delete(cacheKey);
        });
      });
    });
  }

  clear() {
    this.dispatch(clearEntities(), true, this.instanceId);
  }
}

export default StateManager;
