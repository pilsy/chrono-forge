import { ProxyStateTree } from 'proxy-state-tree';
import { StateManager } from './StateManager';
import { SchemaManager, Relationship } from './SchemaManager';
import { getEntityName } from '../utils';
import { EntityAction, EntityStrategy, updatePartialEntity, deleteEntity, updateEntity } from './entities';

/**
 * Interface for proxy-state-tree mutation object
 */
interface ProxyMutation {
  path: string;
  method: string;
  args: any[];
}

/**
 * EntityProxyManager provides a reactive interface to entity data with automatic state updates
 * and relationship handling, using proxy-state-tree for the proxy implementation.
 */
export class EntityProxyManager {
  // The main proxy-state-tree instance
  private static proxyStateTree: ProxyStateTree<Record<string, Record<string, any>>>;

  // Cache of entity IDs to avoid recreating proxies
  private static readonly entityCache = new Map<string, any>();

  // Map of entity IDs to their StateManager instances
  private static readonly entityStateManagers = new Map<string, StateManager>();

  /**
   * Initialize the proxy-state-tree instance
   * This should be called once at application startup
   */
  public static initialize(): void {
    if (!this.proxyStateTree) {
      this.proxyStateTree = new ProxyStateTree<Record<string, Record<string, any>>>({});
    }
  }

  /**
   * Creates a proxy for an entity or returns a cached instance
   * @param entityName The entity type name
   * @param entityId The entity ID
   * @param data The entity data
   * @param stateManager The StateManager instance
   * @returns A proxy for the entity
   */
  public static createEntityProxy(entityName: string, entityId: string, data: any, stateManager: StateManager): any {
    const cacheKey = `${entityName}::${entityId}`;

    // Return cached proxy if it exists
    if (this.entityCache.has(cacheKey)) {
      return this.entityCache.get(cacheKey);
    }

    // Store the state manager for this entity
    this.entityStateManagers.set(cacheKey, stateManager);

    // Get a mutation tree for this entity
    const mutationTree = this.proxyStateTree.getMutationTree();

    // Set the entity data in the tree
    if (!mutationTree.state[entityName]) {
      mutationTree.state[entityName] = {};
    }
    mutationTree.state[entityName][entityId] = data;

    // Setup mutation handler for this entity
    mutationTree.onMutation((mutation: ProxyMutation) => {
      // Only handle mutations for this specific entity
      if (mutation.path.startsWith(`${entityName}.${entityId}`)) {
        this.handleEntityMutation(entityName, entityId, mutation);
      }
    });

    // Get the proxy for this entity
    const entityProxy = mutationTree.state[entityName][entityId];

    // Cache the proxy
    this.entityCache.set(cacheKey, entityProxy);

    return entityProxy;
  }

  /**
   * Handles mutations to an entity
   * @param entityName The entity type name
   * @param entityId The entity ID
   * @param mutation The mutation object from proxy-state-tree
   */
  private static handleEntityMutation(entityName: string, entityId: string, mutation: ProxyMutation): void {
    const cacheKey = `${entityName}::${entityId}`;
    const stateManager = this.entityStateManagers.get(cacheKey);

    if (!stateManager) {
      return;
    }

    // Extract the path parts
    const pathParts = mutation.path.split('.');
    if (pathParts.length < 3) {
      return;
    }

    // Get the mutation tree to access the current state
    const mutationTree = this.proxyStateTree.getMutationTree();

    // The first field in the path after entityName.entityId
    const topLevelField = pathParts[2];

    // Get the current value of the field
    const currentValue = mutationTree.state[entityName][entityId][topLevelField];

    // Check if this is a relationship field
    const relationships = SchemaManager.relationshipMap[entityName];
    const relation = relationships?.[topLevelField];

    if (pathParts.length === 3) {
      // Simple case: direct property of the entity
      this.handleRelationshipMutation(entityName, entityId, topLevelField, currentValue, stateManager);
    } else if (relation) {
      // This is a nested update within a relationship field
      // We need to identify which entities were affected and update them directly
      this.processNestedMutation(
        entityName,
        entityId,
        topLevelField,
        pathParts.slice(3),
        currentValue,
        stateManager,
        relation,
        mutation
      );
    } else {
      // This is a nested update within a non-relationship field
      // Just update the entire field
      this.updateEntityField(entityName, entityId, topLevelField, currentValue, stateManager);
    }

    // Flush the mutation tree to notify listeners
    this.proxyStateTree.flush([mutationTree]);
  }

