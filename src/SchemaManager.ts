import { schema as NormalizrSchema, normalize, denormalize } from 'normalizr';
import type { Schema as NormalizrSchemaType } from 'normalizr';
import EventEmitter from 'eventemitter3'; // Import EventEmitter
import reducer, { EntitiesState, EntityAction } from './utils/entities'; // Import the reducer and initialState
import { DetailedDiff, detailedDiff } from 'deep-object-diff'; // Assuming a library for detailed diff calculation
import { isEmpty } from 'lodash'; // Assuming lodash for utility functions
import isObject from 'lodash.isobject';
import { limitRecursion } from './utils/limitRecursion'; // Import the limitRecursion function

type SchemaDefinition = {
  idAttribute?: string | ((entity: any, parent?: any, key?: string) => any);
} & Record<string, string | [string]>;

/**
 * Example usage
 *
 * ```typescript
 * import SchemaManager from './SchemaManager';
 *
 * const schemaConfig = {
 *   User: {
 *     idAttribute: 'username',
 *     articles: 'Article'
 *   },
 *   Article: {
 *     author: 'User',
 *     comments: ['Comment']
 *   },
 *   Comment: {
 *     commenter: 'User'
 *   }
 * };
 *
 * const schemaManager = SchemaManager.getInstance();
 * schemaManager.setSchemas(schemaConfig);
 *
 * const userSchema = schemaManager.getSchema('User');
 *
 * // Subscribe to changes for a specific entity path
 * SchemaManager.on('User.user1', ({ newState, previousState, changes }) => {
 *   console.log('User entity "user1" has changed!', { changes });
 * });
 *
 * // Dispatch an action
 * SchemaManager.dispatch({
 *   type: 'entities.upsertEntity',
 *   entityName: 'User',
 *   entity: { id: 'user1', name: 'John Doe' }
 * });
 * ```
 */
export class SchemaManager extends EventEmitter {
  private static instance: SchemaManager;
  private schemas: { [key: string]: NormalizrSchema.Entity } = {};
  private state: EntitiesState = {}; // Holds the current state
  private iteration: number = 0; // Tracks the number of state changes
  private queue: EntityAction[] = []; // Queue to hold actions
  private processing = false; // Indicates if the processing loop is running

  private constructor() {
    super();
  }

  /**
   * Sets schemas based on the provided configuration.
   * @param schemaConfig The schema configuration to set.
   */
  setSchemas(schemaConfig: { [key: string]: SchemaDefinition }): void {
    this.schemas = this.createSchemas(schemaConfig);
  }

  /**
   * Retrieves all schemas.
   * @returns The current schemas.
   */
  getSchemas(): { [key: string]: NormalizrSchema.Entity } {
    return this.schemas;
  }

  /**
   * Retrieves a specific schema by name.
   * @param schemaName The name of the schema to retrieve.
   * @returns The schema.
   */
  getSchema(schemaName: string): NormalizrSchema.Entity {
    if (!this.schemas[schemaName]) {
      throw new Error(`Schema ${schemaName} not defined!`);
    }
    return this.schemas[schemaName];
  }

  /**
   * Clears all schemas.
   */
  clearSchemas(): void {
    this.schemas = {};
  }

  /**
   * Asynchronously dispatches an action to update the state.
   * @param action The action to dispatch.
   */
  async dispatch(action: EntityAction): Promise<void> {
    this.queue.push(action); // Queue the action

    if (!this.processing) {
      this.processing = true; // Mark processing as in progress
      await this.processActions(); // Start processing the queue
    }
  }

  /**
   * Processes actions from the queue in a synchronous loop.
   */
  private async processActions(): Promise<void> {
    let newState = this.state;

    while (this.queue.length > 0) {
      // Splice the items in the queue right NOW to a locally scoped variable
      const actionsToProcess = this.queue.splice(0, this.queue.length);

      // Reduce over the spliced actions to compute the new state
      for (const action of actionsToProcess) {
        // Normalize the entity before sending it to reducer
        const { entity, entityName, ...rest } = action;
        const schema = this.schemas[entityName as string];
        const normalizedEntity = normalize(entity, schema);

        newState = reducer(newState, { ...rest, entity: normalizedEntity });
      }
    }

    // Check for differences between the current state and the new state
    const differences = detailedDiff(this.state, newState);

    if (!isEmpty(differences.added) || !isEmpty(differences.updated) || !isEmpty(differences.deleted)) {
      // Loop over the changes and emit events for subscribed paths
      this.emitStateChangeEvents(differences, this.state, newState);

      // Update the state and increment the iteration count
      this.iteration++;
      this.state = { ...newState }; // Update state with new iteration
    }

    this.processing = false; // Mark processing as complete
  }

  /**
   * Emits state change events for specific paths.
   * @param differences The differences between the old and new state.
   * @param previousState The previous state.
   * @param newState The new state.
   */
  private emitStateChangeEvents(differences: DetailedDiff, previousState: EntitiesState, newState: EntitiesState): void {
    const changedPaths = ['added', 'updated', 'deleted'] as const;

    changedPaths.forEach((changeType) => {
      const entities = differences[changeType];
      Object.entries(entities).forEach(([entityName, entityChanges]) => {
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
   * Returns the current state.
   * @returns The current state.
   */
  getState(): EntitiesState {
    return this.state;
  }

  /**
   * Sets the current state.
   * @param state The new state to set.
   */
  setState(newState: EntitiesState): void {
    const previousState = this.state;
    this.state = newState;
    this.emit('stateChange', { newState, previousState, differences: detailedDiff(previousState, newState) });
  }

  /**
   * Returns denormalized data for a given entity name and ID.
   * @param entityName The name of the entity to query.
   * @param id The ID of the entity to query.
   * @returns The denormalized data.
   */
  query(entityName: string, id: string): any {
    const entity = this.state.entities[entityName]?.[id];
    if (!entity) {
      return null;
    }
    const denormalizedData = denormalize(id, this.schemas[entityName], this.state.entities);
    return limitRecursion(denormalizedData, this.schemas[entityName]);
  }

  // Creates schemas dynamically based on the configuration provided
  private createSchemas(schemaConfig: { [key: string]: SchemaDefinition }): {
    [key: string]: NormalizrSchema.Entity;
  } {
    const schemas: { [key: string]: NormalizrSchema.Entity } = {};

    // First pass: Create schema entities without relationships
    for (const [name, definition] of Object.entries(schemaConfig)) {
      const { idAttribute, ...relationships } = definition;

      schemas[name] = new NormalizrSchema.Entity(
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
   * Returns the singleton instance of SchemaManager.
   * @returns The SchemaManager instance.
   */
  public static getInstance(): SchemaManager {
    if (!this.instance) {
      this.instance = new SchemaManager();
    }
    return this.instance;
  }
}

export default SchemaManager.getInstance();
