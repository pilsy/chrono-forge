import { normalize, Schema } from 'normalizr';
import { SchemaManager } from '../store/SchemaManager';

import type { EntitiesState } from './entities';

export const normalizeEntities = <T>(data: T | T[], entitySchema: Schema | string): EntitiesState => {
  const schema = typeof entitySchema === 'string' ? getSchema(entitySchema) : entitySchema;
  const { entities } = normalize(data, Array.isArray(data) ? [schema] : schema);

  return entities as EntitiesState;
};

export type EntityAction = {
  type: string;
  entity?: Record<string | number, any>;
  entities?: EntitiesState;
  entityId?: string;
  entityName?: string;
  strategy?: EntityStrategy;
  value?: any; // This if any extra value for a specific update operation
};

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

export const UPDATE_ENTITY = 'entities.upsertEntity';
export const UPDATE_ENTITIES = 'entities.upsertEntities';
export const PARTIAL_UPDATE = 'entities.partialUpdate';
export const DELETE_ENTITY = 'entities.deleteEntity';
export const DELETE_ENTITIES = 'entities.deleteEntities';
export const CLEAR_ENTITIES = 'entities.clearEntities';
export const SET_STATE = 'entities.setState';

export const updateEntity = (entity: Record<string | number, any>, entityName: string): EntityAction =>
  updateNormalizedEntities(normalize(entity, getSchema(entityName)).entities as EntitiesState);

export const updateEntities = (entities: any[], entityName: string): EntityAction =>
  updateNormalizedEntities(normalize(entities, getSchema(entityName)).entities as EntitiesState);

export const partialUpdateEntity = (
  entityName: string,
  entityId: string,
  entities: EntitiesState,
  strategy: EntityStrategy = '$merge'
): EntityAction => ({
  type: PARTIAL_UPDATE,
  entityName,
  entityId,
  entities,
  strategy
});

export const deleteEntity = (entityId: string, entityName: string): EntityAction => ({
  type: DELETE_ENTITY,
  entityId,
  entityName
});

export const deleteEntities = (entities: EntitiesState, entityName: string): EntityAction =>
  deleteNormalizedEntities(normalizeEntities(entities, entityName));

export const clearEntities = (): EntityAction => ({
  type: CLEAR_ENTITIES
});

export const setState = (entities: EntitiesState = {}): EntityAction => ({
  type: SET_STATE,
  entities
});

export const updateNormalizedEntity = (entity: Record<string | number, any>, entityName: string): EntityAction => ({
  type: UPDATE_ENTITY,
  entity,
  entityName
});

export const updateNormalizedEntities = (
  entities: EntitiesState,
  strategy: EntityStrategy = '$merge'
): EntityAction => ({
  type: UPDATE_ENTITIES,
  entities,
  strategy
});

export const deleteNormalizedEntity = deleteEntity;

export const deleteNormalizedEntities = (entities: EntitiesState): EntityAction => ({
  type: DELETE_ENTITIES,
  entities
});

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