  /**
   * Process a mutation that affects nested entities
   * @param entityName The parent entity type name
   * @param entityId The parent entity ID
   * @param fieldName The relationship field name
   * @param nestedPath The path parts after the relationship field
   * @param currentValue The current value of the relationship field
   * @param stateManager The StateManager instance
   * @param relation The relationship information
   * @param mutation The original mutation object
   */
  private static processNestedMutation(
    entityName: string,
    entityId: string,
    fieldName: string,
    nestedPath: string[],
    currentValue: any,
    stateManager: StateManager,
    relation: Relationship,
    mutation: ProxyMutation
  ): void {
    const relatedEntityName = getEntityName(relation);
    const idAttribute = SchemaManager.schemas[relatedEntityName].idAttribute;

    // Special handling for array methods on the relationship array itself
    if (this.isArrayMethodMutation(mutation) && nestedPath.length === 0) {
      // Update the entire relationship field
      this.updateEntityField(entityName, entityId, fieldName, currentValue, stateManager);
      return;
    }

    // Determine which related entity was modified
    if (relation.isMany && Array.isArray(currentValue)) {
      // This is an array relationship
      const arrayIndex = Number(nestedPath[0]);

      if (!isNaN(arrayIndex) && arrayIndex < currentValue.length) {
        const item = currentValue[arrayIndex];
        let relatedEntityId;

        // Extract the ID based on the item type
        if (typeof item === 'string' || typeof item === 'number') {
          relatedEntityId = item.toString();
        } else if (typeof item === 'object' && item !== null) {
          relatedEntityId = typeof idAttribute === 'function' ? idAttribute(item) : item[idAttribute];
        }

        if (relatedEntityId) {
          // Check if the entity exists in the state before trying to update it
          if (stateManager.state[relatedEntityName]?.[relatedEntityId]) {
            // We found the related entity that was modified
            this.updateNestedEntity(relatedEntityName, relatedEntityId, nestedPath.slice(1), stateManager, mutation);
            return;
          }
        }

        // If we couldn't find the entity or it doesn't exist in state,
        // fall back to updating the entire relationship field
        this.updateEntityField(entityName, entityId, fieldName, currentValue, stateManager);
        return;
      }
    } else if (!relation.isMany && currentValue && typeof currentValue === 'object') {
      // This is a single entity relationship
      const relatedEntityId = typeof idAttribute === 'function' ? idAttribute(currentValue) : currentValue[idAttribute];

      if (relatedEntityId && stateManager.state[relatedEntityName]?.[relatedEntityId]) {
        // We found the related entity that was modified
        this.updateNestedEntity(relatedEntityName, relatedEntityId, nestedPath, stateManager, mutation);
        return;
      }
    }

    // If we couldn't determine which entity was modified, fall back to updating the entire field
    this.updateEntityField(entityName, entityId, fieldName, currentValue, stateManager);
  }

