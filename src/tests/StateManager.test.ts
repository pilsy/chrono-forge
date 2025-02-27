import { v4 } from 'uuid';
import { StateManager } from '../store/StateManager';
import {
  clearEntities,
  normalizeEntities,
  PARTIAL_UPDATE,
  updateNormalizedEntities,
  updatePartialEntity
} from '../store/entities';
import schemas from './testSchemas';

const sleep = async (duration = 1000) =>
  new Promise((resolve) => {
    setTimeout(async () => {
      resolve(true);
    }, duration);
  });

const { User, Nested } = schemas;
describe('StateManager', () => {
  let stateManager: StateManager;
  let dispatchSpy: jest.SpyInstance;
  let instanceNum = 0;

  beforeEach(() => {
    stateManager = StateManager.getInstance(`testInstance${++instanceNum}`);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  async function applyAllPendingChanges(stateManager: StateManager) {
    await stateManager.processChanges();
  }

  describe('Instance Management', () => {
    it('should create and retrieve the same instance', () => {
      const instance1 = StateManager.getInstance('test1');
      const instance2 = StateManager.getInstance('test1');
      expect(instance1).toBe(instance2);
    });

    it('should create different instances for different IDs', () => {
      const instance1 = StateManager.getInstance('test1');
      const instance2 = StateManager.getInstance('test2');
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('State Management', () => {
    it('should initialize with empty state', () => {
      expect(stateManager.state).toEqual({});
    });

    it('should update state correctly', async () => {
      const newState = { User: { '1': { id: '1', name: 'John' } } };
      await stateManager.setState(newState);
      expect(stateManager.state).toEqual(newState);
    });
  });

  describe('Querying Entities', () => {
    beforeEach(async () => {
      await stateManager.setState({
        User: {
          '1': { id: '1', name: 'John', nested: '100' }
        },
        Nested: {
          '100': { id: '100', list: [10, 20] }
        }
      });
    });

    it('should return null for non-existent entities', () => {
      expect(stateManager.query('User', '999')).toBeNull();
    });

    it('should return raw entity when denormalizeData is false', () => {
      const user = stateManager.query('User', '1', false);
      expect(user).toEqual({ id: '1', name: 'John', nested: '100' });
    });

    it('should return proxied entity when denormalizeData is true', () => {
      const user = stateManager.query('User', '1');
      expect(user).toBeDefined();
      expect(user.name).toBe('John');
    });
  });

  describe('Entity Updates', () => {
    beforeEach(async () => {
      stateManager.dispatch(clearEntities());
      await applyAllPendingChanges(stateManager);
      stateManager.dispatch(
        updateNormalizedEntities(
          {
            User: {
              '1': { id: '1', name: 'John', nested: '100' }
            },
            Nested: {
              '100': { id: '100', list: [10, 20] }
            }
          },
          '$merge'
        )
      );
      await applyAllPendingChanges(stateManager);
      dispatchSpy = jest.spyOn(stateManager, 'dispatch');
    });

    it('should dispatch update for primitive value change', async () => {
      const user = stateManager.query('User', '1');
      user.name = 'Jane';

      expect(dispatchSpy).toHaveBeenCalledWith(
        [updatePartialEntity('User', '1', { '1': { name: 'Jane' } }, '$merge')],
        false,
        `testInstance${instanceNum}`
      );
    });

    it.skip('should dispatch update for array push operation', async () => {
      const nested = stateManager.query('Nested', '100');
      nested.list.push(30);
      nested.foobar = 'baz';

      // Apply changes to reflect update in state
      await applyAllPendingChanges(stateManager);
      await sleep(2500);

      expect(dispatchSpy).toHaveBeenCalledWith(
        [updatePartialEntity('Nested', '100', { '100': { list: [10, 20, 30] } }, '$set')],
        false,
        `testInstance${instanceNum}`
      );
    });

    it.skip('should dispatch update for array splice operation', async () => {
      const nested = stateManager.query('Nested', '100');
      nested.list.splice(0, 1, 15);

      expect(dispatchSpy).toHaveBeenCalledWith(
        [updatePartialEntity('Nested', '100', { '100': { list: [15, 20] } }, '$set')],
        false,
        `testInstance${instanceNum}`
      );
    });

    it.skip('should dispatch update for reference ID change', async () => {
      const user = stateManager.query('User', '1');
      user.nested = '101';

      expect(dispatchSpy).toHaveBeenCalledWith(
        [updatePartialEntity('User', '1', { '1': { nested: '101' } }, '$merge')],
        false,
        `testInstance${instanceNum}`
      );
    });
  });

  describe('Complex Scenarios', () => {
    it.skip('should handle deeply nested entity updates', async () => {
      const userId = v4();
      const listingId = v4();
      const photoId = v4();
      const likeId = v4();

      const data = {
        id: userId,
        listings: [
          {
            id: listingId,
            photos: [
              {
                id: photoId,
                likes: [{ id: likeId }]
              }
            ]
          }
        ]
      };

      await stateManager.setState(normalizeEntities(data, 'User'));
      const user = stateManager.query('User', userId);

      // Modify deeply nested property
      user.listings[0].photos[0].likes[0].id = 'new-like-id';

      expect(stateManager.state.User[userId].listings[0].photos[0].likes[0]).toBe('new-like-id');
    });

    it.skip('should handle circular references', async () => {
      const user1Id = v4();
      const user2Id = v4();

      await stateManager.setState({
        User: {
          [user1Id]: { id: user1Id, friend: user2Id },
          [user2Id]: { id: user2Id, friend: user1Id }
        }
      });

      const user1 = stateManager.query('User', user1Id);
      const user2 = stateManager.query('User', user2Id);

      expect(user1.friend).toBe(user2);
      expect(user2.friend).toBe(user1);
    });
  });

  describe('Proxy Operations', () => {
    beforeEach(async () => {
      await stateManager.setState({
        User: {
          '1': { id: '1', name: 'John', nested: '100', attributes: { score: 10 } }
        },
        Nested: {
          '100': { id: '100', list: [1, 2, 3] }
        }
      });
      dispatchSpy = jest.spyOn(stateManager, 'dispatch');
    });

    it('should update the state correctly alongside dispatching the proper actions for top-level changes', async () => {
      const user = stateManager.query('User', '1');
      user.name = 'Jane Doe';

      expect(dispatchSpy).toHaveBeenCalledWith(
        [
          {
            type: PARTIAL_UPDATE,
            entityName: 'User',
            entityId: '1',
            entities: { '1': { name: 'Jane Doe' } },
            strategy: '$merge'
          }
        ],
        false,
        `testInstance${instanceNum}`
      );

      // Apply changes to reflect update in state
      await applyAllPendingChanges(stateManager);

      // Ensure state was updated correctly
      expect(stateManager.state.User['1'].name).toBe('Jane Doe');
    });

    it('should update the state and dispatch the proper actions for nested changes', async () => {
      const user = stateManager.query('User', '1');
      user.attributes.score = 20;

      // Check that the dispatch was called with the correct parameters
      expect(dispatchSpy).toHaveBeenCalledWith(
        [
          {
            type: PARTIAL_UPDATE,
            entityName: 'User',
            entityId: '1',
            entities: { '1': { attributes: { score: 20 } } },
            strategy: '$merge'
          }
        ],
        false,
        `testInstance${instanceNum}`
      );

      await applyAllPendingChanges(stateManager); // Reflect changes in state

      expect(stateManager.state.User['1'].attributes.score).toBe(20); // Ensure state reflects update
    });

    it('should handle setting array elements in state and dispatch the proper actions', async () => {
      const user = stateManager.query('User', '1');
      user.nested.list[1] = 10;

      expect(dispatchSpy).toHaveBeenCalledWith(
        [
          {
            type: PARTIAL_UPDATE,
            entityName: 'Nested',
            entityId: '100',
            entities: { '100': { list: [1, 10, 3] } },
            strategy: '$set'
          }
        ],
        false,
        `testInstance${instanceNum}`
      );

      user.nested.list.push(25); // Append new element
      expect(dispatchSpy).toHaveBeenNthCalledWith(
        2,
        [
          {
            type: PARTIAL_UPDATE,
            entityName: 'Nested',
            entityId: '100',
            entities: { '100': { list: [1, 10, 3, 25] } },
            strategy: '$set'
          }
        ],
        false,
        `testInstance${instanceNum}`
      );

      await applyAllPendingChanges(stateManager);

      expect(stateManager.state.Nested['100'].list).toEqual([1, 10, 3, 25]);
    });

    it('Should handle deeply nested array modifications correctly', async () => {
      const userId = v4();
      const listingId = v4();
      const listing2Id = v4();
      const photoId = v4();
      const like1 = { id: v4(), user: userId, photo: photoId };
      const like2 = { id: v4(), user: userId, photo: photoId };

      // Initial data for User with Listings, Photos, and Likes, forming a recursive structure
      const data = {
        id: userId,
        listings: [
          {
            id: listingId,
            user: userId,
            photos: [
              {
                id: photoId,
                user: userId,
                listing: listingId,
                likes: [like1, like2]
              }
            ]
          },
          {
            id: listing2Id,
            user: userId
          }
        ]
      };

      // Log the normalized data structure
      const normalizedData = normalizeEntities(data, 'User');
      await stateManager.setState(normalizedData);

      // Get the photo entity
      const photo = stateManager.query('Photo', photoId, true);

      // Clear the spy to ensure we only capture the next dispatch
      dispatchSpy.mockClear();

      // Now push to the likes array directly on the photo entity
      photo.likes.push({ id: like2.id }); // Only push the ID reference

      // Verify correct dispatch was called with just IDs in the array
      expect(dispatchSpy).toHaveBeenCalledWith(
        [
          {
            type: PARTIAL_UPDATE,
            entityName: 'Photo',
            entityId: photoId,
            entities: { [photoId]: { likes: [like1.id, like2.id, like2.id] } },
            strategy: '$set'
          }
        ],
        false,
        `testInstance${instanceNum}`
      );

      await applyAllPendingChanges(stateManager);
    });
  });

  describe('StateManager with ID-Based Nested References', () => {
    it.skip('should update nested list item correctly using ID reference', async () => {
      const nested = stateManager.query('Nested', '100');
      nested.list[0] = 15; // Modify first element

      expect(dispatchSpy).toHaveBeenCalledWith(
        {
          type: PARTIAL_UPDATE,
          entityName: 'Nested',
          entityId: '100',
          updates: { '100': { list: { $splice: [[0, 1, 15]] } } } // Correctly uses $splice
        },
        false,
        `testInstance${instanceNum}`
      );

      await applyAllPendingChanges(stateManager);

      expect(stateManager.state.Nested['100'].list).toEqual([15, 20]); // Verify state update
    });

    it.skip('should append to the nested list using ID reference', async () => {
      console.dir(stateManager.state, { depth: 12 });
      const nested = stateManager.query('Nested', '100');
      console.dir(nested, { depth: 12 });
      nested.list.push(25); // Append element

      expect(dispatchSpy).toHaveBeenCalledWith(
        {
          type: PARTIAL_UPDATE,
          entityName: 'Nested',
          entityId: '100',
          updates: { '100': { list: { $push: [25] } } } // Correctly uses $push
        },
        false,
        `testInstance${instanceNum}`
      );

      await applyAllPendingChanges(stateManager);

      expect(stateManager.state.Nested['100'].list).toEqual([10, 20, 25]); // Verify state update
    });

    it.skip('should replace nested object reference with a new ID', async () => {
      await stateManager.setState({
        User: {
          '1': { id: '1', nested: '100' } // Initially pointing to 100
        },
        Nested: {
          '100': { id: '100', list: [10, 20] },
          '101': { id: '101', list: [30, 40] } // New nested object
        }
      });

      const user = stateManager.query('User', '1');
      user.nested = '101'; // Replace the reference ID

      expect(dispatchSpy).toHaveBeenCalledWith(
        {
          type: PARTIAL_UPDATE,
          entityName: 'User',
          entityId: '1',
          updates: { '1': { nested: { $set: '101' } } } // Update the nested reference ID
        },
        false,
        `testInstance${instanceNum}`
      );

      await applyAllPendingChanges(stateManager);

      expect(stateManager.state.User['1'].nested).toBe('101'); // Ensure the reference updates
      expect(stateManager.state.Nested['101'].list).toEqual([30, 40]); // Check new nested object's presence
    });
  });
});
