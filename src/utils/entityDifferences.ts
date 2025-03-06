import isEqual from 'lodash/isEqual';
import { EnhancedEntity, EntitiesState, SchemaManager } from '../store';

interface DiffResult {
  added?: Record<string, Record<string, any>>;
  updated?: Record<string, Record<string, any>>;
  deleted?: Record<string, Record<string, any>>;
}

/**
 * Compare two states keyed as state[entityName][entityId] = entityData.
 * Returns { added, updated, deleted } with field-level diffs (including array-of-IDs diff).
 */
export function entityDifferences(oldState: EntitiesState, newState: EntitiesState): DiffResult {
  const result: DiffResult = {
    added: {},
    updated: {},
    deleted: {}
  };

  // Collect all entity names seen in either oldState or newState
  const entityNames = new Set<string>([...Object.keys(oldState), ...Object.keys(newState)]);

  for (const entityName of entityNames) {
    const schema = SchemaManager.schemas[entityName];
    if (!schema) {
      continue;
    }

    const oldEntities = oldState[entityName] || {};
    const newEntities = newState[entityName] || {};

    // For storing diffs under this specific entity name
    result.added![entityName] = {};
    result.updated![entityName] = {};
    result.deleted![entityName] = {};

    // 1) Check for new or updated
    for (const entityId of Object.keys(newEntities)) {
      if (!(entityId in oldEntities)) {
        // Entirely new entity
        result.added![entityName][entityId] = newEntities[entityId];
      } else {
        // Potentially updated fields
        const changes = diffEntity(schema, oldEntities[entityId], newEntities[entityId]);
        if (Object.keys(changes).length > 0) {
          result.updated![entityName][entityId] = changes;
        }
      }
    }

    // 2) Check for deleted
    for (const entityId of Object.keys(oldEntities)) {
      if (!(entityId in newEntities)) {
        // Entirely removed entity
        result.deleted![entityName][entityId] = oldEntities[entityId];
      }
    }

    if (Object.keys(result.added![entityName]).length === 0) delete result.added![entityName];
    if (Object.keys(result.updated![entityName]).length === 0) delete result.updated![entityName];
    if (Object.keys(result.deleted![entityName]).length === 0) delete result.deleted![entityName];
  }

  // Cleanup empty top-level objects
  if (Object.keys(result.added || {}).length === 0) delete result.added;
  if (Object.keys(result.updated || {}).length === 0) delete result.updated;
  if (Object.keys(result.deleted || {}).length === 0) delete result.deleted;

  return result;
}

/**
 * Diff two entities *shallowly* at the field level, but if a field is an array
 * of IDs, we do a specialized arrayOfIdsDifferences to get { added, updated, deleted }.
 */
function diffEntity(
  schema: EnhancedEntity,
  oldEntity: Record<string, any>,
  newEntity: Record<string, any>
): Record<string, any> {
  const changes: Record<string, any> = {};
  const allKeys = new Set([...Object.keys(oldEntity), ...Object.keys(newEntity)]);

  for (const key of allKeys) {
    // You cannot change the id of an entity!
    if (key === schema.idAttribute) {
      continue;
    }

    const oldVal = oldEntity[key];
    const newVal = newEntity[key];

    // If exactly the same (including undefined vs. nonexistent), skip
    if (isEqual(oldVal, newVal)) {
      continue;
    }

    // If both sides are arrays of strings, do arrayOfIdsDifferences
    if (Array.isArray(oldVal) && Array.isArray(newVal) && isArrayOfStrings(oldVal) && isArrayOfStrings(newVal)) {
      const arrDiff = arrayOfIdsDifferences(oldVal, newVal);
      // Only record it if there's an actual membership change
      if (Object.keys(arrDiff).length > 0) {
        changes[key] = arrDiff;
      }
    } else {
      // Otherwise just replace the field with the new value
      changes[key] = newVal;
    }
  }

  return changes;
}

/**
 * A helper to detect membership changes in an array of IDs.
 * "updated" here can be used if you want to check underlying entity changes,
 * but you can omit it if you only care about presence/absence.
 */
function arrayOfIdsDifferences(oldIds: string[], newIds: string[]) {
  const oldSet = new Set(oldIds);
  const newSet = new Set(newIds);

  const added: string[] = [];
  const deleted: string[] = [];
  const updated: string[] = [];

  for (const id of newIds) {
    if (!oldSet.has(id)) {
      added.push(id);
    }
  }
  for (const id of oldIds) {
    if (!newSet.has(id)) {
      deleted.push(id);
    }
  }

  const result: { added?: string[]; updated?: string[]; deleted?: string[] } = {};
  if (added.length) result.added = added;
  if (updated.length) result.updated = updated;
  if (deleted.length) result.deleted = deleted;
  return result;
}

// Quick utility to check if an array is strictly an array of strings
function isArrayOfStrings(arr: any[]): arr is string[] {
  return arr.every((item) => typeof item === 'string');
}
