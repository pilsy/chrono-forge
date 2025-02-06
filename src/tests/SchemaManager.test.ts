import { SchemaManager, SchemasDefinition } from '../store/SchemaManager';
import { EntitiesState, updateNormalizedEntity, deleteNormalizedEntity } from '../store/entities';
import { cloneDeep } from 'lodash';
import StateManager from '../store/StateManager';

describe('SchemaManager Functionality', () => {
  let schemaManager: ReturnType<typeof SchemaManager.getInstance>;
  let stateManager!: ReturnType<typeof StateManager.getInstance>;
  const userSchemaConfig: SchemasDefinition = {
    User: {
      idAttribute: 'id',
      articles: ['Article']
    },
    Article: {
      idAttribute: 'id',
      author: 'User',
      comments: ['Comment']
    },
    Comment: {
      idAttribute: 'id',
      commenter: 'User'
    }
  };

  const initialUserState: EntitiesState = {
    User: {
      user1: { id: 'user1', name: 'John Doe', articles: ['article1'] }
    },
    Article: {
      article1: { id: 'article1', title: 'Great Article', author: 'user1', comments: [] }
    }
  };

  beforeEach(() => {
    schemaManager = SchemaManager.getInstance();
    schemaManager.setSchemas(userSchemaConfig);
    stateManager = StateManager.getInstance('__test__');
    stateManager.state = cloneDeep(initialUserState);
  });

  // Basic State Management Tests
  it('should add a new entity correctly', async () => {
    const newUser = { id: 'user2', name: 'Jane Doe', articles: [] };
    await stateManager.dispatch(updateNormalizedEntity({ user2: newUser }, 'User'));

    const state = stateManager.state;
    expect(state.User['user2']).toEqual(newUser);
  });

  it('should update an existing entity correctly', async () => {
    const updatedUser = { id: 'user1', name: 'John Smith', articles: ['article1'] };
    await stateManager.dispatch(updateNormalizedEntity({ user1: updatedUser }, 'User'));

    const state = stateManager.state;
    expect(state.User['user1'].name).toBe('John Smith');
  });

  it('should delete an entity correctly', async () => {
    await stateManager.dispatch(deleteNormalizedEntity('user1', 'User'));

    const state = stateManager.state;
    expect(state.User['user1']).toBeUndefined();
  });

  // State Change Event Tests
  it('should emit state change events on entity addition', async () => {
    const newUser = { id: 'user2', name: 'Jane Doe', articles: [] };
    const stateChangeSpy = jest.fn();
    stateManager.on('stateChange', stateChangeSpy);

    await stateManager.dispatch(updateNormalizedEntity(newUser, 'User'));

    expect(stateChangeSpy).toHaveBeenCalledTimes(1);
  });
});
