import { schema as normalizrSchema } from 'normalizr';
import { SchemaManager } from '../store/SchemaManager';
import { StateManager } from '../store/StateManager'; // Assuming the StateManager class is imported from here

export const limitRecursion: Function = (
  entityId: string,
  entityName: string,
  entities: Record<string, any>,
  proxy: boolean | StateManager = false,
  visited: Map<string, number> = new Map(),
  depth: number = 0
): any => {
  const entity = entities[entityName]?.[entityId];
  if (!entity) {
    return entityId;
  }

  const entityKey = `${entityName}:${entityId}`;

  if (visited.has(entityKey) && visited.get(entityKey)! <= depth) {
    return entityId;
  }
  visited.set(entityKey, depth);

  const schema = SchemaManager.getInstance().getSchema(entityName);
  let result: Record<string, any> = {};

  for (const key in entity) {
    if (Object.prototype.hasOwnProperty.call(entity, key)) {
      const value = entity[key];
      // @ts-ignore
      const relation = schema.schema[key];

      if (relation) {
        if (Array.isArray(value)) {
          result[key] = value.map((childId: string) =>
            limitRecursion(childId, getEntityName(relation), entities, proxy, new Map(visited), depth + 1)
          );
        } else {
          result[key] = limitRecursion(value, getEntityName(relation), entities, proxy, new Map(visited), depth + 1);
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
