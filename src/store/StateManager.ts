import EventEmitter from 'eventemitter3';
import { reducer, EntitiesState } from './entities';
import { EntityAction, clearEntities, setState } from './actions';
import { DetailedDiff, detailedDiff } from 'deep-object-diff';
import { isEmpty } from 'lodash';
import { limitRecursion } from '../utils';
import { LRUCacheWithDelete } from 'mnemonist';
import { EntityProxyManager } from './EntityProxyManager';
import { SchemaManager } from './SchemaManager';
import { Queue } from 'typescript-algos';

/**
 * Represents the detailed diff structure for EntitiesState
 * Contains added, updated, and deleted entity collections
 */
export type EntitiesStateDetailedDiff = {
  added: EntitiesState;
  updated: EntitiesState;
  deleted: EntitiesState;
};

/**
 * Represents a queue item containing an entity action and optional origin
 * Used for tracking actions in the processing queue
 */
export type QueueItem = {
  action: EntityAction;
  origin?: string;
};

/**
 * StateManager class manages application state and entity relationships
 * using a singleton pattern with instance management.
 * Extends EventEmitter to provide state change notifications.
 * Handles state updates, entity queries, and relationship management.
 */
export class StateManager extends EventEmitter {
  /**
   * Gets the instance ID of this StateManager
   * @returns The unique identifier for this StateManager instance
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

    // Initialize EntityProxyManager if it hasn't been initialized yet
    if (!EntityProxyManager['proxyStateTree']) {
      EntityProxyManager.initialize();
    }
  }

  /**
   * Gets or creates a StateManager instance for the given ID
   * Implements the singleton pattern with multiple named instances
   * @param instanceId - Unique identifier for the StateManager instance
   * @returns StateManager instance for the given ID
   * @throws Error if instanceId is not provided
   */
  static getInstance(instanceId: string): StateManager {
    if (!instanceId) {
      throw new Error(`You must provide a instanceId ${instanceId}!`);
    }

    // Initialize EntityProxyManager if it hasn't been initialized yet
    if (!EntityProxyManager['proxyStateTree']) {
      EntityProxyManager.initialize();
    }

    if (!this.instances[instanceId]) {
      this.instances[instanceId] = new StateManager(instanceId);
    }
    return this.instances[instanceId];
  }

  private static instances: { [instanceId: string]: StateManager } = {};

  /**
   * Indicates whether the StateManager is currently processing changes
   * @returns Boolean indicating if state changes are being processed
   */
  private _processing = false;
  get processing() {
    return this._processing;
  }

  /**
   * Gets the current entity state
   * @returns The current EntitiesState object or empty object if not initialized
   */
  private _state!: EntitiesState;
  get state() {
    return this._state ?? {};
  }

  /**
   * Sets the current entity state
   * @param state - The new EntitiesState to set
   */
  set state(state: EntitiesState) {
    this._state = state;
  }

  /**
   * Updates the state and emits change events if necessary
   * Performs diff calculation and triggers event emission for changed entities
   * @param newState - The new state to set
   * @param previousState - Previous state before changes
   * @param origins - Set of origin identifiers for the changes
   */
  private async handleStateChange(newState: EntitiesState, previousState: EntitiesState, origins: Set<string>) {
    const differences = detailedDiff(previousState, newState);
    if (!isEmpty(differences.added) || !isEmpty(differences.updated) || !isEmpty(differences.deleted)) {
      this._state = newState;
      this.cache.clear();
      EntityProxyManager.clearCache();

      await this.emitStateChangeEvents(differences, previousState, newState, Array.from(origins));
    }
  }

  /**
   * Sets a new state by dispatching a setState action
   * Avoids unnecessary updates if the state hasn't changed
   * @param newState - The new state to set
   */
  async setState(newState: EntitiesState) {
    if (this._state === newState) return;
    await this.dispatch(setState(newState), true, this.instanceId);
  }

  /**
   * LRU cache for storing entity data with delete capability
   * Used to improve performance by caching frequently accessed entities
   */
  public readonly cache: LRUCacheWithDelete<string, Record<string, any>> = new LRUCacheWithDelete(1000);

  /**
   * Queue of pending entity actions to be processed
   */
  private readonly _queue: Queue<QueueItem> = new Queue();

