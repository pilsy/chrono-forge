import { SchemaManager, SchemaDefinition, SchemasDefinition } from '../store/SchemaManager';
import {
  EntitiesState,
  EntityAction,
  updateNormalizedEntity,
  deleteNormalizedEntity,
  updateNormalizedEntities,
  deleteNormalizedEntities
} from '../utils/entities';
import { normalize } from 'normalizr';
import { cloneDeep } from 'lodash';
import StateManager from '../store/StateManager';

describe('SchemaManager with Undo/Redo Functionality', () => {
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

  afterEach(() => {
    stateManager.clear();
    stateManager.state = {}; // Reset state after each test
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

  // Undo/Redo Tests
  // it.skip('should not emit state change events on undo without any changes', async () => {
  //   const stateChangeSpy = jest.fn();
  //   schemaManager.on('stateChange', stateChangeSpy);

  //   await schemaManager.undo();

  //   expect(stateChangeSpy).not.toHaveBeenCalled();
  // });
  // it.skip('should undo the last addition of an entity', async () => {
  //   const newUser = { id: 'user2', name: 'Jane Doe', articles: [] };
  //   await schemaManager.dispatch(updateNormalizedEntity(newUser, 'User'));

  //   await schemaManager.undo();

  //   const state = schemaManager.getState();
  //   expect(state.User['user2']).toBeUndefined();
  // });

  // it.skip('should redo an addition of an entity after undo', async () => {
  //   const newUser = { id: 'user2', name: 'Jane Doe', articles: [] };
  //   await schemaManager.dispatch(updateNormalizedEntity({ user2: newUser }, 'User'));
  //   await schemaManager.undo();
  //   await schemaManager.redo();

  //   const state = schemaManager.getState();
  //   expect(state.User['user2']).toEqual(newUser);
  // });
  // it.skip('should undo multiple actions and then redo them correctly', async () => {
  //   const newUser = { id: 'user2', name: 'Jane Doe', articles: [] };
  //   const newArticle = { id: 'article2', title: 'Another Article', author: 'user1', comments: [] };

  //   await schemaManager.dispatch(updateNormalizedEntity({ user2: newUser }, 'User'));
  //   await schemaManager.dispatch(updateNormalizedEntity({ article2: newArticle }, 'Article'));

  //   await schemaManager.undo(); // Undo article addition
  //   await schemaManager.undo(); // Undo user addition

  //   let state = schemaManager.getState();
  //   expect(state.User['user2']).toBeUndefined();
  //   expect(state.Article['article2']).toBeUndefined();

  //   await schemaManager.redo(); // Redo user addition
  //   await schemaManager.redo(); // Redo article addition

  //   state = schemaManager.getState();
  //   expect(state.User['user2']).toEqual(newUser);
  //   expect(state.Article['article2']).toEqual(newArticle);
  // });
  // // Edge Case Tests
  // it.skip('should handle undo and redo operations correctly without any changes', async () => {
  //   await schemaManager.undo(); // Should not throw or change state
  //   await schemaManager.redo(); // Should not throw or change state

  //   const state = schemaManager.getState();
  //   expect(state).toEqual(initialUserState); // State should remain the same
  // });

  // it.skip('should limit the history stack size to prevent memory overflow', async () => {
  //   schemaManager.maxHistorySize = 3; // Set history size limit to 3

  //   for (let i = 0; i < 5; i++) {
  //     await schemaManager.dispatch(updateNormalizedEntity({ [`user${i}`]: { id: `user${i}`, name: `User ${i}` } }, 'User'));
  //   }

  //   expect(schemaManager['history'].length).toBe(3); // History should have a maximum of 3 entries
  // });

  // it.skip('should correctly undo/redo deep state changes', async () => {
  //   const newComment = { id: 'comment1', content: 'Great post!', commenter: 'user1' };
  //   await schemaManager.dispatch(updateNormalizedEntity(newComment, 'Comment'));

  //   const initialState = cloneDeep(schemaManager.getState());

  //   await schemaManager.dispatch(updateNormalizedEntity({ id: 'user1', name: 'John Doe Updated' }, 'User'));
  //   await schemaManager.dispatch(updateNormalizedEntity({ id: 'article1', title: 'Updated Title' }, 'Article'));

  //   await schemaManager.undo(); // Undo article update
  //   await schemaManager.undo(); // Undo user update

  //   const state = schemaManager.getState();
  //   expect(state).toEqual(initialState); // State should revert to initial after undos
  // });
});
