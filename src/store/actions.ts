import { normalize, Schema } from 'normalizr';
import { SchemaManager } from '../store/SchemaManager';

import type { EntitiesState } from './entities';

/**
 * Normalizes entity data using normalizr
 *
 * @template T - The type of data to normalize
 * @param {T | T[]} data - The entity or array of entities to normalize
 * @param {Schema | string} entitySchema - The schema to use for normalization or entity name
 * @returns {EntitiesState} - The normalized entities state
 */
export const normalizeEntities = <T>(data: T | T[], entitySchema: Schema | string): EntitiesState => {
  const schema = typeof entitySchema === 'string' ? getSchema(entitySchema) : entitySchema;
  const { entities } = normalize(data, Array.isArray(data) ? [schema] : schema);

  return entities as EntitiesState;
};

/**
 * Action type for entity operations
 *
 * @typedef {Object} EntityAction
 * @property {string} type - The action type
 * @property {Record<string | number, any>} [entity] - The entity object
 * @property {EntitiesState} [entities] - The entities state
 * @property {string} [entityId] - The entity ID
 * @property {string} [entityName] - The entity name/type
 * @property {EntityStrategy} [strategy] - The update strategy to apply
 * @property {any} [value] - Any extra value for a specific update operation
 */
export type EntityAction = {
  type: string;
  entity?: Record<string | number, any>;
  entities?: EntitiesState;
  entityId?: string;
  entityName?: string;
  strategy?: EntityStrategy;
  value?: any; // This if any extra value for a specific update operation
};

/**
 * Strategy types for entity operations
 *
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
  | '$replace'
  | '$set'
  | '$merge'
  | '$unset'
  | '$push'
  | '$unshift'
  | '$splice'
  | '$apply'
  | '$toggle'
  | '$add'
  | '$remove';

/** Action type for upserting a single entity */
export const UPDATE_ENTITY = 'entities.upsertEntity';
/** Action type for upserting multiple entities */
export const UPDATE_ENTITIES = 'entities.upsertEntities';
/** Action type for partially updating an entity */
export const PARTIAL_UPDATE_ENTITY = 'entities.partialUpdate';
/** Action type for deleting a single entity */
export const DELETE_ENTITY = 'entities.deleteEntity';
/** Action type for deleting multiple entities */
export const DELETE_ENTITIES = 'entities.deleteEntities';
/** Action type for clearing all entities */
export const CLEAR_ENTITIES = 'entities.clearEntities';
/** Action type for setting the entire entities state */
export const SET_STATE = 'entities.setState';

/**
 * Creates an action to update a single entity
 *
 * @param {Record<string | number, any>} entity - The entity to update
 * @param {string} entityName - The entity type/name
 * @returns {EntityAction} - The update entity action
 */
export const updateEntity = (entity: Record<string | number, any>, entityName: string): EntityAction =>
  updateNormalizedEntities(normalize(entity, getSchema(entityName)).entities as EntitiesState);

/**
 * Creates an action to update multiple entities
 *
 * @param {any[]} entities - The entities to update
 * @param {string} entityName - The entity type/name
 * @returns {EntityAction} - The update entities action
 */
export const updateEntities = (entities: any[], entityName: string): EntityAction =>
  updateNormalizedEntities(normalize(entities, getSchema(entityName)).entities as EntitiesState);

/**
 * Creates an action to partially update an entity
 *
 * @param {string} entityName - The entity type/name
 * @param {string} entityId - The ID of the entity to update
 * @param {EntitiesState} entities - The entity data to update
 * @param {EntityStrategy} [strategy='$merge'] - The update strategy to apply
 * @returns {EntityAction} - The partial update entity action
 */
export const partialUpdateEntity = (
  entityName: string,
  entityId: string,
  entities: EntitiesState,
  strategy: EntityStrategy = '$merge'
): EntityAction => ({
  type: PARTIAL_UPDATE_ENTITY,
  entityName,
  entityId,
  entities,
  strategy
});

/**
 * Creates an action to delete a single entity
 *
 * @param {string} entityId - The ID of the entity to delete
 * @param {string} entityName - The entity type/name
 * @returns {EntityAction} - The delete entity action
 */
export const deleteEntity = (entityId: string, entityName: string): EntityAction => ({
  type: DELETE_ENTITY,
  entityId,
  entityName
});

/**
 * Creates an action to delete multiple entities
 *
 * @param {EntitiesState} entities - The entities to delete
 * @param {string} entityName - The entity type/name
 * @returns {EntityAction} - The delete entities action
 */
export const deleteEntities = (entities: EntitiesState, entityName: string): EntityAction =>
  deleteNormalizedEntities(normalizeEntities(entities, entityName));

/**
 * Creates an action to clear all entities
 *
 * @returns {EntityAction} - The clear entities action
 */
export const clearEntities = (): EntityAction => ({
  type: CLEAR_ENTITIES
});

/**
 * Creates an action to set the entire entities state
 *
 * @param {EntitiesState} [entities={}] - The entities state to set
 * @returns {EntityAction} - The set state action
 */
export const setState = (entities: EntitiesState = {}): EntityAction => ({
  type: SET_STATE,
  entities
});

/**
 * Creates an action to update a single normalized entity
 *
 * @param {Record<string | number, any>} entity - The normalized entity to update
 * @param {string} entityName - The entity type/name
 * @returns {EntityAction} - The update normalized entity action
 */
export const updateNormalizedEntity = (entity: Record<string | number, any>, entityName: string): EntityAction => ({
  type: UPDATE_ENTITY,
  entity,
  entityName
});

/**
 * Creates an action to update multiple normalized entities
 *
 * @param {EntitiesState} entities - The normalized entities to update
 * @param {EntityStrategy} [strategy='$merge'] - The update strategy to apply
 * @returns {EntityAction} - The update normalized entities action
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
 * Alias for deleteEntity
 */
export const deleteNormalizedEntity = deleteEntity;

/**
 * Creates an action to delete multiple normalized entities
 *
 * @param {EntitiesState} entities - The normalized entities to delete
 * @returns {EntityAction} - The delete normalized entities action
 */
export const deleteNormalizedEntities = (entities: EntitiesState): EntityAction => ({
  type: DELETE_ENTITIES,
  entities
});

/**
 * Gets a schema by entity name from the SchemaManager
 *
 * @param {string} entityName - The entity type/name
 * @returns {Schema} - The schema for the entity
 * @throws {Error} - If the schema is not found
 */
function getSchema(entityName: string): Schema {
  const schemas = SchemaManager.getInstance().getSchemas();
  const schema = schemas[entityName];
  if (!schema) {
    throw new Error(`Schema for ${entityName} not found.`);
  }
  return schema;
}

export default {
  updateEntity,
  updateEntities,
  partialUpdateEntity,
  deleteEntity,
  deleteEntities,
  clearEntities,
  setState,
  updateNormalizedEntity,
  updateNormalizedEntities,
  deleteNormalizedEntity,
  deleteNormalizedEntities
};
