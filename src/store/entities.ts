import update, { Spec } from 'immutability-helper';
import {
  UPDATE_ENTITY,
  UPDATE_ENTITIES,
  PARTIAL_UPDATE,
  DELETE_ENTITY,
  DELETE_ENTITIES,
  CLEAR_ENTITIES,
  SET_STATE
} from './actions';
import type { EntityAction, EntityStrategy } from './actions';

export type EntitiesState = Record<string, Record<string | number, any>>;

export const defaultState: EntitiesState = {};
export const initialState: EntitiesState = {};

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

const applyReplaceStrategy = (entityGroup: Record<string | number, any>): Spec<EntitiesState> =>
  Object.entries(entityGroup).reduce<IndexableSpec<Record<string, any>>>(
    (acc, [entityId, entityData]) => {
      acc[entityId] = { $set: entityData };
      return acc;
    },
    {} as IndexableSpec<Record<string, any>>
  );

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

const applyMergeStrategy = (
  state: EntitiesState,
  entityName: string,
  entityGroup: Record<string | number, any>
): Spec<EntitiesState> => {
  return {
    ...(createUpdateStatement(state, { [entityName]: entityGroup }) as IndexableSpec<EntitiesState>)[entityName]
  };
};

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

const applySpliceStrategy = (entityGroup: Record<string | number, any>, value: any): Spec<EntitiesState> => {
  return Object.entries(entityGroup).reduce<IndexableSpec<Record<string, any>>>(
    (acc, [entityId, entityData]) => {
      acc[entityId] = acc[entityId] || {};

      // Process each field in the entity that needs to be spliced
      Object.entries(entityData as Record<string, any>).forEach(([fieldName, _]) => {
        // Check if we have splice operations for this entity and field
        if (value && value[entityId] && Array.isArray(value[entityId])) {
          acc[entityId][fieldName] = { $splice: value[entityId] };
        } else {
          // If no specific splice operations provided, use an empty array
          acc[entityId][fieldName] = { $splice: [] };
        }
      });

      return acc;
    },
    {} as IndexableSpec<Record<string, any>>
  );
};

const applyApplyStrategy = (entityGroup: Record<string | number, any>, value: any): Spec<EntitiesState> => {
  return Object.fromEntries(
    Object.entries(entityGroup).map(([key, _]) => [key, { $apply: (original: any) => value(original) }])
  );
};

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
    case PARTIAL_UPDATE: {
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

export type IndexableSpec<T> = Spec<T> & {
  [key: string]: any;
};

export default reducer;
