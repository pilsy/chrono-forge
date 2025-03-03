/**
 * @fileoverview Utility functions for handling recursive entity relationships
 * with protection against infinite recursion and circular references.
 *
 * This module provides tools for safely traversing and resolving entity relationships
 * in a normalized data store, implementing lazy-loading for better performance.
 */

import { schema as normalizrSchema } from 'normalizr';
import { SchemaManager } from '../store/SchemaManager';
import { StateManager } from '../store/StateManager';
import { EntitiesState } from '../store';

/**
 * Recursively resolves entity relationships with protection against infinite recursion.
 * Creates a new object with lazy-loaded properties for related entities.
 *
 * @param {string} entityId - The ID of the entity to resolve
 * @param {string} entityName - The type/name of the entity to resolve
 * @param {EntitiesState} entities - The normalized entities state object
 * @param {boolean|StateManager} stateManager - Optional StateManager instance for caching, or false
 * @param {Map<string, number>} visited - Map of already visited entities with their depth
 * @param {number} depth - Current recursion depth
 * @returns {any} The resolved entity with lazy-loaded relationships
 *
 * @example
 * // Basic usage
 * const resolvedUser = limitRecursion('user123', 'users', state.entities);
 *
 * @example
 * // With StateManager for caching
 * const resolvedUser = limitRecursion('user123', 'users', state.entities, stateManager);
 */
export const limitRecursion: Function = (
  entityId: string,
  entityName: string,
  entities: EntitiesState,
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
  if (stateManager instanceof StateManager && depth === 0 && stateManager.cache.has(entityKey)) {
    return stateManager.cache.get(entityKey);
  }

  const result: Record<string, any> = Object.create({});
  const schemaRelations = schema.schema;

  for (const key of Object.keys(entity)) {
    const value = entity[key];
    const relation = schemaRelations[key];

    if (relation) {
      const relationName = getEntityName(relation);

      if (Array.isArray(value)) {
        // Create a lazy-loaded array proxy
        const lazyArray = [...value]; // Create a copy to avoid modifying the original

        // Define a custom property descriptor for each array item
        value.forEach((childId: any, index: number) => {
          Object.defineProperty(lazyArray, index, {
            enumerable: true,
            get: function () {
              let valueId;
              if (typeof childId === 'string' || typeof childId === 'number') {
                valueId = childId;
              } else if ('idAttribute' in relation && typeof relation.idAttribute === 'function') {
                valueId = childId[relation.idAttribute(childId)];
              } else {
                valueId = childId.id;
              }

              // Replace the getter with the actual value after first access
              const resolvedValue = limitRecursion(
                valueId,
                relationName,
                entities,
                stateManager,
                new Map(visited),
                depth + 1
              );
              Object.defineProperty(lazyArray, index, {
                enumerable: true,
                value: resolvedValue,
                writable: true,
                configurable: true
              });

              return resolvedValue;
            },
            configurable: true
          });
        });

        result[key] = lazyArray;
      } else {
        // Create a lazy-loaded property for the single relation
        Object.defineProperty(result, key, {
          enumerable: true,
          get: function () {
            let valueId;
            if (typeof value === 'string' || typeof value === 'number') {
              valueId = value;
            } else if ('idAttribute' in relation && typeof relation.idAttribute === 'function') {
              valueId = value[relation.idAttribute(value)];
            } else {
              valueId = value.id;
            }

            // Replace the getter with the actual value after first access
            const resolvedValue = limitRecursion(
              valueId,
              relationName,
              entities,
              stateManager,
              new Map(visited),
              depth + 1
            );
            Object.defineProperty(result, key, {
              enumerable: true,
              value: resolvedValue,
              writable: true,
              configurable: true
            });

            return resolvedValue;
          },
          configurable: true
        });
      }
    } else {
      result[key] = value;
    }
  }

  // Store in cache only at depth 0
  if (stateManager instanceof StateManager && depth === 0) {
    stateManager.cache.set(entityKey, result);
  }
  return result;
};

/**
 * Extracts the entity name from a schema relation.
 * Handles various relation formats including arrays, normalizr Entity objects,
 * strings, and custom relation objects.
 *
 * @param {any} relation - The schema relation to extract the entity name from
 * @returns {string} The extracted entity name
 * @throws {Error} If the relation type is unknown or cannot be processed
 *
 * @example
 * const entityName = getEntityName(userSchema);  // Returns 'users'
 */
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
