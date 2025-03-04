import { defaultState } from './entities';
import type { EntitiesState, EntityState } from './entities';

import { normalize } from 'normalizr';
import { EnhancedEntity, SchemaManager } from '../store/SchemaManager';

/**
 * Action type for entity operations
 * @typedef {Object} EntityAction
 * @property {string} type - The action type
 * @property {EntitiesState} entities - The entities state
 * @property {EntityStrategy} [strategy] - The update strategy to apply
 */
export type EntityAction = {
  type: string;
  entities: EntitiesState;
  strategy?: EntityStrategy;
};

/**
 * Strategy types for entity operations
 * @typedef {string} EntityStrategy
 * @property {'$replace'} $replace - Replace the entire entity
 * @property {'$set'} $set - Set specific properties
 * @property {'$merge'} $merge - Merge with existing properties
 * @property {'$unset'} $unset - Remove specific properties
 * @property {'$push'} $push - Add items to the end of an array
 * @property {'$unshift'} $unshift - Add items to the beginning of an array
 * @property {'$splice'} $splice - Remove/replace items in an array
 * @property {'$apply'} $apply - Apply a function to transform a value
 * @property {'$toggle'} $toggle - Toggle boolean values
 * @property {'$add'} $add - Add items to a collection
 * @property {'$remove'} $remove - Remove items from a collection
 */
export type EntityStrategy =
  | '$replace' // Replace the entire entity
  | '$set' // Set specific properties
  | '$merge' // Merge with existing properties
  | '$unset' // Remove specific properties
  | '$push' // Add items to the end of an array
  | '$unshift' // Add items to the beginning of an array
  | '$splice' // Remove/replace items in an array
  | '$apply' // Apply a function to transform a value
  | '$toggle' // Toggle boolean values
  | '$add' // Add items to a collection
  | '$remove'; // Remove items from a collection

/** Action type for upserting multiple entities */
export const UPDATE_ENTITIES = 'entities.upsertEntities';
/** Action type for partially updating entities */
export const UPDATE_ENTITIES_PARTIAL = 'entities.partialUpdates';
/** Action type for deleting multiple entities */
export const DELETE_ENTITIES = 'entities.deleteEntities';
/** Action type for setting the entire entities state */
export const SET_STATE = 'entities.setState';

export const actionNames = {
  UPDATE_ENTITIES,
  UPDATE_ENTITIES_PARTIAL,
  DELETE_ENTITIES,
  SET_STATE
};

/**
 * Creates an action to update a single entity
 * @param {EntityState} entity - The entity to update
 * @param {string} entityName - The entity type/name
 * @returns {EntityAction} An action object for updating the entity
 */
export const updateEntity = (entity: EntityState, entityName: string): EntityAction =>
  updateEntities([entity], entityName);

/**
 * Creates an action to partially update an entity
 * @param {EntityState} entity - The entity to update
 * @param {string} entityName - The entity type/name
 * @param {EntityStrategy} [strategy='$merge'] - The update strategy to apply
 * @returns {EntityAction} An action object for partially updating the entity
 */
export const updateEntityPartial = (
  entity: EntityState,
  entityName: string,
  strategy: EntityStrategy = '$merge'
): EntityAction => updateEntitiesPartial([entity], entityName, strategy);

/**
 * Creates an action to update multiple entities
 * @param {EntityState[]} entities - Array of entities to update
 * @param {string} entityName - The entity type/name
 * @returns {EntityAction} An action object for updating multiple entities
 */
export const updateEntities = (entities: EntityState[], entityName: string): EntityAction =>
  updateNormalizedEntities(
    normalize(Array.isArray(entities) ? entities : [entities], [getSchema(entityName)]).entities as EntitiesState
  );

/**
 * Creates an action to partially update multiple entities
 * @param {EntityState[]} entities - Array of entities to update
 * @param {string} entityName - The entity type/name
 * @param {EntityStrategy} [strategy='$merge'] - The update strategy to apply
 * @returns {EntityAction} An action object for partially updating multiple entities
 */
export const updateEntitiesPartial = (
  entities: EntityState[],
  entityName: string,
  strategy: EntityStrategy = '$merge'
): EntityAction => ({
  type: UPDATE_ENTITIES_PARTIAL,
  entities: normalize(Array.isArray(entities) ? entities : [entities], [getSchema(entityName)])
    .entities as EntitiesState,
  strategy
});

/**
 * Creates an action to delete a single entity
 * @param {EntityState} entity - The entity to delete
 * @param {string} entityName - The entity type/name
 * @returns {EntityAction} An action object for deleting the entity
 */
export const deleteEntity = (entity: EntityState, entityName: string): EntityAction =>
  deleteEntities([entity], entityName);

/**
 * Creates an action to delete multiple entities
 * @param {any[]} entities - Array of entities to delete
 * @param {string} entityName - The entity type/name
 * @returns {EntityAction} An action object for deleting multiple entities
 */
export const deleteEntities = (entities: any[], entityName: string): EntityAction =>
  deleteNormalizedEntities(normalize(entities, [getSchema(entityName)]).entities as EntitiesState);

/**
 * Creates an action to update multiple normalized entities
 * @param {EntitiesState} entities - The normalized entities to update
 * @param {EntityStrategy} [strategy='$merge'] - The update strategy to apply
 * @returns {EntityAction} An action object for updating normalized entities
 */
export const updateNormalizedEntities = (
  entities: EntitiesState,
  strategy: EntityStrategy = '$merge'
): EntityAction => ({
  type: UPDATE_ENTITIES,
  entities,
  strategy
});

/**
 * Creates an action to delete multiple normalized entities
 * @param {EntitiesState} entities - The normalized entities to delete
 * @returns {EntityAction} An action object for deleting normalized entities
 */
export const deleteNormalizedEntities = (entities: EntitiesState): EntityAction => ({
  type: DELETE_ENTITIES,
  entities
});

/**
 * Creates an action to clear all entities
 * @param {EntitiesState} [entities={...defaultState}] - Optional entities state to set after clearing
 * @returns {EntityAction} An action object for clearing all entities
 */
export const clearEntities = (entities = { ...defaultState }): EntityAction => ({
  type: SET_STATE,
  entities
});

/**
 * Creates an action to set the entire entities state
 * @param {EntitiesState} [entities={}] - The entities state to set
 * @returns {EntityAction} An action object for setting the entire entities state
 */
export const setState = (entities: EntitiesState = {}): EntityAction => ({
  type: SET_STATE,
  entities
});

/**
 * Gets a schema by entity name from the SchemaManager
 * @param {string} entityName - The entity type/name
 * @returns {EnhancedEntity} The schema for the entity
 * @throws {Error} If the schema is not found
 */
export function getSchema(entityName: string): EnhancedEntity {
  const schemas = SchemaManager.getInstance().getSchemas();
  const schema = schemas[entityName];
  if (!schema) {
    throw new Error(`Schema for ${entityName} not found.`);
  }
  return schema;
}

export default {
  actionNames,
  getSchema,
  setState,
  updateEntity,
  updateEntities,
  deleteEntity,
  deleteEntities,
  clearEntities,
  updateEntityPartial,
  updateEntitiesPartial,
  updateNormalizedEntities,
  deleteNormalizedEntities
};
