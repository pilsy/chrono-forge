/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/no-var-requires */

import update, { Spec } from 'immutability-helper';
import { normalize } from 'normalizr';
import {
  reducer,
  updateNormalizedEntities,
  deleteNormalizedEntities,
  clearEntities,
  UPDATE_ENTITIES,
  DELETE_ENTITIES,
  SET_STATE,
  normalizeEntities,
  createUpdateStatement,
  initialState,
  handleUpdateEntities,
  handleDeleteEntities,
  setState,
  updateEntity,
  updateEntities,
  updateEntityPartial,
  deleteEntities,
  deleteEntity,
  UPDATE_ENTITIES_PARTIAL
} from '../store';

import type { EntitiesState } from '../store';
import schemas from './testSchemas';

describe('Entities', () => {
  describe('Action Creators', () => {
    it('should create an action to update normalized entities with $merge strategy', () => {
      const entities = { entities: { '1': { id: '1', name: 'EntityName' } } };
      const expectedAction = {
        type: UPDATE_ENTITIES,
        entities,
        strategy: '$merge'
      };
      expect(updateNormalizedEntities(entities)).toEqual(expectedAction);
    });

    it('should create an action to update normalized entities with custom strategy', () => {
      const entities = { entities: { '1': { id: '1', name: 'EntityName' } } };
      const strategy = '$set' as const;
      const expectedAction = {
        type: UPDATE_ENTITIES,
        entities,
        strategy
      };
      expect(updateNormalizedEntities(entities, strategy)).toEqual(expectedAction);
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
      const expectedAction = { type: SET_STATE, entities: {} };
      expect(clearEntities()).toEqual(expectedAction);
    });

    it('should create an action to set state', () => {
      const entities = { User: { '1': { id: '1', name: 'Test' } } };
      const expectedAction = {
        type: SET_STATE,
        entities
      };
      expect(setState(entities)).toEqual(expectedAction);
    });

    it('should create an action to set empty state', () => {
      const expectedAction = {
        type: SET_STATE,
        entities: {}
      };
      expect(setState()).toEqual(expectedAction);
    });

    it('should create an action to update a single entity', () => {
      const entity = { id: '1', name: 'EntityName' };
      const entityName = 'User';
      const expectedAction = {
        type: UPDATE_ENTITIES,
        entities: {
          User: {
            '1': { id: '1', name: 'EntityName' }
          }
        },
        strategy: '$merge'
      };
      expect(updateEntity(entity, entityName)).toEqual(expectedAction);
    });

    it('should create an action to update multiple entities', () => {
      const entities = [
        { id: '1', name: 'Entity1' },
        { id: '2', name: 'Entity2' }
      ];
      const entityName = 'User';
      const expectedAction = {
        type: UPDATE_ENTITIES,
        entities: {
          User: {
            '1': { id: '1', name: 'Entity1' },
            '2': { id: '2', name: 'Entity2' }
          }
        },
        strategy: '$merge'
      };
      expect(updateEntities(entities, entityName)).toEqual(expectedAction);
    });

    it('should create an action to partially update an entity', () => {
      const strategy = '$merge' as const;
      const updatedEntity = { id: '1', name: 'UpdatedName' };
      const expectedAction = {
        type: UPDATE_ENTITIES_PARTIAL,
        entities: {
          User: {
            '1': updatedEntity
          }
        },
        strategy
      };
      expect(updateEntityPartial(updatedEntity, 'User', strategy)).toEqual(expectedAction);
    });

    it('should create an action to delete multiple entities', () => {
      const entities = [
        { id: '1', name: 'Entity1' },
        { id: '2', name: 'Entity2' }
      ];
      const entityName = 'User';
      const expectedAction = {
        type: DELETE_ENTITIES,
        entities: {
          User: {
            '1': { id: '1', name: 'Entity1' },
            '2': { id: '2', name: 'Entity2' }
          }
        }
      };
      expect(deleteEntities(entities, entityName)).toEqual(expectedAction);
    });

    it('should create an action to delete a single entity', () => {
      const entity = { id: '1', name: 'Entity1' };
      const entityName = 'User';
      const expectedAction = {
        type: DELETE_ENTITIES,
        entities: {
          User: {
            '1': { id: '1', name: 'Entity1' }
          }
        }
      };
      expect(deleteEntity(entity, entityName)).toEqual(expectedAction);
    });

    it('should throw error when schema is not found', () => {
      const entity = { id: '1', name: 'EntityName' };
      const entityName = 'NonExistentSchema';
      expect(() => updateEntity(entity, entityName)).toThrow(`Schema for ${entityName} not found.`);
    });
  });

  describe('Helper Functions', () => {
    const state: EntitiesState = {
      entities: {
        1: { id: '1', name: 'Entity1' },
        2: { id: '2', name: 'Entity2' }
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
          '1': { items: [[2, 0, 99]] }, // The items field will be spliced
          '2': { items: [[1, 1]] } // The items field will be spliced
        }
      };

      const expectedSpec = {
        User: {
          '1': { items: { $splice: [[2, 0, 99]] } },
          '2': { items: { $splice: [[1, 1]] } }
        }
      };

      const updateSpec = handleUpdateEntities(state, entities, '$splice');
      expect(updateSpec).toEqual(expectedSpec);
    });

    it('should create a spec to update entities with $apply strategy', () => {
      const applyFunction = jest.fn((original) => ({ ...original, name: original.name.toUpperCase() }));

      const entities = {
        User: {
          '1': applyFunction,
          '2': applyFunction
        }
      };

      const expectedSpec = {
        User: {
          '1': { $apply: expect.any(Function) },
          '2': { $apply: expect.any(Function) }
        }
      };

      const updateSpec = handleUpdateEntities(state, entities, '$apply');
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
          '1': applyFunction,
          '2': { name: (oldName: string) => oldName.toUpperCase() }
        }
      };

      const expectedSpec = {
        User: {
          '1': { $apply: expect.any(Function) },
          '2': {
            name: { $apply: expect.any(Function) }
          }
        }
      };

      const updateSpec = handleUpdateEntities(state, entities, '$apply');
      expect(updateSpec).toEqual(expectedSpec);

      const resultState = {
        User: {
          // @ts-ignore
          '1': updateSpec.User['1'].$apply(state.User['1']),
          '2': {
            id: '2', // @ts-ignore
            name: updateSpec?.User['2'].name.$apply(state.User['2'].name)
          }
        }
      };

      expect(resultState).toEqual({
        User: {
          '1': { id: '1', name: 'OldName', extraField: 42 },
          '2': { id: '2', name: 'ANOTHERNAME' }
        }
      });
    });

    it('should correctly splice elements at boundary indices', () => {
      const state = {
        User: {
          '1': { items: [1, 2, 3, 4, 5] }
        }
      };
      const entities = {
        User: {
          '1': {
            items: [
              [0, 1],
              [4, 0, 99]
            ]
          }
        }
      };
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

      const updateSpec = handleUpdateEntities(state, entities, '$splice');
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
          '1': { items: [[2, 0, 99]], tags: [[2, 0, 99]] }, // Test multiple fields
          '2': { customArray: [[1, 1]] } // Test different field name
        }
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

      const updateSpec = handleUpdateEntities(state, entities, '$splice');
      expect(updateSpec).toEqual(expectedSpec);
    });

    it('should correctly handle $replace strategy', () => {
      const state = {
        User: {
          '1': { id: '1', name: 'OldName' }
        }
      };

      const entities = {
        User: {
          '1': { id: '1', name: 'NewName' }
        }
      };

      const expectedSpec = {
        User: {
          '1': { $set: { id: '1', name: 'NewName' } }
        }
      };

      const updateSpec = handleUpdateEntities(state, entities, '$replace');
      expect(updateSpec).toEqual(expectedSpec);
    });

    it('should throw error for invalid strategy', () => {
      const state = {
        User: {
          '1': { id: '1', name: 'Test' }
        }
      };

      const entities = {
        User: {
          '1': { name: 'UpdatedName' }
        }
      };

      // @ts-ignore - Testing invalid strategy
      expect(() => handleUpdateEntities(state, entities, '$invalidStrategy')).toThrow(
        'Invalid strategy: $invalidStrategy'
      );
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

      const deleteSpec = handleDeleteEntities(entities, entities);
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

    it('should handle SET_STATE', () => {
      const action = setState({
        User: {
          '1': { id: '1', name: 'Entity1' },
          '2': { id: '2', name: 'Entity2' }
        }
      });
      const newState = reducer(state, action);
      expect(newState).toEqual({ User: { '1': { id: '1', name: 'Entity1' }, '2': { id: '2', name: 'Entity2' } } });
    });

    it('should return the initial state when an unknown action is passed', () => {
      const action = { type: 'UNKNOWN_ACTION' } as any;
      const newState = reducer(state, action);

      expect(newState).toEqual(state);
    });
  });
});
