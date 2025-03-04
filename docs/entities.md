### Entities Reducer and Actions Documentation

#### Overview

This documentation covers the `entities` reducer and its associated action creators, helper functions, and tests. The purpose of this module is to manage a normalized state structure, where entities of different types are stored in a single state object. It uses the `immutability-helper` library to perform updates on the state in an immutable way.

### Entities State Structure

The `EntitiesState` is a `Record<string, EntityState>`, where:

- The first string key represents the type of entity (e.g., `User`, `Post`, etc.)
- The `EntityState` is a `Record<string | number, any>` where:
  - The key is the unique ID of the entity
  - The value is the entity's data

### Action Types

- **`UPDATE_ENTITIES`**: Upsert (update or insert) multiple entities
- **`UPDATE_ENTITIES_PARTIAL`**: Partially update multiple entities
- **`DELETE_ENTITIES`**: Remove multiple entities
- **`SET_STATE`**: Set the entire entities state

### Action Creators

#### `updateEntity`

```typescript
export const updateEntity = (
  entity: EntityState,
  entityName: string
): EntityAction => {
  return updateEntities([entity], entityName);
};
```

**Purpose**: Creates an action to upsert a single entity into the state.

**Parameters**:

- `entity`: The entity object to upsert
- `entityName`: The type of entity (e.g., `User`, `Post`)

#### `updateEntityPartial`

```typescript
export const updateEntityPartial = (
  entity: EntityState,
  entityName: string,
  strategy: EntityStrategy = '$merge'
): EntityAction => {
  return updateEntitiesPartial([entity], entityName, strategy);
};
```

**Purpose**: Creates an action to partially update a single entity.

**Parameters**:

- `entity`: The entity object to update
- `entityName`: The type of entity
- `strategy`: The update strategy to apply (defaults to `'$merge'`)

#### `updateEntities`

```typescript
export const updateEntities = (
  entities: EntityState[],
  entityName: string
): EntityAction => {
  return updateNormalizedEntities(
    normalize(Array.isArray(entities) ? entities : [entities], [getSchema(entityName)]).entities as EntitiesState
  );
};
```

**Purpose**: Creates an action to upsert multiple entities into the state.

**Parameters**:

- `entities`: Array of entities to upsert
- `entityName`: The type of entity

#### `updateEntitiesPartial`

```typescript
export const updateEntitiesPartial = (
  entities: EntityState[],
  entityName: string,
  strategy: EntityStrategy = '$merge'
): EntityAction => {
  return {
    type: UPDATE_ENTITIES_PARTIAL,
    entities: normalize(Array.isArray(entities) ? entities : [entities], [getSchema(entityName)])
      .entities as EntitiesState,
    strategy
  };
};
```

**Purpose**: Creates an action to partially update multiple entities.

**Parameters**:

- `entities`: Array of entities to update
- `entityName`: The type of entity
- `strategy`: The update strategy to apply (defaults to `'$merge'`)

#### `deleteEntity`

```typescript
export const deleteEntity = (
  entity: EntityState,
  entityName: string
): EntityAction => {
  return deleteEntities([entity], entityName);
};
```

**Purpose**: Creates an action to delete a single entity from the state.

**Parameters**:

- `entity`: The entity to delete
- `entityName`: The type of entity

#### `deleteEntities`

```typescript
export const deleteEntities = (
  entities: any[],
  entityName: string
): EntityAction => {
  return deleteNormalizedEntities(normalize(entities, [getSchema(entityName)]).entities as EntitiesState);
};
```

**Purpose**: Creates an action to delete multiple entities from the state.

**Parameters**:

- `entities`: Array of entities to delete
- `entityName`: The type of entity

### Update Strategies

The module supports various update strategies for modifying entities:

- **`$replace`**: Completely replaces each entity with new data
- **`$set`**: Sets specific fields in each entity
- **`$merge`**: Merges new data with existing entity data
- **`$unset`**: Removes specified fields from entities
- **`$push`**: Adds items to the end of an array
- **`$unshift`**: Adds items to the beginning of an array
- **`$splice`**: Removes/replaces items in an array
- **`$apply`**: Applies a function to transform a value
- **`$toggle`**: Toggles boolean values
- **`$add`**: Adds items to a collection
- **`$remove`**: Removes items from a collection

### Helper Functions

#### `normalizeEntities`

```typescript
export const normalizeEntities = <T>(
  data: T | T[],
  entitySchema: Schema | string
): EntitiesState => {
  const schema = typeof entitySchema === 'string' ? getSchema(entitySchema) : entitySchema;
  const { entities } = normalize(data, Array.isArray(data) ? [schema] : schema);
  return entities as EntitiesState;
};
```

**Purpose**: Normalizes entity data using normalizr.

**Parameters**:

- `data`: The entity or array of entities to normalize
- `entitySchema`: The schema to use for normalization or entity name

#### `createUpdateStatement`

```typescript
export const createUpdateStatement = (
  state: EntitiesState,
  normalizedEntities: EntitiesState
): Spec<EntitiesState> => {
  // Implementation details...
};
```

**Purpose**: Creates an update statement for immutability-helper to merge normalized entities into state.

**Parameters**:

- `state`: Current entities state
- `normalizedEntities`: Normalized entities to merge into state

#### `handleUpdateEntities`

```typescript
export const handleUpdateEntities = (
  state: EntitiesState,
  entities: EntityState,
  strategy: EntityStrategy = '$merge'
): Spec<EntitiesState> => {
  // Implementation details...
};
```

