/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/no-var-requires */

import { normalize } from 'normalizr';
import reducer, {
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
  updateEntity,
  handleUpdateEntities,
  handleDeleteEntities
} from '../../utils/entities';

import type { EntitiesState } from '../../utils/entities';
import schemas from '../testSchemas';

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
            '2': { id: '2', name: 'OldEntity2' } // This is an existing entity
          }
        };

        const normalizedEntities = {
          User: {
            '2': { id: '2', name: 'UpdatedEntity2' } // This should trigger a $merge"3": { id: "3", name: "Entity3" },         // This should trigger a $set
          }
        };

        const expectedStatement = {
          User: {
            '2': { $merge: { name: 'UpdatedEntity2', id: '2' } } // Existing entity, so $merge is expected"3": { $set: { name: "Entity3", id: "3" } },           // New entity, so $set is expected
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
        2: { id: 2, name: 'OldEntity2' } // Pre-existing entity
      }
    };

    it('should create a spec to update entities with $merge strategy', () => {
      const entities = {
        User: {
          2: { name: 'UpdatedEntity2' }, // Should trigger $merge
          3: { id: 3, name: 'Entity3' } // Should trigger $set
        }
      };

      const expectedSpec = {
        User: {
          2: { $merge: { name: 'UpdatedEntity2' } },
          3: { $set: { id: 3, name: 'Entity3' } } // This line is expected in the result
        }
      };

      const updateSpec = handleUpdateEntities(state, entities);
      expect(updateSpec).toEqual(expectedSpec);
    });

    it('should create a spec to update entities with $set strategy', () => {
      const entities = {
        User: {
          2: { name: 'UpdatedEntity2' },
          3: { id: 3, name: 'Entity3' }
        }
      };

      const expectedSpec = {
        User: {
          $set: {
            2: { name: 'UpdatedEntity2' },
            3: { id: 3, name: 'Entity3' }
          }
        }
      };

      const updateSpec = handleUpdateEntities({}, entities, '$set');
      expect(updateSpec).toEqual(expectedSpec);
    });
  });

  describe('handleDeleteEntities', () => {
    it('should create a spec to delete entities', () => {
      const entities = { entities: ['1', '2'] };
      const expectedSpec = {
        entities: { $unset: ['1', '2'] }
      };
      expect(handleDeleteEntities({}, entities)).toEqual(expectedSpec);
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
      const User = { User: ['1', '2'] };
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
