### Entities Reducer and Actions Documentation

#### Overview

This documentation covers the `entities` reducer and its associated action creators, helper functions, and tests. The purpose of this module is to manage a normalized state structure, where entities of different types are stored in a single state object. It uses the `immutability-helper` library to perform updates on the state in an immutable way.

### Entities State Structure

The `EntitiesState` is a `Record<string, Record<string, any>>`, where:
- The first string key represents the type of entity (e.g., `User`, `Post`, etc.).
- The second string key represents the unique ID of the entity.
- The value is the entity's data.

### Action Types

- **`UPDATE_ENTITY`**: Upsert (update or insert) a single entity.
- **`UPDATE_ENTITIES`**: Upsert multiple entities.
- **`DELETE_ENTITY`**: Remove a single entity.
- **`DELETE_ENTITIES`**: Remove multiple entities.
- **`CLEAR_ENTITIES`**: Clear all entities from the state.

### Action Creators

#### `updateNormalizedEntity`

```typescript
export const updateNormalizedEntity = (
  entity: Record<string, any>,
  entityName: string
): EntityAction => {
  if (!entity || !entityName) {
    throw new Error("Entity and entityName must be provided.");
  }
  return {
    type: UPDATE_ENTITY,
    entity,
    entityName,
  };
};
```

**Purpose**: Creates an action to upsert a single normalized entity into the state.

**Parameters**:
- `entity`: The entity object to upsert.
- `entityName`: The type of entity (e.g., `User`, `Post`).

**Example**:
```typescript
const action = updateNormalizedEntity({ id: 1, name: 'John' }, 'User');
```

#### `updateNormalizedEntities`

```typescript
export const updateNormalizedEntities = (
  entities: Record<string, unknown>,
  strategy: "$set" | "$merge" = "$merge"
): EntityAction => {
  if (!entities || typeof entities !== "object") {
    throw new Error("Entities must be provided and must be an object.");
  }
  return {
    type: UPDATE_ENTITIES,
    entities,
    strategy,
  };
};
```

**Purpose**: Creates an action to upsert multiple normalized entities into the state.

**Parameters**:
- `entities`: A record of entities to upsert.
- `strategy`: Either `"$set"` or `"$merge"`. Determines whether to fully replace (`$set`) or merge (`$merge`) the entities.

**Example**:
```typescript
const action = updateNormalizedEntities({
  User: { 1: { id: 1, name: 'John' }, 2: { id: 2, name: 'Jane' } }
});
```

#### `deleteNormalizedEntity`

```typescript
export const deleteNormalizedEntity = (
  entityId: string,
  entityName: string
): EntityAction => {
  if (!entityId || !entityName) {
    throw new Error("EntityId and entityName must be provided.");
  }
  return {
    type: DELETE_ENTITY,
    entityId,
    entityName,
  };
};
```

**Purpose**: Creates an action to delete a single entity from the state.

**Parameters**:
- `entityId`: The unique ID of the entity to delete.
- `entityName`: The type of entity (e.g., `User`, `Post`).

**Example**:
```typescript
const action = deleteNormalizedEntity('1', 'User');
```

#### `deleteNormalizedEntities`

```typescript
export const deleteNormalizedEntities = (
  entities: Record<string, string[]>
): EntityAction => {
  if (!entities || typeof entities !== "object") {
    throw new Error("Entities must be provided and must be an object.");
  }
  return {
    type: DELETE_ENTITIES,
    entities,
  };
};
```

**Purpose**: Creates an action to delete multiple entities from the state.

**Parameters**:
- `entities`: A record of entity types and their corresponding IDs to delete.

**Example**:
```typescript
const action = deleteNormalizedEntities({
  User: ['1', '2'],
});
```

#### `clearEntities`

```typescript
export const clearEntities = (): EntityAction => ({
  type: CLEAR_ENTITIES,
});
```

**Purpose**: Creates an action to clear all entities from the state.

**Example**:
```typescript
const action = clearEntities();
```

### Helper Functions

#### `handleUpdateEntities`

