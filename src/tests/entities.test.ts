/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/no-var-requires */

import update, { Spec } from 'immutability-helper';
import { normalize } from 'normalizr';
import {
  reducer,
  updateNormalizedEntity,
  updateNormalizedEntities,
  deleteNormalizedEntity,
  deleteNormalizedEntities,
  clearEntities,
  UPDATE_ENTITY,
  UPDATE_ENTITIES,
  DELETE_ENTITY,
  DELETE_ENTITIES,
  CLEAR_ENTITIES,
  normalizeEntities,
  createUpdateStatement,
  initialState,
  handleUpdateEntities,
  handleDeleteEntities
} from '../store';

import type { EntitiesState } from '../store';
import schemas from './testSchemas';

describe('Entities', () => {
  describe('Action Creators', () => {
    it('should create an action to update a normalized entity', () => {
      const entity = { id: 1, name: 'EntityName' };
      const entityName = 'entities';
      const expectedAction = {
        type: UPDATE_ENTITY,
        entity,
        entityName
      };
      expect(updateNormalizedEntity(entity, entityName)).toEqual(expectedAction);
    });

    it('should create an action to update normalized entities with $merge strategy', () => {
      const entities = { entities: { 1: { id: 1, name: 'EntityName' } } };
      const expectedAction = {
        type: UPDATE_ENTITIES,
        entities,
        strategy: '$merge'
      };
      expect(updateNormalizedEntities(entities)).toEqual(expectedAction);
    });

    it('should create an action to delete a normalized entity', () => {
      const entityId = '1';
      const entityName = 'entities';
      const expectedAction = {
        type: DELETE_ENTITY,
        entityId,
        entityName
      };
      expect(deleteNormalizedEntity(entityId, entityName)).toEqual(expectedAction);
    });

    it('should create an action to delete normalized entities', () => {
      const entities = { entities: ['1', '2'] };
      const expectedAction = {
        type: DELETE_ENTITIES,
        entities
      };
      expect(deleteNormalizedEntities(entities)).toEqual(expectedAction);
    });

    it('should create an action to clear entities', () => {
      const expectedAction = { type: CLEAR_ENTITIES };
      expect(clearEntities()).toEqual(expectedAction);
    });
  });

  describe('Helper Functions', () => {
    const state: EntitiesState = {
      entities: {
        1: { id: 1, name: 'Entity1' },
        2: { id: 2, name: 'Entity2' }
      }
    };

    describe('normalizeEntities', () => {
      it('should normalize a single entity', () => {
        const user = { id: '1', name: 'Richard' };
        const normalizedData = normalizeEntities(user, schemas.User);

        expect(normalizedData).toEqual({
          User: {
            '1': { id: '1', name: 'Richard' }
          }
        });
      });

      it('should normalize an array of entities', () => {
        const users = [
          { id: '1', name: 'Richard' },
          { id: '2', name: 'Other' }
        ];
        const normalizedData = normalizeEntities(users, schemas.User);

        expect(normalizedData).toEqual({
          User: {
            '1': { id: '1', name: 'Richard' },
            '2': { id: '2', name: 'Other' }
          }
        });
      });
    });

    describe('createUpdateStatement', () => {
      it('should create an update statement with $merge strategy', () => {
        const state = {
          User: {
            '2': { id: '2', name: 'OldEntity2' }
          }
        };

        const normalizedEntities = {
          User: {
            '2': { id: '2', name: 'UpdatedEntity2' }
          }
        };

        const expectedStatement = {
          User: {
            '2': { $merge: { name: 'UpdatedEntity2', id: '2' } }
          }
        };

        const updateStatement = createUpdateStatement(state, normalizedEntities);
        expect(updateStatement).toEqual(expectedStatement);
      });
    });

    it('should create an update statement with $set strategy when entity does not exist', () => {
      const normalizedEntities = {
        User: {
          '3': { id: '3', name: 'Entity3' }
        }
      };
      const expectedStatement = {
        User: {
          $set: {
            '3': { name: 'Entity3', id: '3' }
          }
        }
      };

      const updateStatement = createUpdateStatement({}, normalizedEntities);
      expect(updateStatement).toEqual(expectedStatement);
    });
  });

  describe('handleUpdateEntities', () => {
    const state = {
      User: {
        '1': { id: '1', items: [1, 2, 3], name: 'OldName' },
        '2': { id: '2', items: [4, 5, 6], name: 'OtherName' }
      }
    };

    it('should create a spec to update entities with $push strategy', () => {
      const entities = {
        User: {
          '1': { someArray: [4] },
          '2': { someArray: [7, 8] }
        }
      };

      const expectedSpec = {
        User: {
          '1': { someArray: { $push: [4] } },
          '2': { someArray: { $push: [7, 8] } }
        }
      };

      const updateSpec = handleUpdateEntities(state, entities, '$push');
      expect(updateSpec).toEqual(expectedSpec);
    });

    it('should create a spec to update entities with $splice strategy', () => {
      // Define the entities to perform the $splice operation
      const entities = {
        User: {
          '1': { items: [] }, // The items field will be spliced
          '2': { items: [] } // The items field will be spliced
        }
      };

      const value = {
        '1': [[2, 0, 99]], // For entity '1', splice in 99 at index 2
        '2': [[1, 1]] // For entity '2', remove one element at index 1
      };

      const expectedSpec = {
        User: {
          '1': { items: { $splice: [[2, 0, 99]] } },
          '2': { items: { $splice: [[1, 1]] } }
        }
      };

      const updateSpec = handleUpdateEntities(state, entities, '$splice', value);
      expect(updateSpec).toEqual(expectedSpec);
    });

    it('should create a spec to update entities with $apply strategy', () => {
      const applyFunction = jest.fn((original) => ({ ...original, name: original.name.toUpperCase() }));

      const entities = {
        User: {
          '1': { name: 'ignoreThis' }, // Placeholder for mimicry; this field is not actually used in $apply
          '2': { name: 'ignoreThisToo' } // Same as above
        }
      };

      const expectedSpec = {
        User: {
          '1': { $apply: expect.any(Function) },
          '2': { $apply: expect.any(Function) }
        }
      };

      const updateSpec = handleUpdateEntities(state, entities, '$apply', applyFunction);
      expect(updateSpec).toEqual(expectedSpec);

      // Simulate application to verify the behavior
      const resultState = {
        User: {
          // @ts-ignore
          '1': updateSpec.User['1'].$apply(state.User['1']), // @ts-ignore
          '2': updateSpec.User['2'].$apply(state.User['2'])
        }
      };

      // Verify that the apply function was called with correct arguments
      expect(applyFunction).toHaveBeenCalledWith({ id: '1', items: [1, 2, 3], name: 'OldName' });
      expect(applyFunction).toHaveBeenCalledWith({ id: '2', items: [4, 5, 6], name: 'OtherName' });

      // Verify result state after application for correctness
      expect(resultState).toEqual({
        User: {
          '1': { id: '1', items: [1, 2, 3], name: 'OLDNAME' },
          '2': { id: '2', items: [4, 5, 6], name: 'OTHERNAME' }
        }
      });
    });

    it('should handle $push with initially undefined array', () => {
      const state = { User: { '1': {} } };
      const entities = { User: { '1': { items: [1, 2] } } };
      const expectedSpec = { User: { '1': { items: { $push: [1, 2] } } } };

      const updateSpec = handleUpdateEntities(state, entities, '$push');
      expect(updateSpec).toEqual(expectedSpec);
    });

    it('should throw an error when $push is used on a non-array field', () => {
      const state = { User: { '1': { items: 'notAnArray' } } };
      const entities = { User: { '1': { items: [1, 2] } } };

      expect(() => handleUpdateEntities(state, entities, '$push')).toThrow(
        "Expected array for $push operation on key '1.items'"
      );
    });

    it('should apply a complex transformation function to entities', () => {
      const applyFunction = jest.fn((original) => {
        if (original.id === '1') {
          return { ...original, extraField: 42 };
        }
        return { ...original, name: original.name.toLowerCase() };
      });

      const state = {
        User: {
          '1': { id: '1', name: 'OldName' },
          '2': { id: '2', name: 'AnotherName' }
        }
      };

      const entities = {
        User: {
          '1': { name: 'ignore' }, // Placeholder for an update
          '2': { name: 'ignore' }
        }
      };

      const expectedSpec = {
        User: {
          '1': { $apply: expect.any(Function) },
          '2': { $apply: expect.any(Function) }
        }
      };

      const updateSpec = handleUpdateEntities(state, entities, '$apply', applyFunction);
      expect(updateSpec).toEqual(expectedSpec);

      const resultState = {
        User: {
          // @ts-ignore
          '1': updateSpec.User['1'].$apply(state.User['1']), // @ts-ignore
          '2': updateSpec.User['2'].$apply(state.User['2'])
        }
      };

      expect(resultState).toEqual({
        User: {
          '1': { id: '1', name: 'OldName', extraField: 42 },
          '2': { id: '2', name: 'anothername' }
        }
      });
    });
    it('should correctly splice elements at boundary indices', () => {
      const state = {
        User: {
          '1': { items: [1, 2, 3, 4, 5] }
        }
      };
      const entities = { User: { '1': { items: [] } } };
      const value = {
        '1': [
          [0, 1],
          [4, 0, 99]
        ]
      }; // Remove first element, add 99 at the end
      const expectedSpec = {
        User: {
          '1': {
            items: {
              $splice: [
                [0, 1],
                [4, 0, 99]
              ]
            }
          }
        }
      };

      const updateSpec = handleUpdateEntities(state, entities, '$splice', value);
      expect(updateSpec).toEqual(expectedSpec);

      const resultState = update(state, updateSpec);
      expect(resultState).toEqual({
        User: {
          '1': { items: [2, 3, 4, 5, 99] }
        }
      });
    });

    it('should correctly handle $set strategy with arrays', () => {
      const state = {
        User: {
          '1': { id: '1', items: [1, 2, 3], name: 'OldName' },
          '2': { id: '2', items: [4, 5, 6], name: 'OtherName' }
        }
      };

      const entities = {
        User: {
          '1': { items: [7, 8, 9] },
          '2': { items: [] }
        }
      };

      const expectedSpec = {
        User: {
          '1': { items: { $set: [7, 8, 9] } },
          '2': { items: { $set: [] } }
        }
      };

      const updateSpec = handleUpdateEntities(state, entities, '$set');
      expect(updateSpec).toEqual(expectedSpec);

      const resultState = update(state, updateSpec);
      expect(resultState).toEqual({
        User: {
          '1': { id: '1', items: [7, 8, 9], name: 'OldName' },
          '2': { id: '2', items: [], name: 'OtherName' }
        }
      });
    });

    it('should correctly handle $unset strategy for individual fields', () => {
      const state = {
        User: {
          '1': { id: '1', items: [1, 2, 3], name: 'OldName', optional: 'value' },
          '2': { id: '2', items: [4, 5, 6], name: 'OtherName', optional: 'value' }
        }
      };

      const entities = {
        User: {
          '1': { optional: 'value' }, // Field to unset
          '2': { items: [4, 5, 6] } // Field to unset
        }
      };

      const expectedSpec = {
        User: {
          '1': { $unset: ['optional'] },
          '2': { $unset: ['items'] }
        }
      };

      const updateSpec = handleUpdateEntities(state, entities, '$unset');
      expect(updateSpec).toEqual(expectedSpec);

      // Let's manually verify the behavior by applying the update
      // and checking specific fields rather than the entire object
      const resultState = update(state, updateSpec);

      // Check that the specific fields were unset
      expect(resultState.User['1'].optional).toBeUndefined();
      expect(resultState.User['2'].items).toBeUndefined();

      // Check that other fields remain
      expect(resultState.User['1'].id).toBe('1');
      expect(resultState.User['1'].name).toBe('OldName');
      expect(resultState.User['1'].items).toEqual([1, 2, 3]);

      expect(resultState.User['2'].id).toBe('2');
      expect(resultState.User['2'].name).toBe('OtherName');
      expect(resultState.User['2'].optional).toBe('value');
    });

    it('should create a spec to update entities with $splice strategy for multiple fields', () => {
      // Define the entities to perform the $splice operation
      const entities = {
        User: {
          '1': { items: [], tags: [] }, // Test multiple fields
          '2': { customArray: [] } // Test different field name
        }
      };

      const value = {
        '1': [[2, 0, 99]], // For entity '1', splice in 99 at index 2
        '2': [[1, 1]] // For entity '2', remove one element at index 1
      };

      const expectedSpec = {
        User: {
          '1': {
            items: { $splice: [[2, 0, 99]] },
            tags: { $splice: [[2, 0, 99]] }
          },
          '2': {
            customArray: { $splice: [[1, 1]] }
          }
        }
      };

      const updateSpec = handleUpdateEntities(state, entities, '$splice', value);
      expect(updateSpec).toEqual(expectedSpec);
    });
  });

  describe('handleDeleteEntities', () => {
    it('should create a spec to delete entities', () => {
      const entities = {
        User: { '1': { id: '1' }, '2': { id: '2' } },
        Task: { '3': { id: '3' }, '4': { id: '4' } }
      };

      const expectedSpec = {
        User: { $unset: ['1', '2'] },
        Task: { $unset: ['3', '4'] }
      };

      const deleteSpec = handleDeleteEntities(entities);
      expect(deleteSpec).toEqual(expectedSpec);

      // Test applying the spec
      const state = {
        User: {
          '1': { id: '1', name: 'User 1' },
          '2': { id: '2', name: 'User 2' },
          '5': { id: '5', name: 'User 5' }
        },
        Task: {
          '3': { id: '3', title: 'Task 3' },
          '4': { id: '4', title: 'Task 4' },
          '6': { id: '6', title: 'Task 6' }
        }
      };

      const resultState = update(state, deleteSpec);

      // Verify entities were deleted
      expect(resultState.User['1']).toBeUndefined();
      expect(resultState.User['2']).toBeUndefined();
      expect(resultState.Task['3']).toBeUndefined();
      expect(resultState.Task['4']).toBeUndefined();

      // Verify other entities remain
      expect(resultState.User['5']).toEqual({ id: '5', name: 'User 5' });
      expect(resultState.Task['6']).toEqual({ id: '6', title: 'Task 6' });
    });
  });

  describe('Reducer', () => {
    let state: EntitiesState;
    beforeEach(() => {
      state = {
        User: {
          '1': { id: '1', name: 'Entity1' },
          '2': { id: '2', name: 'Entity2' }
        }
      };
    });

    it('should handle UPDATE_ENTITY', () => {
      const entity = { '1': { id: '1', name: 'UpdatedEntity1' } };
      const action = updateNormalizedEntity(entity, 'User');
      const newState = reducer(state, action);
      expect(newState).toEqual({
        User: {
          '1': { id: '1', name: 'UpdatedEntity1' },
          '2': { id: '2', name: 'Entity2' }
        }
      });
    });

    it('should handle UPDATE_ENTITIES', () => {
      const updates = {
        User: {
          ...normalize({ id: '2', name: 'UpdatedEntity2' }, schemas.User).entities.User,
          ...normalize({ id: '3', name: 'Entity3' }, schemas.User).entities.User
        }
      };
      const action = updateNormalizedEntities(updates);
      const newState = reducer(state, action);

      expect(newState).toEqual({
        User: {
          '1': { id: '1', name: 'Entity1' },
          '2': { id: '2', name: 'UpdatedEntity2' },
          '3': { id: '3', name: 'Entity3' }
        }
      });
    });

    it('should handle DELETE_ENTITY', () => {
      const action = deleteNormalizedEntity('1', 'User');
      const newState = reducer(state, action);

      expect(newState).toEqual({
        User: {
          '2': { id: '2', name: 'Entity2' }
        }
      });
    });

    it('should handle DELETE_ENTITIES', () => {
      const User = {
        User: {
          '1': {
            id: '1'
          },
          '2': {
            id: '2'
          }
        }
      };
      const action = deleteNormalizedEntities(User);
      const newState = reducer(state, action);

      expect(newState).toEqual({ User: {} });
    });

    it('should handle CLEAR_ENTITIES', () => {
      const action = clearEntities();
      const newState = reducer(state, action);

      expect(newState).toEqual(initialState);
    });

    it('should return the initial state when an unknown action is passed', () => {
      const action = { type: 'UNKNOWN_ACTION' } as any;
      const newState = reducer(state, action);

      expect(newState).toEqual(state);
    });
  });
});
