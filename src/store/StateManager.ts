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
} from '../store/entities';
import { DetailedDiff, detailedDiff } from 'deep-object-diff';
import { isEmpty, isObject } from 'lodash';
import { getEntityName, limitRecursion } from '../utils/limitRecursion';
import { Mutex } from '../decorators';
import { SchemaManager } from './SchemaManager';
import { get } from 'dottie';
import { schema } from 'normalizr';

export class StateManager extends EventEmitter {
  get instanceId() {
    return this._instanceId;
  }
  private constructor(private _instanceId: string) {
    super();
    this._instanceId = _instanceId;
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

    const emitMatchingEvents = (event: string, details: object) => {
      // Emit the exact event if there are listeners
      if (this.listenerCount(event) > 0) {
        this.emit(event, details);
      }

      // Emit for wildcard listeners
      const [entityName, eventIdAndType] = event.split('.');
      const [eventId, eventType] = eventIdAndType.split(':');

      // Create wildcard patterns
      const wildcardPatterns = [
        `${entityName}.*:${eventType}`, // EntityName.*:changeType
        `*.*:${eventType}`, // *.*:changeType
        `${entityName}.${eventId}:*`, // EntityName.entityId:*
        '*.*:*' // *.*:*
      ];

      // Emit for any wildcard patterns that have listeners
      wildcardPatterns.forEach((pattern) => {
        if (this.listenerCount(pattern) > 0) {
          this.emit(pattern, details);
        }
      });
    };

    changedPaths.forEach((changeType) => {
      const entities = differences[changeType];
      if (!entities || typeof entities !== 'object') return;

      Object.entries(entities).forEach(([entityName, entityChanges]) => {
        if (!entityChanges || typeof entityChanges !== 'object') return;

        Object.keys(entityChanges).forEach((entityId) => {
          const eventName = `${entityName}.${entityId}:${changeType}`;

          // Avoid emitting events for the originating instance
          if (origins.includes(this.instanceId)) {
            return;
          }

          // Create the event details
          const eventDetails = { newState, previousState, changeType, changes: entityChanges[entityId], origins };

          // Emit all relevant events, including those for wildcard patterns
          emitMatchingEvents(eventName, eventDetails);
        });
      });
    });

    // Emit a general 'stateChange' event with the complete activity summary
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

      // result = limitRecursion(id, entityName, this._state, this);
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
