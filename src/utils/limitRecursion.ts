import { schema as normalizrSchema } from 'normalizr';
import { SchemaManager } from '../store/SchemaManager';
import { StateManager } from '../store/StateManager';

export const limitRecursion: Function = (
  entityId: string,
  entityName: string,
  entities: Record<string, any>,
  stateManager: boolean | StateManager = false,
  visited: Map<string, number> = new Map(),
  depth: number = 0
): any => {
  // Cache schema lookup
  const schema = SchemaManager.schemas[entityName];
  const entity = entities[entityName]?.[entityId];

  // Early return if no entity found
  if (!entity) {
    return entityId;
  }

  const entityKey = `${entityName}::${entityId}`;

  // Check visited state first to prevent infinite recursion
  const visitedDepth = visited.get(entityKey);
  if (visitedDepth !== undefined && visitedDepth <= depth) {
    return entityId;
  }
  visited.set(entityKey, depth);

  // Check StateManager cache if available
  if (stateManager instanceof StateManager && stateManager.cache.has(entityKey)) {
    return stateManager.cache.get(entityKey);
  }

  const result: Record<string, any> = Object.create(null);
  const schemaRelations = schema.schema;

  for (const key of Object.keys(entity)) {
    const value = entity[key];
    const relation = schemaRelations[key];

    if (relation) {
      const relationName = getEntityName(relation);

      if (Array.isArray(value)) {
        result[key] = value.map((childId: any) => {
          let valueId;
          if (typeof childId === 'string' || typeof childId === 'number') {
            valueId = childId;
          } else if ('idAttribute' in relation && typeof relation.idAttribute === 'function') {
            valueId = childId[relation.idAttribute(childId)];
          } else {
            valueId = childId.id;
          }
          return limitRecursion(valueId, relationName, entities, stateManager, new Map(visited), depth + 1);
        });
      } else {
        let valueId;
        if (typeof value === 'string' || typeof value === 'number') {
          valueId = value;
        } else if ('idAttribute' in relation && typeof relation.idAttribute === 'function') {
          valueId = value[relation.idAttribute(value)];
        } else {
          valueId = value.id;
        }

        result[key] = limitRecursion(valueId, relationName, entities, stateManager, new Map(visited), depth + 1);
      }
    } else {
      result[key] = value;
    }
  }

  if (stateManager instanceof StateManager) {
    stateManager.cache.set(entityKey, result);
  }
  return result;
};

export const getEntityName = (relation: any): string => {
  if (Array.isArray(relation)) {
    return getEntityName(relation[0]);
  } else if (relation instanceof normalizrSchema.Entity) {
    return relation.key;
  } else if (typeof relation === 'string') {
    return relation;
  } else if (relation && typeof relation === 'object' && 'relatedEntityName' in relation) {
    return relation.relatedEntityName;
  } else {
    console.error(relation);
    throw new Error('Unknown schema relation type');
  }
};
