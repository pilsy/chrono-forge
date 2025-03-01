import update, { Spec } from 'immutability-helper';
import { normalize, Schema } from 'normalizr';
import { Relationship, SchemaManager } from '../store/SchemaManager';
import { GraphManager } from '../store/GraphManager';

// Types
export type EntitiesState = Record<string, Record<string, any>>;

export type EntityStrategy =
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

export type EntityAction = {
  type: string;
  entity?: Record<string, any>;
  entities?: Record<string, any>;
  entityId?: string;
  entityName?: string;
  strategy?: EntityStrategy;
  value?: any; // This if any extra value for a specific update operation
};

export const defaultState: EntitiesState = {};
export const initialState: EntitiesState = {};

export const UPDATE_ENTITY = 'entities.upsertEntity';
export const UPDATE_ENTITIES = 'entities.upsertEntities';
export const PARTIAL_UPDATE = 'entities.partialUpdate';
export const DELETE_ENTITY = 'entities.deleteEntity';
export const DELETE_ENTITIES = 'entities.deleteEntities';
export const CLEAR_ENTITIES = 'entities.clearEntities';
export const SET_STATE = 'entities.setState';

function getSchema(entityName: string): Schema {
  const schemas = SchemaManager.getInstance().getSchemas();
  const schema = schemas[entityName];
  if (!schema) {
    throw new Error(`Schema for ${entityName} not found.`);
  }
  return schema;
}

export const setState = (entities: EntitiesState = {}): EntityAction => ({
  type: SET_STATE,
  entities
});

export const updateEntity = (entity: any, entityName: string): EntityAction => {
  const schema = getSchema(entityName);
  return updateNormalizedEntities(normalize(entity, schema).entities);
};

export const updateNormalizedEntity = (entity: Record<string, any>, entityName: string): EntityAction => ({
  type: UPDATE_ENTITY,
  entity,
  entityName
});

export const updateEntities = (entities: any[], entityName: string): EntityAction => {
  const schema = getSchema(entityName);
  return updateNormalizedEntities(normalize(entities, schema).entities);
};

export const updateNormalizedEntities = (
  entities: Record<string, unknown>,
  strategy: EntityStrategy = '$merge'
): EntityAction => ({
  type: UPDATE_ENTITIES,
  entities,
  strategy
});

