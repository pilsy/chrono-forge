/**
 * Entity store management module
 *
 * This module provides a Redux reducer and utility functions for managing
 * normalized entity data in a Redux store. It uses immutability-helper
 * to perform immutable updates on the entity state.
 */
import update, { Spec } from 'immutability-helper';
import {
  UPDATE_ENTITY,
  UPDATE_ENTITIES,
  PARTIAL_UPDATE_ENTITY,
  DELETE_ENTITY,
  DELETE_ENTITIES,
  CLEAR_ENTITIES,
  SET_STATE
} from './actions';
import type { EntityAction, EntityStrategy } from './actions';

/**
 * Represents the structure of the entities state in the Redux store.
 * A nested record where the outer keys are entity types and inner keys are entity IDs.
 */
export type EntitiesState = Record<string, Record<string | number, any>>;

/**
 * Default empty state for the entities reducer
 */
export const defaultState: EntitiesState = {};

/**
 * Initial state for the entities reducer
 */
export const initialState: EntitiesState = {};

/**
 * Creates an update statement for immutability-helper to merge normalized entities into state
 *
 * @param state - Current entities state
 * @param normalizedEntities - Normalized entities to merge into state
 * @returns An immutability-helper spec object for updating the state
 */
export const createUpdateStatement = (state: EntitiesState, normalizedEntities: EntitiesState): Spec<EntitiesState> => {
  return Object.entries(normalizedEntities).reduce<IndexableSpec<EntitiesState>>((acc, [entityName, entityGroup]) => {
    acc[entityName] = state[entityName]
      ? Object.entries(entityGroup).reduce<IndexableSpec<Record<string, any>>>(
          (subAcc, [entityId, entityData]) => {
            subAcc[entityId] = state[entityName][entityId] ? { $merge: entityData } : { $set: entityData };
            return subAcc;
          },
          {} as IndexableSpec<Record<string, any>>
        )
      : { $set: entityGroup };
    return acc;
  }, {} as IndexableSpec<EntitiesState>);
};

/**
 * Handles updating entities with different strategies
 *
 * @param state - Current entities state
 * @param entities - Entities to update
 * @param strategy - Strategy to use for the update (default: '$merge')
 * @param value - Optional value used by some strategies
 * @returns An immutability-helper spec object for updating the state
 */
export const handleUpdateEntities = (
  state: EntitiesState,
  entities: Record<string, any>,
  strategy: EntityStrategy = '$merge',
  value?: any
): Spec<EntitiesState> =>
  Object.entries(entities).reduce<IndexableSpec<EntitiesState>>((acc, [entityName, entityGroup]) => {
    if (!state[entityName]) {
      acc[entityName] = { $set: entityGroup };
      return acc;
    }

    switch (strategy) {
      case '$replace':
        acc[entityName] = applyReplaceStrategy(entityGroup);
        break;
      case '$set':
        acc[entityName] = applySetStrategy(entityGroup, state[entityName]);
        break;
      case '$merge':
        acc[entityName] = applyMergeStrategy(state, entityName, entityGroup);
        break;
      case '$unset':
        acc[entityName] = applyUnsetStrategy(entityGroup);
        break;
      case '$push':
      case '$unshift':
        acc[entityName] = applyArrayOperation(state[entityName], entityGroup, strategy);
        break;
      case '$splice':
        acc[entityName] = applySpliceStrategy(entityGroup, value);
        break;
      case '$apply':
        acc[entityName] = applyApplyStrategy(entityGroup, value);
        break;
      default:
        acc[entityName] = {};
    }

    return acc;
  }, {} as IndexableSpec<EntitiesState>);

/**
 * Creates a spec for deleting entities from the state
 *
 * @param entities - Entities to delete
 * @returns An immutability-helper spec object for deleting entities
 */
export const handleDeleteEntities = (entities: EntitiesState): Spec<EntitiesState> =>
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
 *
 * @param entityGroup - Group of entities to replace
 * @returns An immutability-helper spec for the replace operation
 */
const applyReplaceStrategy = (entityGroup: Record<string | number, any>): Spec<EntitiesState> =>
  Object.entries(entityGroup).reduce<IndexableSpec<Record<string, any>>>(
    (acc, [entityId, entityData]) => {
      acc[entityId] = { $set: entityData };
      return acc;
    },
    {} as IndexableSpec<Record<string, any>>
  );

/**
 * Applies the $set strategy to an entity group
 * Sets specific fields in each entity
 *
 * @param entityGroup - Group of entities to update
 * @param stateArray - Current state of the entity group
 * @returns An immutability-helper spec for the set operation
 */
const applySetStrategy = (
  entityGroup: Record<string | number, any>,
  stateArray?: Record<string | number, any>
): Spec<EntitiesState> => {
  if (!stateArray) {
    return { $set: entityGroup };
  }

  return Object.entries(entityGroup).reduce<IndexableSpec<Record<string, any>>>(
    (acc, [entityId, entityData]) => {
      acc[entityId] = acc[entityId] || {};

      Object.entries(entityData as Record<string, any>).forEach(([fieldName, fieldValue]) => {
        acc[entityId][fieldName] = { $set: fieldValue };
      });

      return acc;
    },
    {} as IndexableSpec<Record<string, any>>
  );
};

/**
 * Applies the $merge strategy to an entity group
 * Merges new data with existing entity data
 *
 * @param state - Current entities state
 * @param entityName - Name of the entity type
 * @param entityGroup - Group of entities to merge
 * @returns An immutability-helper spec for the merge operation
 */
