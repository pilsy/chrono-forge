import EventEmitter from 'eventemitter3';
import { EntitiesState, EntityAction, reducer, updateEntity, clearEntities, UPDATE_ENTITIES, PARTIAL_UPDATE } from '../utils/entities';
import { DetailedDiff, detailedDiff } from 'deep-object-diff';
import { isEmpty } from 'lodash';
import { limitRecursion } from '../utils/limitRecursion';
import { Mutex } from '../decorators';
import { Schema } from 'normalizr';
import { SchemaManager } from './SchemaManager';

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

  private emitStateChangeEvents(differences: DetailedDiff, previousState: EntitiesState, newState: EntitiesState, origins: string[]): void {
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
          if (target[prop] === value) {
            return true;
          }

          const schemaManager = SchemaManager.getInstance();
          const currentSchema = schemaManager.getSchema(entityName);

          // Determine if there's an idAttribute and adjust the target path accordingly
          const updates: Record<string, any> = {};
          const propKey = String(prop);
          const currentPath = [...parentPath, propKey];

          if (Array.isArray(target)) {
            const index = Number(prop);
            if (!isNaN(index)) {
              if (index < target.length) {
                // Use $splice for updating elements at a specific index in nested list
                updates[entityId] = buildNestedPath(currentPath.slice(0, -1), { $splice: [[index, 1, value]] });
              } else {
                // Append elements via $push
                updates[entityId] = buildNestedPath(currentPath.slice(0, -1), { $push: [value] });
              }
            }
          } else {
            const updateStrategy = typeof value === 'object' ? '$merge' : '$set';

            // @ts-ignore Check for nested schema with an ID reference
            if (currentSchema && currentSchema.schema && currentSchema.schema[propKey]) {
              // @ts-ignore
              const childSchema = currentSchema.schema[propKey];
              const childIdAttribute = Array.isArray(childSchema) ? childSchema[0]._idAttribute : childSchema._idAttribute;

              // Replace the nested ID reference instead of the object if applicable
              if (value && value[childIdAttribute]) {
                updates[entityId] = buildNestedPath(currentPath, { [updateStrategy]: value[childIdAttribute] });
              } else {
                updates[entityId] = buildNestedPath(currentPath, { [updateStrategy]: value });
              }
            } else {
              // Handle directly if no schema reference manipulation needed
              updates[entityId] = buildNestedPath(currentPath, { [updateStrategy]: value });
            }
          }

          Reflect.set(target, prop, value);

          this.dispatch(
            {
              type: PARTIAL_UPDATE,
              entityName,
              entityId,
              updates
            },
            false,
            this.instanceId
          );

          return true;
        },
        get: (target: any, prop: string | symbol) => {
          if (prop === 'toJSON') {
            return () => JSON.parse(JSON.stringify(target));
          }
          const val = target[prop];
          const propKey = String(prop);
          const nextPath = [...parentPath, propKey];
          if (Array.isArray(val) || (typeof val === 'object' && val !== null)) {
            return new Proxy(val, createHandler(entityName, entityId, nextPath));
          }
          return val;
        }
      });

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