export const updatePartialEntity = (
  entityName: string,
  entityId: string,
  entities: Record<string, { [key: string]: any }>,
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

export const deleteNormalizedEntity = deleteEntity;

export const deleteEntities = (entities: EntitiesState, entityName: string): EntityAction =>
  deleteNormalizedEntities(normalizeEntities(entities, entityName));

export const deleteNormalizedEntities = (entities: EntitiesState): EntityAction => ({
  type: DELETE_ENTITIES,
  entities
});

export const clearEntities = (): EntityAction => ({
  type: CLEAR_ENTITIES
});

export const normalizeEntities = <T>(data: T | T[], entitySchema: Schema | string): EntitiesState => {
  const schema = typeof entitySchema === 'string' ? getSchema(entitySchema) : entitySchema;
  const { entities } = normalize(data, Array.isArray(data) ? [schema] : schema);

  return entities as EntitiesState;
};

type IndexableSpec<T> = Spec<T> & {
  [key: string]: any;
};

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

const applyArrayOperation = (
  stateArray: Record<string, any>,
  entityGroup: Record<string, any>,
  operation: EntityStrategy
): Spec<EntitiesState> => {
  const actions = Object.entries(entityGroup).reduce<IndexableSpec<Record<string, any>>>(
    (acc, [key, update]) => {
      // Iterate through properties of the update object
      Object.entries(update).forEach(([propKey, arrayValues]) => {
        // Initialize array if it doesn't exist
        const currentArray = stateArray[key][propKey] ?? []; // Defaults to an empty array if it doesn't already exist

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

// Define separate functions for each strategy to minimize nesting

const applySetStrategy = (entityGroup: Record<string, any>): Spec<EntitiesState> => {
  return { $set: entityGroup };
};

const applyMergeStrategy = (
  state: EntitiesState,
  entityName: string,
  entityGroup: Record<string, any>
): Spec<EntitiesState> => {
  return {
    ...(createUpdateStatement(state, { [entityName]: entityGroup }) as IndexableSpec<EntitiesState>)[entityName]
  };
};

const applyUnsetStrategy = (entityGroup: Record<string, any>): Spec<EntitiesState> => {
  return { $unset: Object.keys(entityGroup) };
};

const applySpliceStrategy = (entityGroup: Record<string, any>, value: any): Spec<EntitiesState> => {
  return Object.keys(entityGroup).reduce(
    (actions, key) => {
      actions[key] = { items: { $splice: value[key] || [] } };
      return actions;
    },
    {} as IndexableSpec<Record<string, any>>
  );
};

const applyApplyStrategy = (entityGroup: Record<string, any>, value: any): Spec<EntitiesState> => {
  return Object.fromEntries(
    Object.entries(entityGroup).map(([key, _]) => [key, { $apply: (original: any) => value(original) }])
  );
};

// Get a reference to the GraphManager singleton once
const graphManager = GraphManager.getInstance();

export const handleUpdateEntities = (
  state: EntitiesState,
  entities: Record<string, any>,
  strategy: EntityStrategy = '$merge',
  value?: any
): Spec<EntitiesState> => {
  // Update the graph for entities being added or modified
  if (['$set', '$merge', '$push', '$unshift'].includes(strategy)) {
    Object.entries(entities).forEach(([entityName, entityGroup]) => {
      const relationships = SchemaManager.relationshipMap[entityName];
      if (!relationships) return;

      // Process each entity in the group
      Object.entries(entityGroup as Record<string, any>).forEach(([entityId, entityData]) => {
        // Add the entity node to the graph
        graphManager.addEntityNode(entityName, entityId);

        // Check each field that might reference other entities
        Object.entries(relationships).forEach(([fieldName, relation]) => {
          if (fieldName === '_referencedBy') return; // Skip metadata

          const relationship = relation as Relationship;
          if (!relationship?.relatedEntityName) return;

          const referencedEntityName = relationship.relatedEntityName;
          const fieldValue = entityData[fieldName];
          if (!fieldValue) return;

          // Handle array of references or single reference
          const references = relationship.isMany && Array.isArray(fieldValue) ? fieldValue : [fieldValue];

          references.forEach((refId) => {
            if (typeof refId !== 'string' && typeof refId !== 'number') return;

            // Add reference to the graph
            graphManager.addReference(entityName, entityId, referencedEntityName, refId.toString());
          });
        });
      });
    });
  }

  // Handle reference removal for delete operations
  if (strategy === '$unset') {
    Object.entries(entities).forEach(([entityName, entityGroup]) => {
      Object.keys(entityGroup as Record<string, any>).forEach((entityId) => {
        graphManager.removeEntityNode(entityName, entityId);
      });
    });
  }

  // Original entity update logic
  return Object.entries(entities).reduce<IndexableSpec<EntitiesState>>((acc, [entityName, entityGroup]) => {
    if (!state[entityName]) {
      acc[entityName] = { $set: entityGroup };
      return acc;
    }

    switch (strategy) {
      case '$set':
        acc[entityName] = applySetStrategy(entityGroup);
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
};

export const handleDeleteEntities = (entities: EntitiesState): Spec<EntitiesState> =>
  Object.fromEntries(
    Object.entries(entities).map(([entityName, entities]) => {
      const entityIds = Object.keys(entities);
      return [
        entityName,
        {
          $unset: entityIds
        }
      ];
    })
  );

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

      // Remove the entity node from the graph
      graphManager.removeEntityNode(action.entityName, action.entityId);

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

      // Remove entity nodes from the graph
      Object.entries(action.entities).forEach(([entityName, entityGroup]) => {
        Object.keys(entityGroup).forEach((entityId) => {
          graphManager.removeEntityNode(entityName, entityId);
        });
      });

      return update(state, handleDeleteEntities(action.entities));
    }
    case CLEAR_ENTITIES: {
      // Clear the graph
      graphManager.clear();

      return update(state, {
        $set: { ...defaultState }
      });
    }
    case SET_STATE: {
      // Rebuild the entire graph
      const newState = action.entities ?? {};
      graphManager.buildFromState(newState);
      return newState;
    }
    default: {
      return state;
    }
  }
}

export default reducer;