  /**
   * Update a nested entity based on a mutation
   * @param entityName The entity type name
   * @param entityId The entity ID
   * @param nestedPath The remaining path within the entity
   * @param stateManager The StateManager instance
   * @param mutation The original mutation object
   */
  private static updateNestedEntity(
    entityName: string,
    entityId: string,
    nestedPath: string[],
    stateManager: StateManager,
    mutation: ProxyMutation
  ): void {
    // Get the current entity from the state
    const entity = stateManager.state[entityName]?.[entityId];

    if (!entity) {
      // Entity doesn't exist in state, can't update it
      return;
    }

    // Create a copy of the entity to modify
    const updatedEntity = { ...entity };

    if (nestedPath.length === 0) {
      // The entity itself was replaced
      // This shouldn't happen in normal operation, but handle it just in case
      stateManager.dispatch([updateEntity(updatedEntity, entityName)], false, stateManager.instanceId);
      return;
    }

    // The field within the entity that was modified
    const fieldName = nestedPath[0];

    // Check if the field exists in the entity
    if (!(fieldName in entity)) {
      // Field doesn't exist, can't update it
      return;
    }

    if (nestedPath.length === 1) {
      // Direct field update
      let newValue;
      let strategy: EntityStrategy = '$merge';

      // Special handling for array methods
      if (this.isArrayMethodMutation(mutation)) {
        // For array methods, we need to get the entire updated array
        const mutationTree = this.proxyStateTree.getMutationTree();

        if (mutationTree.state[entityName]?.[entityId]?.[fieldName]) {
          // Get the current array from the mutation tree
          const currentArray = mutationTree.state[entityName][entityId][fieldName];

          // Create a deep copy of the array
          newValue = JSON.parse(JSON.stringify(currentArray));
          strategy = '$merge';
        } else if (mutation.method === 'push' && Array.isArray(entity[fieldName])) {
          // If we can't get the array from the mutation tree but we know it's a push operation
          // Create a new array with the pushed item
          newValue = [...entity[fieldName], ...mutation.args];
          strategy = '$merge';
        } else {
          // Fallback to the mutation args
          newValue = mutation.args[0];
          strategy = '$merge';
        }
      } else {
        // For direct property assignment
        newValue = mutation.args[0];

        // Use $set for arrays and null values
        if (Array.isArray(newValue) || newValue === null || newValue === undefined) {
          strategy = '$set';
        }
      }

      // Update the entity
      stateManager.dispatch(
        [updatePartialEntity(entityName, entityId, { [entityId]: { [fieldName]: newValue } }, strategy)],
        false,
        stateManager.instanceId
      );
      return;
    }

    // This is a nested update within the entity
    // Check if this field is itself a relationship
    const relationships = SchemaManager.relationshipMap[entityName];
    const relation = relationships?.[fieldName];

    if (relation) {
      // This is a nested relationship - recursively process it
      const fieldValue = entity[fieldName];
      this.processNestedMutation(
        entityName,
        entityId,
        fieldName,
        nestedPath.slice(1),
        fieldValue,
        stateManager,
        relation,
        mutation
      );
    } else {
      // This is a nested object field, not a relationship
      // We need to create a partial update for just this field

      // Get the current value of the field
      let currentValue = entity[fieldName];

      // If it's undefined or null, initialize it
      if (currentValue === undefined || currentValue === null) {
        currentValue = nestedPath[1] === '0' || !isNaN(Number(nestedPath[1])) ? [] : {};
      }

      // Create a deep copy
      const updatedValue = JSON.parse(JSON.stringify(currentValue));

      // Navigate to the nested property
      let target = updatedValue;
      let validPath = true;

      for (let i = 1; i < nestedPath.length - 1; i++) {
        const part = nestedPath[i];

        // If the part is a number, ensure we have an array
        if (!isNaN(Number(part))) {
          if (!Array.isArray(target)) {
            target = [];
          }

          // Check if the array index exists
          if (Number(part) >= target.length) {
            validPath = false;
            break;
          }
        } else if (target[part] === undefined || target[part] === null) {
          // Initialize the next level if needed
          target[part] = nestedPath[i + 1] === '0' || !isNaN(Number(nestedPath[i + 1])) ? [] : {};
        }

        target = target[part];

        // If target becomes null or undefined, the path is invalid
        if (target === undefined || target === null) {
          validPath = false;
          break;
        }
      }

      // If the path is invalid, we can't update
      if (!validPath) {
        return;
      }

      // Set the value at the final path
      const lastPart = nestedPath[nestedPath.length - 1];

      // Special handling for array methods
      if (this.isArrayMethodMutation(mutation)) {
        if (mutation.method === 'push' && Array.isArray(target[lastPart])) {
          // For push operations, add the items to the array
          target[lastPart] = [...target[lastPart], ...mutation.args];
        } else if (mutation.method === 'pop' && Array.isArray(target[lastPart])) {
          // For pop operations, remove the last item
          target[lastPart] = target[lastPart].slice(0, -1);
        } else if (mutation.method === 'shift' && Array.isArray(target[lastPart])) {
          // For shift operations, remove the first item
          target[lastPart] = target[lastPart].slice(1);
        } else if (mutation.method === 'unshift' && Array.isArray(target[lastPart])) {
          // For unshift operations, add items to the beginning
          target[lastPart] = [...mutation.args, ...target[lastPart]];
        } else if (mutation.method === 'splice' && Array.isArray(target[lastPart])) {
          // For splice operations, create a new array with the splice applied
          const newArray = [...target[lastPart]];
          // Apply splice manually with individual arguments
          newArray.splice(
            Number(mutation.args[0]),
            mutation.args.length > 1 ? Number(mutation.args[1]) : 0,
            ...mutation.args.slice(2)
          );
          target[lastPart] = newArray;
        } else {
          // For other methods or if the target is not an array, just set the value
          target[lastPart] = mutation.args[0];
        }
      } else {
        // For direct property assignment
        target[lastPart] = mutation.args[0];
      }

      // Always use $set for array operations to ensure the entire array is updated
      const strategy = this.isArrayMethodMutation(mutation) || Array.isArray(target[lastPart]) ? '$set' : '$merge';

      // Update just this field
      stateManager.dispatch(
        [updatePartialEntity(entityName, entityId, { [entityId]: { [fieldName]: updatedValue } }, strategy)],
        false,
        stateManager.instanceId
      );
    }
  }

