/**
 * Entity store management module
 *
 * This module provides a Redux reducer and utility functions for managing
 * normalized entity data in a Redux store. It uses immutability-helper
 * to perform immutable updates on the entity state.
 */
import { normalize, Schema } from 'normalizr';
import update, { Spec } from 'immutability-helper';
import { UPDATE_ENTITIES, UPDATE_ENTITIES_PARTIAL, DELETE_ENTITIES, SET_STATE, getSchema } from './actions';
import type { EntityAction, EntityStrategy } from './actions';

/**
 * Represents a single entity's state in the store
 * @typedef {Object} EntityState
 * @property {string|number} [key] - Entity identifier
 * @property {any} [value] - Entity data
 */
export type EntityState = Record<string, any>;

/**
 * Represents the structure of the entities state in the Redux store
 * @typedef {Object} EntitiesState
 * @property {EntityState} [entityType] - Map of entity types to their states
 */
export type EntitiesState = Record<string, Record<string, EntityState>>;

/**
 * Default empty state for the entities reducer
 * @type {EntitiesState}
 */
export const defaultState: EntitiesState = {};

/**
 * Initial state for the entities reducer
 * @type {EntitiesState}
 */
export const initialState: EntitiesState = {};

/**
 * Normalizes entity data using normalizr
 * @template T - The type of data to normalize
 * @param {T|T[]} data - The entity or array of entities to normalize
 * @param {Schema|string} entitySchema - The schema to use for normalization or entity name
 * @returns {EntitiesState} The normalized entities state
 */
export const normalizeEntities = <T>(data: T | T[], entitySchema: Schema | string): EntitiesState => {
  const schema = typeof entitySchema === 'string' ? getSchema(entitySchema) : entitySchema;
  const { entities } = normalize(data, Array.isArray(data) ? [schema] : schema);

  return entities as EntitiesState;
};

/**
 * Creates an update statement for immutability-helper to merge normalized entities into state
 * @param {EntitiesState} state - Current entities state
 * @param {EntitiesState} normalizedEntities - Normalized entities to merge into state
 * @returns {Spec<EntitiesState>} An immutability-helper spec object for updating the state
 */
export const createUpdateStatement = (state: EntitiesState, normalizedEntities: EntitiesState): Spec<EntitiesState> =>
  Object.entries(normalizedEntities).reduce<IndexableSpec<EntitiesState>>((acc, [entityName, entityGroup]) => {
    acc[entityName] = state[entityName]
      ? Object.entries(entityGroup).reduce<IndexableSpec<EntityState>>((subAcc, [entityId, entityData]) => {
          subAcc[entityId] = state[entityName][entityId] ? { $merge: entityData } : { $set: entityData };
          return subAcc;
        }, {} as IndexableSpec<EntityState>)
      : { $set: entityGroup };
    return acc;
  }, {} as IndexableSpec<EntitiesState>);

/**
 * Handles updating entities with different strategies
 * @param {EntitiesState} state - Current entities state
 * @param {EntityState} entities - Entities to update
 * @param {EntityStrategy} [strategy='$merge'] - Strategy to use for the update
 * @returns {Spec<EntitiesState>} An immutability-helper spec object for updating the state
 */
export const handleUpdateEntities = (
  state: EntitiesState,
  entities: EntityState,
  strategy: EntityStrategy = '$merge'
): Spec<EntitiesState> =>
  Object.entries(entities).reduce<IndexableSpec<EntitiesState>>((acc, [entityName, entityGroup]) => {
    switch (strategy) {
      case '$replace':
        acc[entityName] = replaceStrategy(entityGroup);
        break;
      case '$set':
        acc[entityName] = setStrategy(entityGroup, state[entityName]);
        break;
      case '$merge':
        acc[entityName] = mergeStrategy(state, entityName, entityGroup);
        break;
      case '$unset':
        acc[entityName] = unsetStrategy(entityGroup);
        break;
      case '$push':
      case '$unshift':
        acc[entityName] = arrayOperation(state[entityName], entityGroup, strategy);
        break;
      case '$splice':
        acc[entityName] = spliceStrategy(entityGroup);
        break;
      case '$apply':
        acc[entityName] = applyStrategy(entityGroup);
        break;
      default:
        throw new Error(`Invalid strategy: ${strategy}`);
    }

    return acc;
  }, {} as IndexableSpec<EntitiesState>);