**Purpose**: Handles updating entities with different strategies.

**Parameters**:

- `state`: Current entities state
- `entities`: Entities to update
- `strategy`: Strategy to use for the update (defaults to `'$merge'`)

#### `handleDeleteEntities`

```typescript
export const handleDeleteEntities = (
  state: EntitiesState,
  entities: EntitiesState
): Spec<EntitiesState> => {
  // Implementation details...
};
```

**Purpose**: Creates a spec for deleting entities from the state.

**Parameters**:

- `state`: Current entities state
- `entities`: Entities to delete

### Reducer

```typescript
export function reducer(
  state: EntitiesState = initialState,
  action: EntityAction
): EntitiesState {
  const { entities = {}, strategy } = action;

  switch (action.type) {
    case UPDATE_ENTITIES:
    case UPDATE_ENTITIES_PARTIAL: {
      return update(state, handleUpdateEntities(state, entities, strategy));
    }
    case DELETE_ENTITIES: {
      return update(state, handleDeleteEntities(state, entities));
    }
    case SET_STATE: {
      return update(state, { $set: entities });
    }
    default: {
      return state;
    }
  }
}
```

**Purpose**: The `reducer` function updates the `EntitiesState` based on the dispatched action.

**Handled Actions**:

- `UPDATE_ENTITIES`: Updates multiple entities in the state
- `UPDATE_ENTITIES_PARTIAL`: Partially updates multiple entities
- `DELETE_ENTITIES`: Deletes multiple entities from the state
- `SET_STATE`: Sets the entire entities state

### Type Definitions

#### `EntityState`

```typescript
export type EntityState = Record<string | number, any>;
```

#### `EntitiesState`

```typescript
export type EntitiesState = Record<string, EntityState>;
```

#### `EntityStrategy`

```typescript
export type EntityStrategy =
  | '$replace'
  | '$set'
  | '$merge'
  | '$unset'
  | '$push'
  | '$unshift'
  | '$splice'
  | '$apply'
  | '$toggle'
  | '$add'
  | '$remove';
```

#### `IndexableSpec`

```typescript
export type IndexableSpec<T> = Spec<T> & {
  [key: string]: any;
};
```

### Usage Guide

#### Action Usage Examples

1. **Updating a Single Entity**

```typescript
// Update a single user
const user = { id: 1, name: 'John Doe', email: 'john@example.com' };
store.dispatch(updateEntity(user, 'User'));

// Partially update a user with a specific strategy
store.dispatch(updateEntityPartial(
  { id: 1, name: 'John Smith' },
  'User',
  '$merge'
));
```

2. **Updating Multiple Entities**

```typescript
// Update multiple users
const users = [
  { id: 1, name: 'John Doe' },
  { id: 2, name: 'Jane Smith' }
];
store.dispatch(updateEntities(users, 'User'));

// Partially update multiple users
store.dispatch(updateEntitiesPartial(
  [
    { id: 1, name: 'John Smith' },
    { id: 2, name: 'Jane Doe' }
  ],
  'User',
  '$merge'
));
```

3. **Deleting Entities**

```typescript
// Delete a single user
store.dispatch(deleteEntity({ id: 1 }, 'User'));

// Delete multiple users
store.dispatch(deleteEntities(
  [{ id: 1 }, { id: 2 }],
  'User'
));
```

4. **Setting Entire State**

```typescript
// Clear all entities
store.dispatch(setState({}));

// Set specific state
store.dispatch(setState({
  User: {
    1: { id: 1, name: 'John' },
    2: { id: 2, name: 'Jane' }
  }
}));
```

#### Update Strategy Examples

1. **Replace Strategy**

```typescript
store.dispatch(updateEntityPartial(
  { id: 1, name: 'John', email: 'john@example.com' },
  'User',
  '$replace'
));
```

2. **Set Strategy**

```typescript
store.dispatch(updateEntityPartial(
  { id: 1, name: 'John' },
  'User',
  '$set'
));
```

3. **Merge Strategy**

```typescript
store.dispatch(updateEntityPartial(
  { id: 1, name: 'John' },
  'User',
  '$merge'
));
```

4. **Array Operations**

```typescript
// Push to array
store.dispatch(updateEntityPartial(
  { id: 1, friends: ['friend1'] },
  'User',
  '$push'
));

// Unshift to array
store.dispatch(updateEntityPartial(
  { id: 1, notifications: ['new'] },
  'User',
  '$unshift'
));

// Splice array
store.dispatch(updateEntityPartial(
  { id: 1, items: [[1, 1, 'newItem']] },
  'User',
  '$splice'
));
```

5. **Apply Strategy**

```typescript
store.dispatch(updateEntityPartial(
  { id: 1, count: (prev: number) => prev + 1 },
  'User',
  '$apply'
));
```

### Testing

The `src/tests/entities.test.ts` file contains comprehensive tests for all functionality.

### Conclusion

This module provides a robust foundation for managing normalized state structures in a Redux-like environment. By leveraging immutability and normalization, it ensures that your state remains consistent and easy to update, even as your application scales. The variety of update strategies available makes it flexible enough to handle various data manipulation needs while maintaining immutability.

The comprehensive test suite ensures that all functionality works as expected, covering action creators, helper functions, the reducer, and all update strategies. The examples provided in this documentation should help you get started with using the entities module in your application.
