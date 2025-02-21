import EventEmitter from 'eventemitter3';
import { EntitiesState, EntityAction, reducer, updateEntity, clearEntities } from '../store/entities';
import { DetailedDiff, detailedDiff } from 'deep-object-diff';
import { isEmpty } from 'lodash';
import { Mutex } from '../decorators';
import { limitRecursion } from '../utils';

export class StateManager extends EventEmitter {
  get instanceId() {
    return this._instanceId;
  }
  private constructor(private readonly _instanceId: string) {
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
  set state(state: EntitiesState) {
    this._state = state;
  }

  async setState(newState: EntitiesState) {
    if (this._state === newState) return; // Skip if reference is the same

    const previousState = this._state;
    this.state = newState;

    if (this.listenerCount('stateChange') > 0) {
      await this.emitAsync('stateChange', {
        newState,
        previousState,
        differences: detailedDiff(previousState, newState)
      });
    }
  }

  public readonly cache: Map<string, { data: any; lastState: EntitiesState }> = new Map();
  private readonly _queue: EntityAction[] = [];
  get queue() {
    return this._queue;
  }
  private readonly origins: Set<string> = new Set();

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

    if (newState && newState !== this._state) {
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
      const denormalized = limitRecursion(id, entityName, this._state, this);
      const handler = {
        set: (target: any, prop: string | symbol, value: any) => {
          if (target[prop] === value) {
            return true;
          }
          target[prop] = value;
          this.dispatch(updateEntity(denormalized, entityName), false, this.instanceId);
          return value;
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
      this.invalidateEntities(differences[changeType]);
    });
  }

  private invalidateEntities(entities: Record<string, any>) {
    if (!entities || typeof entities !== 'object') return;

    Object.entries(entities).forEach(([entityName, entityChanges]) => {
      this.invalidateEntityChanges(entityName, entityChanges);
    });
  }

  private invalidateEntityChanges(entityName: string, entityChanges: Record<string, any>) {
    if (!entityChanges || typeof entityChanges !== 'object') return;

    Object.keys(entityChanges).forEach((entityId) => {
      this.deleteCache(entityName, entityId);

      const nestedEntities = entityChanges[entityId];
      if (nestedEntities && typeof nestedEntities === 'object') {
        this.invalidateNestedEntities(entityName, nestedEntities);
      }
    });
  }

  private deleteCache(entityName: string, entityId: string) {
    const cacheKey = `${entityName}.${entityId}`;
    this.cache.delete(cacheKey);
  }

  private invalidateNestedEntities(entityName: string, nestedEntities: Record<string, any>) {
    Object.keys(nestedEntities).forEach((nestedEntityId) => {
      this.deleteCache(entityName, nestedEntityId);
    });
  }

  clear() {
    this.dispatch(clearEntities(), true, this.instanceId);
  }

  async emitAsync(event: string, ...args: any[]): Promise<boolean> {
    const listeners = this.listeners(event);

    // Execute all listeners sequentially, waiting for async ones
    for (const listener of listeners) {
      try {
        const result: any = listener(...args);
        if (result instanceof Promise) {
          await result;
        }
      } catch (error) {
        console.error(`Error in listener for event '${event}':`, error);
      }
    }

    return listeners.length > 0;
  }
}

export default StateManager;