const applyMergeStrategy = (
  state: EntitiesState,
  entityName: string,
  entityGroup: Record<string | number, any>
): Spec<EntitiesState> => {
  return {
    ...(createUpdateStatement(state, { [entityName]: entityGroup }) as IndexableSpec<EntitiesState>)[entityName]
  };
};

/**
 * Applies the $unset strategy to an entity group
 * Removes specified fields from entities
 *
 * @param entityGroup - Group of entities with fields to unset
 * @returns An immutability-helper spec for the unset operation
 */
const applyUnsetStrategy = (entityGroup: Record<string | number, any>): Spec<EntitiesState> => {
  // Handle unsetting individual fields within entities
  return Object.entries(entityGroup).reduce<IndexableSpec<Record<string, any>>>(
    (acc, [entityId, entityData]) => {
      acc[entityId] = acc[entityId] || {};
      acc[entityId].$unset = acc[entityId].$unset || [];
      acc[entityId].$unset = [...acc[entityId].$unset, ...Object.keys(entityData)];

      return acc;
    },
    {} as IndexableSpec<Record<string, any>>
  );
};

/**
 * Applies array operations ($push or $unshift) to entity fields
 *
 * @param stateArray - Current state of the entity group
 * @param entityGroup - Group of entities with array operations
 * @param operation - The array operation to perform ($push or $unshift)
 * @returns An immutability-helper spec for the array operation
 * @throws Error if the target field is not an array
 */
const applyArrayOperation = (
  stateArray: Record<string | number, any>,
  entityGroup: Record<string | number, any>,
  operation: EntityStrategy
): Spec<EntitiesState> => {
  const actions = Object.entries(entityGroup).reduce<IndexableSpec<Record<string, any>>>(
    (acc, [key, update]) => {
      Object.entries(update).forEach(([propKey, arrayValues]) => {
        const currentArray = stateArray[key][propKey] ?? [];

        if (!Array.isArray(currentArray)) {
          throw new Error(`Expected array for ${operation} operation on key '${key}.${propKey}'`);
        }

        acc[key] = acc[key] || {};
        acc[key][propKey] = { [operation]: Array.isArray(arrayValues) ? arrayValues : [arrayValues] };
      });

      return acc;
    },
    {} as IndexableSpec<Record<string, any>>
  );

  return actions;
};

/**
 * Applies the $splice strategy to an entity group
 * Performs splice operations on array fields
 *
 * @param entityGroup - Group of entities with fields to splice
 * @param value - Splice operations to perform
 * @returns An immutability-helper spec for the splice operation
 */
const applySpliceStrategy = (entityGroup: Record<string | number, any>, value: any): Spec<EntitiesState> => {
  return Object.entries(entityGroup).reduce<IndexableSpec<Record<string, any>>>(
    (acc, [entityId, entityData]) => {
      acc[entityId] = acc[entityId] || {};

      Object.entries(entityData as Record<string, any>).forEach(([fieldName, _]) => {
        const spliceOperations = value?.[entityId];
        acc[entityId][fieldName] = { $splice: Array.isArray(spliceOperations) ? spliceOperations : [] };
      });

      return acc;
    },
    {} as IndexableSpec<Record<string, any>>
  );
};

/**
 * Applies the $apply strategy to an entity group
 * Applies a function to transform entity values
 *
 * @param entityGroup - Group of entities with fields to transform
 * @param value - Function to apply to the entity values
 * @returns An immutability-helper spec for the apply operation
 */
const applyApplyStrategy = (entityGroup: Record<string | number, any>, value: any): Spec<EntitiesState> => {
  return Object.fromEntries(
    Object.entries(entityGroup).map(([key, _]) => [key, { $apply: (original: any) => value(original) }])
  );
};

/**
 * Reducer function for the entities state
 * Handles various entity-related actions
 *
 * @param state - Current entities state (defaults to initialState)
 * @param action - Action to process
 * @returns Updated entities state
 */
export function reducer(state: EntitiesState = initialState, action: EntityAction): EntitiesState {
  switch (action.type) {
    case UPDATE_ENTITY: {
      if (!action.entityName || !action.entity) {
        return state;
      }
      return update(state, handleUpdateEntities(state, { [action.entityName]: action.entity }));
    }
    case UPDATE_ENTITIES: {
      if (!action.entities) {
        return state;
      }
      return update(state, handleUpdateEntities(state, action.entities, action.strategy, action.value));
    }
    case PARTIAL_UPDATE_ENTITY: {
      const { entityName, entityId, entities, strategy } = action;
      if (entityName && entityId && entities?.[entityId]) {
        return update(
          state,
          handleUpdateEntities(
            state,
            {
              [entityName]: {
                [entityId]: entities[entityId]
              }
            },
            strategy
          )
        );
      }
      return state;
    }
    case DELETE_ENTITY: {
      if (!action.entityName || !action.entityId) {
        return state;
      }

      return update(
        state,
        handleDeleteEntities({
          [action.entityName]: {
            [action.entityId]: {
              id: action.entityId
            }
          }
        })
      );
    }
    case DELETE_ENTITIES: {
      if (!action.entities) {
        return state;
      }

      return update(state, handleDeleteEntities(action.entities));
    }
    case CLEAR_ENTITIES: {
      return update(state, {
        $set: { ...defaultState }
      });
    }
    case SET_STATE: {
      return action.entities ?? {};
    }
    default: {
      return state;
    }
  }
}

/**
 * Extension of the immutability-helper Spec type that allows for indexable properties
 * Used for building dynamic update specs
 */
export type IndexableSpec<T> = Spec<T> & {
  [key: string]: any;
};

export default reducer;
