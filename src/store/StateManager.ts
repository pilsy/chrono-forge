import EventEmitter from 'eventemitter3';
import { EntitiesState, EntityAction, reducer, clearEntities, setState } from '../store/entities';
import { DetailedDiff, detailedDiff } from 'deep-object-diff';
import { isEmpty } from 'lodash';
import { limitRecursion } from '../utils';
import { LRUCacheWithDelete } from 'mnemonist';
import { Relationship, SchemaManager } from './SchemaManager';
import { GraphManager } from './GraphManager';
import { EntityDataProxy } from './EntityDataProxy';

/**
 * Represents the detailed diff structure for EntitiesState
 */
export type EntitiesStateDetailedDiff = {
  added: EntitiesState;
  updated: EntitiesState;
  deleted: EntitiesState;
};

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
  private readonly graphManager: GraphManager;

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
    this.graphManager = GraphManager.getInstance();
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
   * @param previousState - Previous state before changes
   * @param origins - Set of origin identifiers for the changes
   */
  private async handleStateChange(newState: EntitiesState, previousState: EntitiesState, origins: Set<string>) {
    const differences = detailedDiff(previousState, newState);
    if (!isEmpty(differences.added) || !isEmpty(differences.updated) || !isEmpty(differences.deleted)) {
      this._state = newState;
      EntityDataProxy.clearCache();
      this.cache.clear();

      await this.emitStateChangeEvents(differences, previousState, newState, Array.from(origins));
    }
  }

  async setState(newState: EntitiesState) {
    if (this._state === newState) return;
    await this.dispatch(setState(newState), true, this.instanceId);
  }

  public readonly cache: LRUCacheWithDelete<string, Record<string, any>> = new LRUCacheWithDelete(100);

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
    const startTime = Date.now();
    const MAX_PROCESSING_TIME = 30000; // 30 seconds in milliseconds

    while (pendingChanges.length > 0 && itemsProcessed < 100 && Date.now() - startTime < MAX_PROCESSING_TIME) {
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
      const entities = (differences as EntitiesStateDetailedDiff)[changeType];
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

    const entity = this._state[entityName]?.[id];
    if (!entity) {
      return null;
    }

    if (!denormalizeData) {
      return entity;
    }

    // Denormalize the entity data
    const denormalized = limitRecursion(id, entityName, this._state, this);

    // If denormalization didn't happen (returned just the ID), return the raw entity
    if (denormalized === id) {
      return entity;
    }

    // Create and return a proxy for the denormalized entity
    return EntityDataProxy.create(entityName, id, denormalized, this);
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

  // Helper method to check if an entity is still referenced
  public isEntityReferenced(
    entityName: string,
    entityId: string,
    ignoreReference?: { entityName: string; fieldName: string }
  ): boolean {
    if (!ignoreReference) {
      return this.graphManager.getInboundReferences(entityName, entityId).length > 0;
    }

    // Find the entity ID that's referencing this entity
    const entities = this.state[ignoreReference.entityName];
    if (!entities) return false;

    let referencingId: string | undefined;

    for (const [id, entity] of Object.entries(entities)) {
      const value = entity[ignoreReference.fieldName];

      // Check both array inclusion and direct equality in one condition
      if ((Array.isArray(value) && value.includes(entityId)) || value === entityId) {
        referencingId = id;
        break;
      }
    }

    if (!referencingId) return false;

    return this.graphManager.isEntityReferenced(entityName, entityId, {
      entityName: ignoreReference.entityName,
      id: referencingId
    });
  }
}

export default StateManager;