```typescript
export const handleUpdateEntities = (
  state: EntitiesState,
  entities: Record<string, any>,
  strategy: "$set" | "$merge" = "$merge"
): Spec<EntitiesState> => {
  return Object.entries(entities).reduce<EntitiesSpec<EntitiesState>>((updateStatement, [entityName, entityData]) => {
    const entitySpec = !state[entityName] || strategy === "$set"
      ? { $set: entityData }
      : Object.entries(entityData).reduce<EntitiesSpec<EntitiesState>>((entityUpdate, [entityId, entity]) => {
        entityUpdate[entityId] = {
          [state[entityName][entityId] ? "$merge" : "$set"]: entity,
        };
        return entityUpdate;
      }, {} as EntitiesSpec<EntitiesState>);

    updateStatement[entityName] = entitySpec;
    return updateStatement;
  }, {} as EntitiesSpec<EntitiesState>);
};
```

**Purpose**: Generates a specification for updating entities in the state.

**Parameters**:
- `state`: The current state.
- `entities`: The entities to update.
- `strategy`: Either `"$set"` or `"$merge"`.

**Example**:
```typescript
const updateSpec = handleUpdateEntities(currentState, {
  User: { 1: { id: 1, name: 'Updated John' }, 2: { id: 2, name: 'Updated Jane' } }
});
```

#### `handleDeleteEntities`

```typescript
export const handleDeleteEntities = (
  entities: Record<string, string[]>
): Spec<EntitiesState> => {
  return Object.entries(entities).reduce<EntitiesSpec<EntitiesState>>((deleteStatement, [entityName, entityIds]) => {
    deleteStatement[entityName] = { $unset: entityIds };
    return deleteStatement;
  }, {} as EntitiesSpec<EntitiesState>);
};
```

**Purpose**: Generates a specification for deleting entities from the state.

**Parameters**:
- `entities`: The entities to delete, organized by entity type.

**Example**:
```typescript
const deleteSpec = handleDeleteEntities({
  User: ['1', '2']
});
```

### Reducer

```typescript
export default function reducer(
  state: EntitiesState = initialState,
  action: EntityAction
): EntitiesState {
  switch (action.type) {
    case UPDATE_ENTITY:
        if (!action.entityName || !action.entity) return state;
        return update(state, {
          [action.entityName]: {
            [action.entity.pid]: { $merge: action.entity }
          }
        });

    case UPDATE_ENTITIES:
      if (!action.entities) return state;
      return update(state, handleUpdateEntities(state, action.entities, action.strategy));

    case DELETE_ENTITY:
      if (!action.entityName || !action.entityId) return state;
      return update(state, handleDeleteEntities({ [action.entityName]: [action.entityId] }));

    case DELETE_ENTITIES:
      if (!action.entities) return state;
      return update(state, handleDeleteEntities(action.entities));

    case CLEAR_ENTITIES:
      return { ...defaultState };

    default:
      return state;
  }
}
```

**Purpose**: The `reducer` function updates the `EntitiesState` based on the dispatched action.

**Handled Actions**:
- `UPDATE_ENTITY`: Updates a single entity in the state.
- `UPDATE_ENTITIES`: Updates multiple entities in the state.
- `DELETE_ENTITY`: Deletes a single entity from the state.
- `DELETE_ENTITIES`: Deletes multiple entities from the state.
- `CLEAR_ENTITIES`: Clears all entities from the state.

**Example**:
```typescript
const newState = reducer(currentState, updateNormalizedEntity({ id: 1, name: 'John' }, 'User'));
```

### Testing

The `entities.test.ts` file contains comprehensive tests for action creators, helper functions, and the reducer.

**Test Coverage**:
- Action creators: Ensure that each action creator returns the correct action.
- Helper functions: Ensure that the `handleUpdateEntities` and `handleDeleteEntities` functions return the correct update/delete specifications.
- Reducer: Ensures that the reducer correctly handles each action type and returns the expected new state.

**Example Test**:
```typescript
describe('Entities', () => {
  describe('Action Creators', () => {
    it('should create an action to update a normalized entity', () => {
      const entity = { id: 1, name: 'EntityName' };
      const entityName = 'entities';
      const expectedAction = {
        type: UPDATE_ENTITY,
        entity,
        entityName,
      };
      expect(updateNormalizedEntity(entity, entityName)).toEqual(expectedAction);
    });
  });

  // Other tests...
});
```

### Conclusion

This module provides a robust foundation for managing normalized state structures in a Redux-like environment. By leveraging immutability and normalization, it ensures that your state remains consistent and easy to update, even as your application scales.