import { schema as normalizrSchema } from 'normalizr';
import { SchemaManager } from '../SchemaManager';

export const limitRecursion = (
  entityId: string,
  entityName: string,
  entities: Record<string, any> = SchemaManager.getInstance().getState(),
  visited = new Set<string>()
): any => {
  const entity = entities[entityName]?.[entityId];
  if (!entity) {
    // Entity data is missing; return the ID
    return entityId;
  }

  const entityKey = `${entityName}:${entityId}`;
  if (visited.has(entityKey)) {
    // Circular reference detected; return the ID
    return entityId;
  }
  visited.add(entityKey);

  const schema = SchemaManager.getInstance().getSchema(entityName);
  const result: Record<string, any> = {};

  for (const key in entity) {
    if (Object.prototype.hasOwnProperty.call(entity, key)) {
      const value = entity[key];
      // @ts-ignore
      const relation = schema.schema[key];

      if (relation) {
        // Relation detected
        if (Array.isArray(value)) {
          // Array relation
          result[key] = value.map((childId: string) => limitRecursion(childId, getEntityName(relation), entities, visited));
        } else {
          // Single entity relation
          result[key] = limitRecursion(value, getEntityName(relation), entities, visited);
        }
      } else {
        // Not a relation; copy the value
        result[key] = value;
      }
    }
  }
  return result;
};

// Helper function to extract entity name from schema definition
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
