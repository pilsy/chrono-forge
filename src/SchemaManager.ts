import EventEmitter from 'eventemitter3';
import { normalize, denormalize, schema } from 'normalizr';
import {
  EntitiesState,
  EntityAction,
  reducer,
  updateNormalizedEntity,
  updateNormalizedEntities,
  deleteNormalizedEntity,
  deleteNormalizedEntities,
  normalizeEntities,
  clearEntities
} from './utils/entities';
import { DetailedDiff, detailedDiff } from 'deep-object-diff';
import { isEmpty, cloneDeep } from 'lodash';
import { limitRecursion } from './utils/limitRecursion';

/**
 * Types for defining schemas and managing entities.
 */
export type SchemasDefinition = {
  [schemaName: string]: SchemaDefinition;
};

export type SchemaDefinition = {
  idAttribute?: string | ((entity: any, parent?: any, key?: string) => any);
} & Record<string, string | [string]>;

/**
 * Singleton class to manage schemas, entities, and provide undo/redo functionality.
 * This class is responsible for setting up schemas using Normalizr, managing state updates,
 * handling undo and redo operations, and providing event-driven notifications for state changes.
 */
export class SchemaManager extends EventEmitter {
  private static instance: SchemaManager;

  /**
   * Returns the singleton instance of SchemaManager.
   * @returns The SchemaManager instance.
   */
  public static getInstance(): SchemaManager {
    if (!this.instance) {
      this.instance = new SchemaManager();
    }
    return this.instance;
  }

  private schemas: { [key: string]: schema.Entity } = {};
  private state: EntitiesState = {};
  private processing = false;
  private queue: EntityAction[] = [];

  get pendingChanges() {
    return this.queue;
  }

  // Undo/Redo History Management
  private history: EntitiesState[] = []; // History stack for undo operations
  private future: EntitiesState[] = []; // Future stack for redo operations
  private maxHistory = 50; // Limit to keep the history stack manageable

  /**
   * Private constructor to enforce singleton pattern.
   */
  private constructor() {
    super();
  }

  /**
   * Gets the maximum size of the undo history stack.
   */
  get maxHistorySize() {
    return this.maxHistory;
  }

  /**
   * Sets the maximum size of the undo history stack.
   * Ensures the max size is within a valid range (0-500).
   * @param maxHistorySize The new maximum history size.
   */
  set maxHistorySize(maxHistorySize) {
    this.maxHistory = maxHistorySize >= 0 && maxHistorySize < 500 ? maxHistorySize : 50;
    this.history.length = this.history.length > this.maxHistory ? this.maxHistory : this.history.length;
  }

  /**
   * Sets schemas based on the provided configuration.
   * @param schemaConfig The schema configuration to set.
   * @returns The current schemas.
   */
  setSchemas(schemaConfig: { [key: string]: SchemaDefinition }): typeof this.schemas {
    this.schemas = this.createSchemas(schemaConfig);
    return this.schemas;
  }

  /**
   * Retrieves all schemas.
   * @returns The current schemas.
   */
  getSchemas(): { [key: string]: schema.Entity } {
    return this.schemas;
  }

  /**
   * Retrieves a specific schema by name.
   * @param schemaName The name of the schema to retrieve.
   * @returns The schema.
   * @throws Error if the schema is not defined.
   */
  getSchema(schemaName: string): schema.Entity {
    if (!this.schemas[schemaName]) {
      throw new Error(`Schema ${schemaName} not defined!`);
    }
    return this.schemas[schemaName];
  }

  /**
   * Asynchronously dispatches an action to update the state.
   * This function handles the action queue and ensures that actions are processed sequentially.
   * @param action The action to dispatch.
   */
  async dispatch(action: EntityAction, sync = true): Promise<void> {
    this.queue.push(action); // Queue the action

    if (sync && !this.processing) {
      this.processing = true; // Mark processing as in progress
      await this.processChanges(); // Start processing the queue
    }
  }

  /**
   * Processes actions from the queue in a synchronous loop.
   * Handles state changes, history management for undo/redo, and event emission for state changes.
   */
  async processChanges(): Promise<void> {
    const previousState = this.state;

    let newState;
    while (this.pendingChanges.length > 0) {
      const change = this.pendingChanges.shift();
      newState = reducer(newState || this.state, change as EntityAction);
    }

    if (newState) {
      const differences = detailedDiff(this.state, newState);
      if (!isEmpty(differences.added) || !isEmpty(differences.updated) || !isEmpty(differences.deleted)) {
        this.pushToHistory(previousState);
        this.future.length = 0;
        this.state = { ...newState };

        this.emitStateChangeEvents(differences, previousState, newState);
      }
    }

    this.processing = false;
  }

