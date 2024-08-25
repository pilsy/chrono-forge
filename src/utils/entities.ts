/* eslint-disable @typescript-eslint/ban-ts-comment */
import update, { Spec } from "immutability-helper";
import { normalize, schema } from "normalizr";
import { schemas } from "../../../../schemas"; // Using named import for schemas

export type EntitiesState = Record<string, Record<string, any>>;

export type SchemaKeys = keyof typeof schemas;

export type EntityAction = {
  type: string;
  entity?: Record<string, any>;
  entities?: Record<string, any>;
  entityId?: string;
  entityName?: string;
  strategy?: "$set" | "$merge";
};

export const UPDATE_ENTITY = "entities.upsertEntity";
export const UPDATE_ENTITIES = "entities.upsertEntities";
export const DELETE_ENTITY = "entities.deleteEntity";
export const DELETE_ENTITIES = "entities.deleteEntities";
export const CLEAR_ENTITIES = "entities.clearEntities";

// Action Creators
export const updateNormalizedEntity = (
  entity: Record<string, any>,
  entityName: string
): EntityAction => {
  if (!entity || !entityName) {
    throw new Error("Entity and entityName must be provided.");
  }
  return {
    type: UPDATE_ENTITY,
    entity,
    entityName,
  };
};

export const updateNormalizedEntities = (
  entities: Record<string, unknown>,
  strategy: "$set" | "$merge" = "$merge"
): EntityAction => {
  if (!entities || typeof entities !== "object") {
    throw new Error("Entities must be provided and must be an object.");
  }
  return {
    type: UPDATE_ENTITIES,
    entities,
    strategy,
  };
};

export const deleteNormalizedEntity = (
  entityId: string,
  entityName: string
): EntityAction => {
  if (!entityId || !entityName) {
    throw new Error("EntityId and entityName must be provided.");
  }
  return {
    type: DELETE_ENTITY,
    entityId,
    entityName,
  };
};

export const deleteNormalizedEntities = (
  entities: Record<string, string[]>
): EntityAction => {
  if (!entities || typeof entities !== "object") {
    throw new Error("Entities must be provided and must be an object.");
  }
  return {
    type: DELETE_ENTITIES,
    entities,
  };
};

export const clearEntities = (): EntityAction => ({
  type: CLEAR_ENTITIES,
});

export const updateEntity = (
  entity: any,
  entityName: SchemaKeys
): EntityAction => updateNormalizedEntities(normalize(entity, schemas[entityName]).entities);

export const deleteEntity = (
  entityId: string,
  entityName: SchemaKeys
): EntityAction => deleteNormalizedEntity(entityId, entityName);

export const updateEntities = (
  entities: any[],
  entityName: SchemaKeys
): EntityAction => updateNormalizedEntities(normalize(entities, schemas[entityName]).entities);

export const deleteEntities = (
  entities: string[],
  entityName: SchemaKeys
): EntityAction => deleteNormalizedEntities({ [entityName]: entities });

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface EntitiesSpec<T> {
  [key: string]: any; // Add an index signature to allow dynamic keys
}

export const defaultState: EntitiesState = {};
export const initialState: EntitiesState = {};

/**
 * Normalize a single entity or an array of entities using the provided schema.
 */
export const normalizeEntities = <T>(data: T | T[], entitySchema: schema.Entity | string): EntitiesState => {
  const schema = typeof entitySchema === "string" // @ts-ignore
    ? schemas[entitySchema]
    : entitySchema;
  const normalizedData = normalize(data, Array.isArray(data) ? [schema] : schema);

  // Ensure that we are returning a correctly typed EntitiesState object
  const entities: EntitiesState = {};
  for (const key in normalizedData.entities) {
    if (Object.prototype.hasOwnProperty.call(normalizedData.entities, key)) {
      entities[key] = normalizedData.entities[key] || {};
    }
  }
  return entities;
};

/**
 * Create an update statement for immutability-helper using normalized entities.
 */
export const createUpdateStatement = (
  state: EntitiesState,
  normalizedEntities: EntitiesState
): Spec<EntitiesState> => {
  const updateStatement: Spec<EntitiesState> = {};

  for (const entityName in normalizedEntities) {
    if (!state[entityName]) {
      // If the entity type does not exist in the state, use $set
      updateStatement[entityName] = {
        $set: normalizedEntities[entityName],
      };
    } else {
      // If the entity type exists, check each entity
      updateStatement[entityName] = {};
      for (const entityId in normalizedEntities[entityName]) {
        if (state[entityName][entityId]) {
          // Use $merge if the entity exists
          updateStatement[entityName][entityId] = {
            $merge: normalizedEntities[entityName][entityId],
          };
        } else {
          // Use $set if the entity does not exist
          updateStatement[entityName][entityId] = {
            $set: normalizedEntities[entityName][entityId],
          };
        }
      }
    }
  }

  return updateStatement;
};

export const handleUpdateEntities = (state: EntitiesState, entities: Record<string, any>, strategy = "$merge") => {
  const updateStatement: Record<string, any> = {};

  for (const entityName of Object.keys(entities)) {
    if (!state[entityName] || strategy === "$set") {
      updateStatement[entityName] = {
        $set: entities[entityName],
      };
    } else {
      updateStatement[entityName] = {};
      for (const entityId of Object.keys(entities[entityName])) {
        updateStatement[entityName][entityId] = {
          [state[entityName][entityId] ? "$merge" : "$set"]: entities[entityName][entityId],
        };
      }
    }
  }

  return updateStatement;
};



export const handleDeleteEntities = (state: EntitiesState, entities: Record<string, any>) => {
  const deleteStatement: Record<string, any> = {};
  for (const entityName of Object.keys(entities)) {
    deleteStatement[entityName] = {
      $unset: []
    };
    for (const entityId of entities[entityName]) {
      deleteStatement[entityName].$unset.push(entityId);
    }
  }
  return deleteStatement;
};

export function reducer(state: EntitiesState = initialState, action: EntityAction): EntitiesState {
  switch (action.type) {
    case UPDATE_ENTITY:
      if (!action.entityName || !action.entity) {
        return state;
      }

      return update(state, handleUpdateEntities(state, { [action.entityName]: action.entity }));
    case UPDATE_ENTITIES:
      if (!action.entities) {
        return state;
      }

      return update(state, handleUpdateEntities(state, action.entities, action.strategy));
    case DELETE_ENTITY:
      if (!action.entityName || !action.entityId) { return state; }

      return update(state, handleDeleteEntities(state, {
        [action.entityName]: [action.entityId]
      }));
    case DELETE_ENTITIES:
      if (!action.entities) { return state; }

      return update(state, handleDeleteEntities(state, action.entities));
    case CLEAR_ENTITIES:
      return update(state, {
        $set: { ...defaultState }
      });
    default:
      return state;
  }
}

export default reducer;