/**
 * Creates a spec for deleting entities from the state
 * @param {EntitiesState} state - Current entities state
 * @param {EntitiesState} entities - Entities to delete
 * @returns {Spec<EntitiesState>} An immutability-helper spec object for deleting entities
 */
export const handleDeleteEntities = (state: EntitiesState, entities: EntitiesState): Spec<EntitiesState> =>
  Object.fromEntries(
    Object.entries(entities).map(([entityName, entityGroup]) => {
      const entityIds = Object.keys(entityGroup);

      return [
        entityName,
        {
          $unset: entityIds
        }
      ];
    })
  );

/**
 * Applies the $replace strategy to an entity group
 * Completely replaces each entity with new data
 * @param {EntityState} entityGroup - Group of entities to replace
 * @returns {Spec<EntitiesState>} An immutability-helper spec for the replace operation
 */
const replaceStrategy = (entityGroup: EntityState): Spec<EntitiesState> =>
  Object.entries(entityGroup).reduce<IndexableSpec<EntityState>>((acc, [entityId, entityData]) => {
    acc[entityId] = { $set: entityData };
    return acc;
  }, {} as IndexableSpec<EntityState>);

/**
 * Applies the $set strategy to an entity group
 * Sets specific fields in each entity
 * @param {EntityState} entityGroup - Group of entities to update
 * @param {EntityState} [stateArray] - Current state of the entity group
 * @returns {Spec<EntitiesState>} An immutability-helper spec for the set operation
 */
const setStrategy = (entityGroup: EntityState, stateArray?: EntityState): Spec<EntitiesState> =>
  Object.entries(entityGroup).reduce<IndexableSpec<EntityState>>((acc, [entityId, entityData]) => {
    acc[entityId] = acc[entityId] || {};

    Object.entries(entityData as EntityState).forEach(([fieldName, fieldValue]) => {
      // Skip processing if the value is the entityId
      if (fieldValue === entityId) {
        return;
      }
      acc[entityId][fieldName] = { $set: fieldValue };
    });

    return acc;
  }, {} as IndexableSpec<EntityState>);

/**
 * Applies the $merge strategy to an entity group
 * Merges new data with existing entity data
 * @param {EntitiesState} state - Current entities state
 * @param {string} entityName - Name of the entity type
 * @param {EntityState} entityGroup - Group of entities to merge
 * @returns {Spec<EntitiesState>} An immutability-helper spec for the merge operation
 */
const mergeStrategy = (state: EntitiesState, entityName: string, entityGroup: EntityState): Spec<EntitiesState> => ({
  ...(createUpdateStatement(state, { [entityName]: entityGroup }) as IndexableSpec<EntitiesState>)[entityName]
});

/**
 * Applies the $unset strategy to an entity group
 * Removes specified fields from entities
 * @param {EntityState} entityGroup - Group of entities with fields to unset
 * @returns {Spec<EntitiesState>} An immutability-helper spec for the unset operation
 */
const unsetStrategy = (entityGroup: EntityState): Spec<EntitiesState> => {
  return Object.entries(entityGroup).reduce<IndexableSpec<EntityState>>((acc, [entityId, entityData]) => {
    acc[entityId] = acc[entityId] || {};
    acc[entityId].$unset = acc[entityId].$unset || [];
    // Filter out fields where value matches entityId
    acc[entityId].$unset = [
      ...acc[entityId].$unset,
      ...Object.entries(entityData)
        .filter(([_, value]) => value !== entityId)
        .map(([key]) => key)
    ];

    return acc;
  }, {} as IndexableSpec<EntityState>);
};

