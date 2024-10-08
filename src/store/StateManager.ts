import EventEmitter from 'eventemitter3';
import { EntitiesState, EntityAction, reducer, updateEntity, clearEntities } from '../utils/entities';
import { DetailedDiff, detailedDiff } from 'deep-object-diff';
import { isEmpty } from 'lodash';
import { limitRecursion } from '../utils/limitRecursion';
import { Mutex } from '../decorators';

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

  private static instances: {
    [instanceId: string]: StateManager;
  } = {};

  private _processing = false;
  /**
   * Lets you know if the StateManager instance is currently processing changes.
   * @returns The current processing boolean value.
   */
  get processing() {
    return this._processing;
  }

  private _state!: EntitiesState;
  /**
   * Gets the current state.
   * @returns The current state.
   */
  get state() {
    return this._state ?? {};
  }

  /**
   * Sets the current state and emits a state change event.
   * @param newState The new state to set.
   */
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
    const origins: Set<string> = sync ? new Set() : this.origins;
    if (origin) {
      origins.add(origin);
    }

    if (sync) {
      await this.processChanges([action], origins);
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

  /**
   * Queries the state for a specific entity.
   * Supports denormalizing the data based on the schema.
   * @param entityName The name of the entity to query.
   * @param id The ID of the entity to query.
   * @returns The denormalized data or the raw entity.
   */
  query(entityName: string, id: string, denormalizeData = true): any {
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

  /**
   * Clears all entities in the state.
   */
  clear() {
    this.dispatch(clearEntities(), true, this.instanceId);
  }
}

export default StateManager;