  /**
   * Handles mutations to entity relationships
   * @param entityName The entity type name
   * @param entityId The entity ID
   * @param fieldName The field that was changed
   * @param newValue The new value of the field
   * @param stateManager The StateManager instance
   */
  private static handleRelationshipMutation(
    entityName: string,
    entityId: string,
    fieldName: string,
    newValue: any,
    stateManager: StateManager
  ): void {
    // Get relationship information
    const relationships = SchemaManager.relationshipMap[entityName];
    const relation = relationships?.[fieldName];

    if (!relation) {
      // Not a relationship field, just update the entity
      this.updateEntityField(entityName, entityId, fieldName, newValue, stateManager);
      return;
    }

    const relatedEntityName = getEntityName(relation);
    const idAttribute = SchemaManager.schemas[relatedEntityName].idAttribute;

    // Process the value based on relationship type
    let processedValue = newValue;
    let removedEntityIds: string[] = [];
    let addedEntities: any[] = [];

    // Get the old value from the state manager
    const oldValue = stateManager.state[entityName]?.[entityId]?.[fieldName];

    if (Array.isArray(newValue)) {
      // Handle array relationships
      if (Array.isArray(oldValue)) {
        // Track removed entities
        const oldIds = oldValue.map((item: any) => {
          // Extract ID from item, handling different item types
          if (typeof item === 'string' || typeof item === 'number') {
            return item.toString();
          }
          return typeof idAttribute === 'function' ? idAttribute(item) : item[idAttribute];
        });

        // Process new values and track added entities
        const newIds: string[] = [];
        addedEntities = newValue.filter((item: any) => {
          // Skip if it's just an ID reference
          if (typeof item === 'string' || typeof item === 'number') {
            const id = item.toString();
            newIds.push(id);
            return !oldIds.includes(id);
          }

          // It's an entity object
          const id = typeof idAttribute === 'function' ? idAttribute(item) : item[idAttribute];
          newIds.push(id);
          return !oldIds.includes(id) && typeof item === 'object';
        });

        removedEntityIds = oldIds.filter((id: string) => !newIds.includes(id));
      } else {
        // If oldValue wasn't an array, all entities are new
        addedEntities = newValue.filter((item: any) => typeof item === 'object' && item !== null);
      }

      // Convert array of entities to array of IDs
      processedValue = newValue.map((item: any) => {
        if (typeof item === 'string' || typeof item === 'number') {
          return item.toString(); // Already an ID
        }
        return typeof idAttribute === 'function' ? idAttribute(item) : item[idAttribute];
      });
    } else if (newValue && typeof newValue === 'object') {
      // Handle single entity relationships
      if (oldValue && typeof oldValue !== 'undefined') {
        let oldId;
        if (typeof oldValue === 'string' || typeof oldValue === 'number') {
          oldId = oldValue.toString();
        } else {
          oldId = typeof idAttribute === 'function' ? idAttribute(oldValue) : oldValue[idAttribute];
        }

        const newId = typeof idAttribute === 'function' ? idAttribute(newValue) : newValue[idAttribute];

        if (oldId && oldId !== newId) {
          removedEntityIds.push(oldId);
          addedEntities.push(newValue);
        }
      } else {
        // If there was no previous value, this is a new entity
        addedEntities.push(newValue);
      }

      // Convert single entity reference to ID
      processedValue = typeof idAttribute === 'function' ? idAttribute(newValue) : newValue[idAttribute];
    } else if (newValue === null || newValue === undefined) {
      // Handle setting a relationship to null/undefined
      if (oldValue && typeof oldValue !== 'undefined') {
        let oldId;
        if (typeof oldValue === 'string' || typeof oldValue === 'number') {
          oldId = oldValue.toString();
        } else {
          oldId = typeof idAttribute === 'function' ? idAttribute(oldValue) : oldValue[idAttribute];
        }

        if (oldId) {
          removedEntityIds.push(oldId);
        }
      }

      // Set processed value to null
      processedValue = null;
    }

    // Determine update strategy
    let strategy: EntityStrategy = '$merge';
    if (Array.isArray(oldValue)) {
      strategy = Array.isArray(newValue) ? '$set' : '$push';
    } else if (newValue === null || newValue === undefined) {
      strategy = '$set';
    }

    // Create actions
    const actions: EntityAction[] = [];

    // Add actions for added entities
    if (addedEntities.length > 0 && relation) {
      const relatedEntityName = getEntityName(relation);

      addedEntities.forEach((entity: any) => {
        // Only add if it's a valid entity object
        if (entity && typeof entity === 'object') {
          const idAttribute = SchemaManager.schemas[relatedEntityName].idAttribute;
          const entityId = typeof idAttribute === 'function' ? idAttribute(entity) : entity[idAttribute];

          if (entityId) {
            actions.push(updateEntity(entity, relatedEntityName));
          }
        }
      });
    }

    // Add update action for this entity
    actions.push(
      updatePartialEntity(
        entityName,
        entityId,
        {
          [entityId]: {
            [fieldName]: relation ? processedValue : JSON.parse(JSON.stringify(processedValue))
          }
        },
        strategy
      )
    );

    // Add deleteEntity actions for removed entities if they're no longer referenced
    if (removedEntityIds.length > 0 && relation) {
      const relatedEntityName = getEntityName(relation);

      removedEntityIds.forEach((entityId: string) => {
        if (
          !stateManager.isEntityReferenced(relatedEntityName, entityId, {
            entityName: entityName,
            fieldName: fieldName
          })
        ) {
          actions.push(deleteEntity(entityId, relatedEntityName));
        }
      });
    }

    // Dispatch all actions
    stateManager.dispatch(actions, false, stateManager.instanceId);
  }