  /**
   * Gets the current action queue
   * @returns Array of pending QueueItems
   */
  get queue() {
    return this._queue;
  }

  /**
   * Dispatches entity actions either synchronously or asynchronously
   * Processes actions immediately if sync is true, otherwise queues them
   * @param actions - The entity action(s) to dispatch (can be single action or array)
   * @param sync - Whether to process the action(s) immediately (default: true)
   * @param origin - Optional origin identifier for the action(s)
   * @returns Promise that resolves when processing is complete
   */
  async dispatch(actions: EntityAction | EntityAction[], sync = true, origin?: string): Promise<void> {
    const actionArray = Array.isArray(actions) ? actions : [actions];
    const queueItems = actionArray.map((action) => ({ action, origin }));

    if (sync && !this._processing) {
      await this.processChanges(queueItems);
    } else {
      queueItems.forEach((item) => this._queue.enqueue(item));
    }
  }

  /**
   * Processes queued changes or provided items
   * Applies actions to the state and handles state changes
   * Includes safeguards against excessive processing time
   * @param items - Optional array of QueueItems to process instead of the queue
   * @returns Promise that resolves when processing is complete
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
      const item = Array.isArray(pendingChanges) ? pendingChanges.shift() : pendingChanges.dequeue();
      if (!item) break;
      const { action, origin }: QueueItem = item;
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
   * Supports wildcard event patterns and handles event propagation
   * @param differences - Detailed diff of state changes
   * @param previousState - Previous state before changes
   * @param newState - New state after changes
   * @param origins - Array of origin identifiers for the changes
   * @returns Promise that resolves when all events have been emitted
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
   * Resolves entity references and creates proxies for denormalized entities
   * @param entityName - Name of the entity type
   * @param id - ID of the entity
   * @param denormalizeData - Whether to denormalize the entity data (default: true)
   * @returns The requested entity (denormalized if specified) or null if not found
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

    // Create and return a proxy for the denormalized entity using EntityProxyManager
    return EntityProxyManager.createEntityProxy(entityName, id, denormalized, this);
  }

  /**
   * Clears all entities from the state
   * Dispatches a clearEntities action with this instance as the origin
   */
  clear() {
    this.dispatch(clearEntities(), true, this.instanceId);
  }

  /**
   * Emits events asynchronously to all registered listeners
   * Handles errors in event listeners to prevent propagation
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

  /**
   * Checks if an entity is referenced by any other entities in the state
   * Traverses the relationship map to find references
   * @param entityName - Name of the entity type to check
   * @param entityId - ID of the entity to check
   * @param ignoreReference - Optional reference to ignore during the check
   * @param checkedEntities - Set of already checked entities to prevent circular references
   * @returns Boolean indicating if the entity is referenced
   */
  public isEntityReferenced(
    entityName: string,
    entityId: string,
    ignoreReference?: { entityName: string; fieldName: string },
    checkedEntities: Set<string> = new Set()
  ): boolean {
    // Add current entity to checked set to prevent circular references
    const entityKey = `${entityName}:${entityId}`;
    if (checkedEntities.has(entityKey)) {
      return false;
    }
    checkedEntities.add(entityKey);

    const referenceMap = SchemaManager.relationshipMap[entityName]?._referencedBy;
    if (!referenceMap) return false;

    return Object.entries(referenceMap).some(([referencingEntityName, referencingEntity]) => {
      // Skip if this is the reference we want to ignore
      if (
        ignoreReference &&
        ignoreReference.entityName === referencingEntityName &&
        ignoreReference.fieldName === referencingEntity.fieldName
      ) {
        return false;
      }

      const entities = this.state[referencingEntityName];
      if (!entities) return false;

      // Find any entity that references our target entity
      return Object.keys(entities).some((id) => {
        const entity = entities[id];
        if (!entity || entity[referencingEntity.fieldName] === undefined) return false;

        const hasReference = referencingEntity.isMany
          ? Array.isArray(entity[referencingEntity.fieldName]) && entity[referencingEntity.fieldName].includes(entityId)
          : entity[referencingEntity.fieldName] === entityId;

        if (hasReference) {
          // Check if the referencing entity itself is only referenced by entities we're already checking
          // This handles the cascade deletion case
          return this.isEntityReferenced(referencingEntityName, id, ignoreReference, checkedEntities);
        }

        return false;
      });
    });
  }
}

export default StateManager;
