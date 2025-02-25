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
  const schema = SchemaManager.getInstance().getSchema(entityName);

  // Early return if no entity found
  const entity = entities[entityName]?.[entityId];

  const idAttribute = typeof schema.idAttribute === 'function' ? schema.idAttribute(entity) : schema.idAttribute;

  if (!entity) {
    return entityId;
    // return { [idAttribute]: entityId };
  }

  const entityKey = `${entityName}::${entityId}`;

  // Check visited state first to prevent infinite recursion
  const visitedDepth = visited.get(entityKey);
  if (visitedDepth !== undefined && visitedDepth <= depth) {
    return entityId;
  }
  visited.set(entityKey, depth);

  // Check StateManager cache if available
  if (stateManager instanceof StateManager) {
    const cachedEntry = stateManager.cache.get(entityKey);
    if (cachedEntry) {
      return cachedEntry;
    }
  }

  // Pre-allocate result with approximate size
  const result: Record<string, any> = Object.create(null);

  const schemaDefinition = schema.schema;

  // Use for...of instead of for...in for better performance
  for (const key of Object.keys(entity)) {
    const value = entity[key];
    // @ts-ignore
    const relation = schemaDefinition[key];

    if (relation) {
      if (Array.isArray(value)) {
        // Avoid creating new Map for each array item
        const visitedCopy = new Map(visited);
        const relationName = getEntityName(relation);
        result[key] = value.map((childId: string) =>
          limitRecursion(childId, relationName, entities, stateManager, visitedCopy, depth + 1)
        );
      } else {
        result[key] = limitRecursion(
          value,
          getEntityName(relation),
          entities,
          stateManager,
          new Map(visited),
          depth + 1
        );
      }
    } else {
      result[key] = value;
    }
  }

  // Cache the result in StateManager if available
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
  } else {
    throw new Error('Unknown schema relation type');
  }
};
