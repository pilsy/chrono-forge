import { v4 } from 'uuid';
import { StateManager } from '../store/StateManager';
import {
  clearEntities,
  deleteNormalizedEntities,
  normalizeEntities,
  PARTIAL_UPDATE,
  updateNormalizedEntities,
  partialUpdateEntity
} from '../store';
import schemas from './testSchemas';
import { limitRecursion } from '../utils';
import { readFileSync, writeFileSync } from 'fs';

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
    beforeEach(async () => {
      stateManager.dispatch(clearEntities());
      await applyAllPendingChanges(stateManager);
      dispatchSpy = jest.spyOn(stateManager, 'dispatch');
    });

    it('should initialize with empty state', () => {
      expect(stateManager.state).toEqual({});
    });

    it('should update state correctly', async () => {
      const newState = { User: { '1': { id: '1', name: 'John' } } };
      await stateManager.setState(newState);
      expect(stateManager.state).toEqual(newState);
    });

    it.skip('should handle very large states', async () => {
      const website_1 = JSON.parse(readFileSync('./src/tests/testData/Website_1.json', 'utf8'));
      const website_1_state = JSON.parse(readFileSync('./src/tests/testData/Website_1_normalised.json', 'utf8'));

      // website_1.products = [];
      // for (const vendor of website_1.vendors) {
      //   vendor.website = '1';
      //   for (const product of vendor.products) {
      //     product.vendor = vendor.name;
      //     product.website = '1';
      //     website_1.products.push(product.id);
      //   }
      // }
      // writeFileSync('./src/tests/testData/Website_1.json', JSON.stringify(website_1, null, 2));
      // writeFileSync(
      //   './src/tests/testData/Website_1_normalised.json',
      //   JSON.stringify(normalizeEntities(website_1, 'Website'), null, 2)
      // );

      // const hugeState = JSON.parse(readFileSync('./src/tests/testData/hugeState.json', 'utf8'));
      // const hugeData = JSON.parse(readFileSync('./src/tests/testData/hugeData.json', 'utf8'));
      console.time('limitRecursion');
      const data = limitRecursion('1', 'Website', website_1_state);
      console.timeEnd('limitRecursion');

      const startTime = Date.now();
      await stateManager.setState(website_1_state);
      const endTime = Date.now();
      console.log(`Time taken to set state: ${endTime - startTime}ms`);

      expect(stateManager.state).toEqual(website_1_state);
      expect(limitRecursion('1', 'Website', stateManager.state)).toEqual(data);

      const website = stateManager.query('Website', '1');
      expect(website.toJSON()).toEqual(website_1);

      stateManager.dispatch(deleteNormalizedEntities({ Vendor: stateManager.state.Vendor }));
      await applyAllPendingChanges(stateManager);

      // website.vendors.length = website.vendors.length - 1;
      console.log(stateManager.queue);
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
              '100': { id: '100', list: [10, 20, 30] }
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
        [partialUpdateEntity('User', '1', { '1': { name: 'Jane' } }, '$merge')],
        false,
        `testInstance${instanceNum}`
      );
    });

    it('should dispatch update for array push operation', async () => {
      const nested = stateManager.query('Nested', '100');
      nested.list.push(40);

      // Apply changes to reflect update in state
      await applyAllPendingChanges(stateManager);
      await sleep();

      expect(dispatchSpy).toHaveBeenCalledTimes(1);
      expect(dispatchSpy).toHaveBeenCalledWith(
        [partialUpdateEntity('Nested', '100', { '100': { list: [10, 20, 30, 40] } }, '$set')],
        false,
        `testInstance${instanceNum}`
      );
    });

    it('should dispatch update for array push operation', async () => {
      const nested = stateManager.query('Nested', '100');
      nested.list.pop();

      // Apply changes to reflect update in state
      await applyAllPendingChanges(stateManager);
      await sleep();

      expect(dispatchSpy).toHaveBeenCalledWith(
        [partialUpdateEntity('Nested', '100', { '100': { list: [10, 20] } }, '$set')],
        false,
        `testInstance${instanceNum}`
      );
    });

    it('should dispatch update for array splice operation', async () => {
      const nested = stateManager.query('Nested', '100');
      nested.list.splice(1);

      // Apply changes to reflect update in state
      await applyAllPendingChanges(stateManager);
      await sleep();

      expect(dispatchSpy).toHaveBeenCalledWith(
        [partialUpdateEntity('Nested', '100', { '100': { list: [10] } }, '$set')],
        false,
        `testInstance${instanceNum}`
      );
    });

    it('should dispatch update for updating the value of an array element', async () => {
      const nested = stateManager.query('Nested', '100');
      nested.list[0] = 15;

      // Apply changes to reflect update in state
      await applyAllPendingChanges(stateManager);
      await sleep();

      expect(dispatchSpy).toHaveBeenCalledWith(
        [partialUpdateEntity('Nested', '100', { '100': { list: [15, 20, 30] } }, '$set')],
        false,
        `testInstance${instanceNum}`
      );
    });

    it('should dispatch update for decreasing array length', async () => {
      const nested = stateManager.query('Nested', '100');
      nested.list.length = 0;

      // Apply changes to reflect update in state
      await applyAllPendingChanges(stateManager);
      await sleep();

      expect(dispatchSpy).toHaveBeenCalledWith(
        [partialUpdateEntity('Nested', '100', { '100': { list: [] } }, '$set')],
        false,
        `testInstance${instanceNum}`
      );
    });

    it('should dispatch update for increasing array length', async () => {
      const nested = stateManager.query('Nested', '100');
      nested.list.length = 4;

      // Apply changes to reflect update in state
      await applyAllPendingChanges(stateManager);
      await sleep();

      expect(dispatchSpy).toHaveBeenCalledWith(
        [partialUpdateEntity('Nested', '100', { '100': { list: [10, 20, 30, null] } }, '$set')],
        false,
        `testInstance${instanceNum}`
      );
    });

    it('should dispatch update for updating reference to an entity', async () => {
      const user = stateManager.query('User', '1');
      user.nested = { id: '101', list: [30, 40] };

      expect(dispatchSpy).toHaveBeenCalledWith(
        [
          {
            type: 'entities.upsertEntities',
            entities: {
              Nested: {
                '101': {
                  id: '101',
                  list: [30, 40]
                }
              }
            },
            strategy: '$merge'
          },
          {
            type: 'entities.partialUpdate',
            entityName: 'User',
            entityId: '1',
            entities: {
              '1': {
                nested: '101'
              }
            },
            strategy: '$merge'
          },
          {
            type: 'entities.deleteEntity',
            entityId: '100',
            entityName: 'Nested'
          }
        ],
        false,
        `testInstance${instanceNum}`
      );
    });

    it('should dispatch update for removing reference to an entity', async () => {
      const user = stateManager.query('User', '1');
      user.nested = null;

      expect(dispatchSpy).toHaveBeenCalledWith(
        [
          {
            type: 'entities.partialUpdate',
            entityName: 'User',
            entityId: '1',
            entities: {
              '1': {
                nested: null
              }
            },
            strategy: '$set'
          },
          {
            type: 'entities.deleteEntity',
            entityId: '100',
            entityName: 'Nested'
          }
        ],
        false,
        `testInstance${instanceNum}`
      );

      await applyAllPendingChanges(stateManager);

      expect(stateManager.state.User['1'].nested).toBeNull();
    });
  });

  describe('Complex Scenarios', () => {
    beforeEach(async () => {
      dispatchSpy = jest.spyOn(stateManager, 'dispatch');
    });
    it('should handle deeply nested entity updates', async () => {
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
                likes: [{ id: likeId, name: 'like' }]
              }
            ]
          }
        ]
      };

      await stateManager.setState(normalizeEntities(data, 'User'));
      const user = stateManager.query('User', userId);

      // Modify deeply nested property
      user.listings[0].photos[0].likes[0].name = 'new-like-name';

      expect(user.listings[0].photos[0].likes[0].name).toBe('new-like-name');

      expect(dispatchSpy).toHaveBeenCalledWith(
        [
          {
            type: PARTIAL_UPDATE,
            entityName: 'Like',
            entityId: likeId,
            entities: { [likeId]: { name: 'new-like-name' } },
            strategy: '$merge'
          }
        ],
        false,
        `testInstance${instanceNum}`
      );

      await applyAllPendingChanges(stateManager);

      const updatedUser = stateManager.query('User', userId);

      expect(JSON.stringify(updatedUser)).toBe(JSON.stringify(user));
    });

    it('should handle circular references', async () => {
      const user1Id = v4();
      const user2Id = v4();

      const normalised = normalizeEntities(
        [
          { id: user1Id, name: 'User 1', friends: [user2Id] },
          { id: user2Id, name: 'User 2', friends: [user1Id] }
        ],
        'User'
      );
      await stateManager.setState(normalised);

      const user1 = stateManager.query('User', user1Id);
      const user2 = stateManager.query('User', user2Id);

      expect(user1.friends[0]).toEqual(normalised.User[user2Id]);
      expect(user2.friends[0]).toEqual(normalised.User[user1Id]);
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

    it.skip('should handle setting array elements in state and dispatch the proper actions', async () => {
      const user = stateManager.query('User', '1');
      user.nested.list.splice(1, 1, 10);

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
                likes: [like1]
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
      photo.likes.push(like2); // Only push the ID reference

      // Verify correct dispatch was called with just IDs in the array
      expect(dispatchSpy).toHaveBeenCalledWith(
        [
          {
            entities: {
              Like: {
                [like2.id]: like2
              }
            },
            strategy: '$merge',
            type: 'entities.upsertEntities'
          },
          {
            type: PARTIAL_UPDATE,
            entityName: 'Photo',
            entityId: photoId,
            entities: { [photoId]: { likes: [like1.id, like2.id] } },
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

    it('should update nested list item correctly using ID reference', async () => {
      const nested = stateManager.query('Nested', '100');
      nested.list[0] = 15; // Modify first element

      expect(dispatchSpy).toHaveBeenCalledWith(
        [
          {
            type: PARTIAL_UPDATE,
            entityName: 'Nested',
            entityId: '100',
            entities: { '100': { list: [15, 2, 3] } },
            strategy: '$set'
          }
        ],
        false,
        `testInstance${instanceNum}`
      );

      await applyAllPendingChanges(stateManager);

      expect(stateManager.state.Nested['100'].list).toEqual([15, 2, 3]); // Verify state update
    });

    it('should append to the nested list using ID reference', async () => {
      const nested = stateManager.query('Nested', '100');
      nested.list.push(25);

      expect(dispatchSpy).toHaveBeenCalledWith(
        [
          {
            type: PARTIAL_UPDATE,
            entityName: 'Nested',
            entityId: '100',
            entities: { '100': { list: [1, 2, 3, 25] } },
            strategy: '$set'
          }
        ],
        false,
        `testInstance${instanceNum}`
      );

      await applyAllPendingChanges(stateManager);

      expect(stateManager.state.Nested['100'].list).toEqual([1, 2, 3, 25]); // Verify state update
    });

    it('should replace nested object reference with a new ID', async () => {
      const user = stateManager.query('User', '1');
      user.nested = { id: '101', list: [30, 40] };

      expect(dispatchSpy).toHaveBeenCalledWith(
        [
          {
            type: 'entities.upsertEntities',
            entities: {
              Nested: {
                '101': {
                  id: '101',
                  list: [30, 40]
                }
              }
            },
            strategy: '$merge'
          },
          {
            type: 'entities.partialUpdate',
            entityName: 'User',
            entityId: '1',
            entities: {
              '1': {
                nested: '101'
              }
            },
            strategy: '$merge'
          },
          {
            type: 'entities.deleteEntity',
            entityId: '100',
            entityName: 'Nested'
          }
        ],
        false,
        `testInstance${instanceNum}`
      );

      await applyAllPendingChanges(stateManager);

      expect(stateManager.state.User['1'].nested).toBe('101'); // Ensure the reference updates
      expect(stateManager.state.Nested['101'].list).toEqual([30, 40]); // Check new nested object's presence

      const user2 = stateManager.query('User', '1');
      expect(user2).not.toBe(user);
      expect(JSON.stringify(user2)).toBe(JSON.stringify(user));
    });
  });
});