/**
 * Applies array operations ($push or $unshift) to entity fields
 * @param {EntityState} stateArray - Current state of the entity group
 * @param {EntityState} entityGroup - Group of entities with array operations
 * @param {EntityStrategy} operation - The array operation to perform ($push or $unshift)
 * @returns {Spec<EntitiesState>} An immutability-helper spec for the array operation
 * @throws {Error} If the target field is not an array
 */
const arrayOperation = (
  entityState: EntityState,
  entityGroup: EntityState,
  operation: EntityStrategy
): Spec<EntitiesState> =>
  Object.entries(entityGroup).reduce<IndexableSpec<EntityState>>((acc, [entityId, entity]) => {
    Object.entries(entity).forEach(([fieldName, value]) => {
      // Skip processing the id field
      if (entityId === value) {
        return;
      }

      const currentArray = entityState[entityId][fieldName] ?? [];
      if (!Array.isArray(currentArray)) {
        throw new Error(`Expected array for ${operation} operation on entityId '${entityId}.${fieldName}'`);
      }

      acc[entityId] = acc[entityId] || {};
      acc[entityId][fieldName] = { [operation]: Array.isArray(value) ? value : [value] };
    });
    return acc;
  }, {} as IndexableSpec<EntityState>);

/**
 * Applies the $splice strategy to an entity group
 * Performs splice operations on array fields
 * @param {EntityState} entityGroup - Group of entities with fields to splice
 * @returns {Spec<EntitiesState>} An immutability-helper spec for the splice operation
 */
const spliceStrategy = (entityGroup: EntityState): { [key: string]: { [key: string]: { $splice: any[] } } } =>
  Object.fromEntries(
    Object.entries(entityGroup).map(([entityId, entity]) => [
      entityId,
      Object.fromEntries(
        Object.entries(entity)
          .filter(([_, value]) => value !== entityId)
          .map(([fieldName, value]) => {
            if (!Array.isArray(value)) {
              throw new Error(`Expected array for $splice operation on entityId '${entityId}.${fieldName}'`);
            }
            return [fieldName, { $splice: value }];
          })
      )
    ])
  );

/**
 * Applies the $apply strategy to an entity group
 * Applies a function to transform entity values
 * @param {EntityState} entityGroup - Group of entities with fields to transform
 * @returns {Spec<EntitiesState>} An immutability-helper spec for the apply operation
 */
const applyStrategy = (entityGroup: EntityState): Spec<EntitiesState> =>
  Object.fromEntries(
    Object.entries(entityGroup).map(([entityId, entity]) => [
      entityId,
      typeof entity === 'function'
        ? { $apply: entity as (original: any) => any }
        : Object.fromEntries(
            Object.entries(entity)
              .filter(([_, value]) => value !== entityId)
              .map(([key, value]) => [key, { $apply: value as (original: any) => any }])
          )
    ])
  );

/**
 * Reducer function for the entities state
 * Handles various entity-related actions
 * @param {EntitiesState} [state=initialState] - Current entities state
 * @param {EntityAction} action - Action to process
 * @returns {EntitiesState} Updated entities state
 */
export function reducer(state: EntitiesState = initialState, action: EntityAction): EntitiesState {
  const { entities = {}, strategy } = action;

  switch (action.type) {
    case UPDATE_ENTITIES:
    case UPDATE_ENTITIES_PARTIAL: {
      return update(state, handleUpdateEntities(state, entities, strategy));
    }
    case DELETE_ENTITIES: {
      return update(state, handleDeleteEntities(state, entities));
    }
    case SET_STATE: {
      return update(state, {
        $set: entities
      });
    }
    default: {
      return state;
    }
  }
}

/**
 * Extension of the immutability-helper Spec type that allows for indexable properties
 * Used for building dynamic update specs
 * @typedef {Object} IndexableSpec
 * @template T - The type of the spec
 */
export type IndexableSpec<T> = Spec<T> & {
  [key: string]: any;
};

export default reducer;
