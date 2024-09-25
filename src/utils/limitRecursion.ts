import { schema as normalizrSchema } from 'normalizr';
import { SchemaManager } from '../SchemaManager';

export const limitRecursion = (
  entityId: string,
  entityName: string,
  entities: Record<string, any> = SchemaManager.getInstance().getState(),
  visited: Map<string, number> = new Map(), // Track the depth at which entities are visited
  depth: number = 0 // Track the current recursion depth
): any => {
  const entity = entities[entityName]?.[entityId];
  if (!entity) {
    return entityId; // Entity not found, return the id
  }

  const entityKey = `${entityName}:${entityId}`;

  // If the entity has been visited at a shallower depth, return the id
  if (visited.has(entityKey) && visited.get(entityKey)! <= depth) {
    return entityId;
  }

  // Mark this entity as visited at the current depth
  visited.set(entityKey, depth);

  const schema = SchemaManager.getInstance().getSchema(entityName);
  const result: Record<string, any> = {};

  for (const key in entity) {
    if (Object.prototype.hasOwnProperty.call(entity, key)) {
      const value = entity[key];
      // @ts-ignore
      const relation = schema.schema[key];

      if (relation) {
        if (Array.isArray(value)) {
          result[key] = value.map(
            (childId: string) => limitRecursion(childId, getEntityName(relation), entities, new Map(visited), depth + 1) // Increase depth for each recursion
          );
        } else {
          result[key] = limitRecursion(value, getEntityName(relation), entities, new Map(visited), depth + 1); // Increase depth for each object child
        }
      } else {
        result[key] = value;
      }
    }
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
  } else {
    throw new Error('Unknown schema relation type');
  }
};