  /**
   * Updates an entity field in the state
   */
  private static updateEntityField(
    entityName: string,
    entityId: string,
    fieldName: string,
    newValue: any,
    stateManager: StateManager
  ): void {
    // Determine update strategy
    let strategy: EntityStrategy = '$merge';

    // Use $set strategy for arrays to ensure complete replacement
    if (Array.isArray(newValue)) {
      strategy = '$set';
    } else if (newValue === undefined) {
      strategy = '$unset';
    }

    // Create the update action
    const action = updatePartialEntity(
      entityName,
      entityId,
      {
        [entityId]: {
          [fieldName]: JSON.parse(JSON.stringify(newValue))
        }
      },
      strategy
    );

    // Dispatch the action
    stateManager.dispatch([action], false, stateManager.instanceId);
  }

  /**
   * Checks if a mutation is an array method operation
   * @param mutation The mutation object
   * @returns True if the mutation is an array method operation
   */
  private static isArrayMethodMutation(mutation: ProxyMutation): boolean {
    return (
      !!mutation.method && ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse'].includes(mutation.method)
    );
  }

  /**
   * Clear the entity cache
   */
  public static clearCache(): void {
    this.entityCache.clear();
    this.entityStateManagers.clear();
  }

  /**
   * Remove a specific entity from the cache
   * @param entityName The entity type name
   * @param entityId The entity ID
   */
  public static removeFromCache(entityName: string, entityId: string): void {
    const cacheKey = `${entityName}::${entityId}`;
    this.entityCache.delete(cacheKey);
    this.entityStateManagers.delete(cacheKey);
  }
}
