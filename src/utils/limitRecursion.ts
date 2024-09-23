import { schema as normalizrSchema } from 'normalizr';
import { SchemaManager } from '../SchemaManager';

export const limitRecursion = (
  entityId: string,
  entityName: string,
  entities: Record<string, any> = SchemaManager.getInstance().getState(),
  visited: Map<string, Set<string>> = new Map()
): any => {
  const entity = entities[entityName]?.[entityId];
  if (!entity) {
    return entityId;
  }

  const entityKey = `${entityName}:${entityId}`;
  if (visited.get(entityName)?.has(entityId)) {
    return entityId;
  }

  if (!visited.has(entityName)) {
    visited.set(entityName, new Set());
  }
  visited.get(entityName)?.add(entityId);

  const schema = SchemaManager.getInstance().getSchema(entityName);
  const result: Record<string, any> = {};

  for (const key in entity) {
    if (Object.prototype.hasOwnProperty.call(entity, key)) {
      const value = entity[key];
      // @ts-ignore
      const relation = schema.schema[key];

      if (relation) {
        if (Array.isArray(value)) {
          result[key] = value.map((childId: string) => limitRecursion(childId, getEntityName(relation), entities, new Map(visited)));
        } else {
          result[key] = limitRecursion(value, getEntityName(relation), entities, new Map(visited));
        }
      } else {
        result[key] = value;
      }
    }
  }

  return result;
};

const getEntityName = (relation: any): string => {
  if (Array.isArray(relation)) {
    return getEntityName(relation[0]);
  } else if (relation instanceof normalizrSchema.Entity) {
    return relation.key;
  } else if (typeof relation === 'string') {
    return relation;
  } else {
    throw new Error('Unknown schema relation type');
  }
};