  /**
   * Emits state change events for specific paths.
   * Also emits a generic event for all state changes.
   * @param differences The differences between the old and new state.
   * @param previousState The previous state.
   * @param newState The new state.
   */
  private emitStateChangeEvents(differences: DetailedDiff, previousState: EntitiesState, newState: EntitiesState): void {
    const changedPaths = ['added', 'updated', 'deleted'] as const;

    changedPaths.forEach((changeType) => {
      const entities = differences[changeType];
      if (!entities || typeof entities !== 'object') return; // Ensure entities is defined and is an object

      Object.entries(entities).forEach(([entityName, entityChanges]) => {
        if (!entityChanges || typeof entityChanges !== 'object') return; // Ensure entityChanges is defined and is an object

        Object.keys(entityChanges).forEach((entityId) => {
          const path = `${entityName}.${entityId}`;
          if (this.listenerCount(path) > 0) {
            this.emit(path, { newState, previousState, changes: entityChanges[entityId] });
          }
        });
      });
    });

    // Emit a generic event for all state changes
    this.emit('stateChange', { newState, previousState, differences });
  }

  /**
   * Pushes the current state to the history stack for undo capability.
   * Ensures the history size does not exceed the max history size.
   * @param currentState The current state to save.
   */
  private pushToHistory(currentState: EntitiesState): void {
    if (this.history.length >= this.maxHistorySize) {
      this.history.shift(); // Remove the oldest state if the history size exceeds the limit
    }
    this.history.push(cloneDeep(currentState));
  }

  /**
   * Performs an undo operation, reverting the state to the previous state.
   * Moves the current state to the future stack for potential redo.
   */
  async undo(): Promise<void> {
    if (this.history.length === 0) {
      console.warn('No more states to undo.');
      return;
    }

    this.future.push(cloneDeep(this.state)); // Save the current state for redo
    const previousState = this.history.pop(); // Get the last state from the history
    if (previousState) {
      this.setState(previousState);
    }
  }

  /**
   * Performs a redo operation, moving the state forward to the next state.
   * Moves the current state to the history stack for potential undo.
   */
  async redo(): Promise<void> {
    if (this.future.length === 0) {
      console.warn('No more states to redo.');
      return;
    }

    this.pushToHistory(this.state); // Save the current state for undo
    const nextState = this.future.pop(); // Get the next state from the future
    if (nextState) {
      this.setState(nextState);
    }
  }

  /**
   * Returns denormalized data for a given entity name and ID.
   * Ensures that the data respects the schema relationships.
   * @param entityName The name of the entity to query.
   * @param id The ID of the entity to query.
   * @returns The denormalized data.
   */
  query(entityName: string, id: string): any {
    const entity = this.state[entityName]?.[id];
    if (!entity) {
      return null;
    }
    const denormalizedData = denormalize(id, this.schemas[entityName], this.state);
    return limitRecursion(denormalizedData, this.schemas[entityName]);
  }

  /**
   * Creates schemas dynamically based on the configuration provided.
   * Supports defining relationships between schemas.
   * @param schemaConfig The schema configuration.
   * @returns The created schemas.
   */
  private createSchemas(schemaConfig: SchemasDefinition) {
    const schemas: { [key: string]: schema.Entity } = {};

    // First pass: Create schema entities without relationships
    for (const [name, definition] of Object.entries(schemaConfig)) {
      const { idAttribute, ...relationships } = definition;

      schemas[name] = new schema.Entity(
        name,
        {},
        {
          idAttribute: typeof idAttribute === 'string' || typeof idAttribute === 'function' ? idAttribute : 'id'
        }
      );
    }

    // Second pass: Define relationships
    for (const [name, definition] of Object.entries(schemaConfig)) {
      const { idAttribute, ...relationships } = definition;
      const entitySchema = schemas[name];

      Object.entries(relationships).forEach(([relationKey, relationValue]) => {
        if (typeof relationValue === 'string') {
          entitySchema.define({ [relationKey]: schemas[relationValue] });
        } else if (Array.isArray(relationValue)) {
          entitySchema.define({ [relationKey]: [schemas[relationValue[0]]] });
        }
      });
    }

    return schemas;
  }

  /**
   * Clears all entities in the state.
   * Dispatches a clear entities action.
   */
  clearState() {
    this.dispatch(clearEntities());
  }

  /**
   * Gets the current state.
   * @returns The current state.
   */
  getState(): EntitiesState {
    return this.state;
  }

  /**
   * Sets the current state.
   * Emits a state change event.
   * @param newState The new state to set.
   */
  setState(newState: EntitiesState): void {
    const previousState = this.state;
    this.state = newState;
    this.emit('stateChange', { newState, previousState, differences: detailedDiff(previousState, newState) });
  }
}

export default SchemaManager.getInstance();
