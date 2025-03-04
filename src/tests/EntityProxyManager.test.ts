import { EntityProxyManager } from '../store/EntityProxyManager';
import { StateManager } from '../store/StateManager';
import { v4 as uuidv4 } from 'uuid';
import { DELETE_ENTITIES, UPDATE_ENTITIES, UPDATE_ENTITIES_PARTIAL } from '../store';
import { limitRecursion } from '../utils';
import schemas from './testSchemas';

// Helper function to wait for async operations
const sleep = async (duration = 100) =>
  new Promise((resolve) => {
    setTimeout(() => {
      resolve(true);
    }, duration);
  });

describe('EntityProxyManager', () => {
  let stateManager: StateManager;
  let dispatchSpy: jest.SpyInstance;

  beforeEach(() => {
    expect(schemas).toBeDefined();

    // Initialize the proxy state tree
    EntityProxyManager.initialize();

    // Clear caches
    EntityProxyManager.clearCache();

    // Create a state manager instance
    stateManager = StateManager.getInstance('test-instance');

    // Spy on dispatch method
    dispatchSpy = jest.spyOn(stateManager, 'dispatch');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Basic Functionality', () => {
    it('should create a proxy for an entity', () => {
      const userData = { id: '123', name: 'John' };
      const user = EntityProxyManager.createEntityProxy('User', '123', userData, stateManager);

      expect(user).toBeDefined();
      expect(user.id).toBe('123');
      expect(user.name).toBe('John');
    });

    it('should handle mutations to primitive properties', () => {
      const userData = { id: '123', name: 'John', age: 30 };
      const user = EntityProxyManager.createEntityProxy('User', '123', userData, stateManager);

      user.name = 'Johnny';
      user.age = 31;

      expect(stateManager.dispatch).toHaveBeenCalledWith(
        [
          {
            entities: { User: { '123': { id: '123', name: 'Johnny' } } },
            strategy: '$merge',
            type: UPDATE_ENTITIES_PARTIAL
          }
        ],
        false,
        'test-instance'
      );

      expect(stateManager.dispatch).toHaveBeenNthCalledWith(
        2,
        [
          {
            entities: { User: { '123': { id: '123', age: 31 } } },
            strategy: '$merge',
            type: UPDATE_ENTITIES_PARTIAL
          }
        ],
        false,
        'test-instance'
      );
    });

    it('should handle setting properties to null', () => {
      const userData = { id: '123', name: 'John', bio: 'Developer' };
      const user = EntityProxyManager.createEntityProxy('User', '123', userData, stateManager);

      user.bio = null;

      expect(stateManager.dispatch).toHaveBeenCalledWith(
        [
          {
            entities: { User: { '123': { id: '123', bio: null } } },
            strategy: '$merge',
            type: UPDATE_ENTITIES_PARTIAL
          }
        ],
        false,
        'test-instance'
      );
    });
  });

  describe('Array Operations', () => {
    it('should handle push operation on arrays', () => {
      const userData = { id: '123', name: 'John', tags: ['developer', 'javascript'] };
      const user = EntityProxyManager.createEntityProxy('User', '123', userData, stateManager);

      user.tags.push('typescript');

      expect(stateManager.dispatch).toHaveBeenCalledWith(
        [
          {
            entities: { User: { '123': { id: '123', tags: ['developer', 'javascript', 'typescript'] } } },
            strategy: '$set',
            type: UPDATE_ENTITIES_PARTIAL
          }
        ],
        false,
        'test-instance'
      );
    });

    it('should handle pop operation on arrays', () => {
      const userData = { id: '123', name: 'John', tags: ['developer', 'javascript', 'typescript'] };
      const user = EntityProxyManager.createEntityProxy('User', '123', userData, stateManager);

      user.tags.pop();

      expect(stateManager.dispatch).toHaveBeenCalledWith(
        [
          {
            entities: { User: { '123': { id: '123', tags: ['developer', 'javascript'] } } },
            strategy: '$set',
            type: UPDATE_ENTITIES_PARTIAL
          }
        ],
        false,
        'test-instance'
      );
    });

    it('should handle splice operation on arrays', () => {
      const userData = { id: '123', name: 'John', tags: ['developer', 'javascript', 'typescript'] };
      const user = EntityProxyManager.createEntityProxy('User', '123', userData, stateManager);

      user.tags.splice(1, 1, 'node');

      expect(stateManager.dispatch).toHaveBeenCalledWith(
        [
          {
            entities: { User: { '123': { id: '123', tags: ['developer', 'node', 'typescript'] } } },
            strategy: '$set',
            type: UPDATE_ENTITIES_PARTIAL
          }
        ],
        false,
        'test-instance'
      );
    });

    it('should handle element assignment in arrays', () => {
      const userData = { id: '123', name: 'John', tags: ['developer', 'javascript', 'typescript'] };
      const user = EntityProxyManager.createEntityProxy('User', '123', userData, stateManager);

      user.tags[1] = 'node';

      expect(stateManager.dispatch).toHaveBeenCalledWith(
        [
          {
            entities: { User: { '123': { id: '123', tags: ['developer', 'node', 'typescript'] } } },
            strategy: '$set',
            type: UPDATE_ENTITIES_PARTIAL
          }
        ],
        false,
        'test-instance'
      );
    });

    it('should handle length modification on arrays', () => {
      const userData = { id: '123', name: 'John', tags: ['developer', 'javascript', 'typescript'] };
      const user = EntityProxyManager.createEntityProxy('User', '123', userData, stateManager);

      user.tags.length = 2;

      expect(stateManager.dispatch).toHaveBeenCalledWith(
        [
          {
            entities: { User: { '123': { id: '123', tags: ['developer', 'javascript'] } } },
            strategy: '$set',
            type: UPDATE_ENTITIES_PARTIAL
          }
        ],
        false,
        'test-instance'
      );
    });
  });

  describe('Nested Objects', () => {
    it('should handle updates to nested objects', () => {
      const userData = {
        id: '123',
        name: 'John',
        metadata: {
          joinDate: '2023-01-01',
          lastLogin: '2023-06-15'
        }
      };
      const user = EntityProxyManager.createEntityProxy('User', '123', userData, stateManager);

      user.metadata.lastLogin = '2023-06-16';

      expect(stateManager.dispatch).toHaveBeenCalledWith(
        [
          {
            entities: { User: { '123': { id: '123', metadata: { joinDate: '2023-01-01', lastLogin: '2023-06-16' } } } },
            strategy: '$merge',
            type: UPDATE_ENTITIES_PARTIAL
          }
        ],
        false,
        'test-instance'
      );
    });

    it('should handle deeply nested object updates', () => {
      const userData = {
        id: '123',
        name: 'John',
        settings: {
          preferences: {
            theme: 'light',
            notifications: {
              email: true,
              push: false
            }
          }
        }
      };
      const user = EntityProxyManager.createEntityProxy('User', '123', userData, stateManager);

      user.settings.preferences.notifications.push = true;

      expect(stateManager.dispatch).toHaveBeenCalledWith(
        [
          {
            entities: {
              User: {
                '123': {
                  id: '123',
                  settings: { preferences: { notifications: { email: true, push: true }, theme: 'light' } }
                }
              }
            },
            strategy: '$merge',
            type: UPDATE_ENTITIES_PARTIAL
          }
        ],
        false,
        'test-instance'
      );
    });
  });

  describe('Relationship Handling', () => {
    it('should handle setting a single entity relationship', () => {
      // Setup state
      stateManager.state = {
        User: {
          '123': { id: '123', name: 'John' }
        }
      };

      // Create a proxy for the user
      const userData = { id: '123', name: 'John' };
      const user = EntityProxyManager.createEntityProxy('User', '123', userData, stateManager);

      // Create a new profile and set it as the user's profile
      const profileData = { id: '456', bio: 'Developer', user: '123' };
      user.profile = profileData;

      // Verify dispatch was called with the correct action
      expect(stateManager.dispatch).toHaveBeenCalledWith(
        [
          {
            entities: { Profile: { '456': { id: '456', bio: 'Developer', user: '123' } } },
            strategy: '$merge',
            type: UPDATE_ENTITIES
          },
          {
            entities: { User: { '123': { id: '123', profile: '456' } } },
            strategy: '$merge',
            type: UPDATE_ENTITIES_PARTIAL
          }
        ],
        false,
        'test-instance'
      );
    });

    it('should handle setting a relationship to null', () => {
      // Setup state
      stateManager.state = {
        User: {
          '123': { id: '123', name: 'John', profile: '456' }
        },
        Profile: {
          '456': { id: '456', bio: 'Developer', user: '123' }
        }
      };

      // Create a proxy for the user
      const userData = { id: '123', name: 'John', profile: '456' };
      const user = EntityProxyManager.createEntityProxy('User', '123', userData, stateManager);

      // Set the profile to null
      user.profile = null;

      // Verify dispatch was called with the correct action
      expect(stateManager.dispatch).toHaveBeenCalledWith(
        [
          {
            entities: { User: { '123': { id: '123', profile: null } } },
            strategy: '$set',
            type: UPDATE_ENTITIES_PARTIAL
          },
          { entities: { Profile: { '456': { id: '456' } } }, type: DELETE_ENTITIES }
        ],
        false,
        'test-instance'
      );
    });

    it('should handle many-to-many relationships', () => {
      // Setup state
      stateManager.state = {
        User: {
          '123': { id: '123', name: 'John', friends: [] }
        }
      };

      // Create a proxy for the user
      const userData = { id: '123', name: 'John', friends: [] };
      const user = EntityProxyManager.createEntityProxy('User', '123', userData, stateManager);

      // Add a friend
      const friendData = { id: '456', name: 'Jane' };
      user.friends.push(friendData);

      // Verify dispatch was called with the correct actions
      expect(stateManager.dispatch).toHaveBeenCalledWith(
        [
          {
            entities: { User: { '456': { id: '456', name: 'Jane' } } },
            strategy: '$merge',
            type: UPDATE_ENTITIES
          },
          {
            entities: { User: { '123': { id: '123', friends: ['456'] } } },
            strategy: '$set',
            type: UPDATE_ENTITIES_PARTIAL
          }
        ],
        false,
        'test-instance'
      );
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle circular references', () => {
      // Setup state with circular references
      stateManager.state = {
        User: {
          '123': { id: '123', name: 'John', friends: ['456'] },
          '456': { id: '456', name: 'Jane', friends: ['123'] }
        }
      };

      // Create proxies
      const johnData = { id: '123', name: 'John', friends: ['456'] };
      const john = EntityProxyManager.createEntityProxy('User', '123', johnData, stateManager);

      // Update a property
      john.name = 'Johnny';

      // Verify dispatch was called with the correct action
      expect(stateManager.dispatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            entities: { User: { '123': { id: '123', name: 'Johnny' } } }
          })
        ]),
        false,
        'test-instance'
      );
    });

    it('should handle deeply nested entity relationships', () => {
      // Setup complex state
      const userId = uuidv4();
      const postId = uuidv4();
      const commentId = uuidv4();

      stateManager.state = {
        User: {
          [userId]: { id: userId, name: 'John', posts: [postId], comments: [commentId] }
        },
        Post: {
          [postId]: { id: postId, title: 'Test Post', author: userId, comments: [commentId] }
        },
        Comment: {
          [commentId]: { id: commentId, text: 'Great post!', post: postId, author: userId }
        }
      };

      // Create a proxy for the user
      const user = EntityProxyManager.createEntityProxy(
        'User',
        userId,
        limitRecursion(userId, 'User', stateManager.state, stateManager),
        stateManager
      );

      // Create a new comment to add
      const newCommentId = uuidv4();

      // Add the comment to the post's comments array
      user.posts[0].comments.push({ id: newCommentId, text: 'Another comment', post: postId, author: userId });

      // Verify dispatch was called with actions that handle the deep relationship
      expect(stateManager.dispatch).toHaveBeenCalled();

      // The exact assertions would depend on how your implementation handles this complex case
      // This is a simplified check
      const calls = (stateManager.dispatch as jest.Mock).mock.calls;
      const flattenedActions = calls.reduce((acc: any[], call: any[]) => [...acc, ...call[0]], []);

      // Check for actions related to the new comment
      const hasNewCommentAction = flattenedActions.some(
        (action: any) => action.type === UPDATE_ENTITIES_PARTIAL && action.entities?.Comment?.[newCommentId]
      );

      expect(hasNewCommentAction).toBe(true);
    });
  });

  describe('Nested Array Operations', () => {
    it('should handle push operation on arrays within nested objects', () => {
      const userData = {
        id: '123',
        name: 'John',
        preferences: {
          categories: ['sports', 'tech']
        }
      };
      const user = EntityProxyManager.createEntityProxy('User', '123', userData, stateManager);

      user.preferences.categories.push('music');

      expect(stateManager.dispatch).toHaveBeenCalledWith(
        [
          {
            entities: { User: { '123': { id: '123', preferences: { categories: ['sports', 'tech', 'music'] } } } },
            strategy: '$merge',
            type: UPDATE_ENTITIES_PARTIAL
          }
        ],
        false,
        'test-instance'
      );
    });

    it('should handle pop operation on arrays within nested objects', () => {
      const userData = {
        id: '123',
        name: 'John',
        preferences: {
          categories: ['sports', 'tech', 'music']
        }
      };
      const user = EntityProxyManager.createEntityProxy('User', '123', userData, stateManager);

      user.preferences.categories.pop();

      expect(stateManager.dispatch).toHaveBeenCalledWith(
        [
          {
            entities: { User: { '123': { id: '123', preferences: { categories: ['sports', 'tech'] } } } },
            strategy: '$merge',
            type: UPDATE_ENTITIES_PARTIAL
          }
        ],
        false,
        'test-instance'
      );
    });

    it('should handle splice operation on arrays within nested objects', () => {
      const userData = {
        id: '123',
        name: 'John',
        preferences: {
          categories: ['sports', 'tech', 'music']
        }
      };
      const user = EntityProxyManager.createEntityProxy('User', '123', userData, stateManager);

      user.preferences.categories.splice(1, 1, 'gaming');

      expect(stateManager.dispatch).toHaveBeenCalledWith(
        [
          {
            entities: { User: { '123': { id: '123', preferences: { categories: ['sports', 'gaming', 'music'] } } } },
            strategy: '$merge',
            type: UPDATE_ENTITIES_PARTIAL
          }
        ],
        false,
        'test-instance'
      );
    });

    it('should handle element assignment in arrays within nested objects', () => {
      const userData = {
        id: '123',
        name: 'John',
        preferences: {
          categories: ['sports', 'tech', 'music']
        }
      };
      const user = EntityProxyManager.createEntityProxy('User', '123', userData, stateManager);

      user.preferences.categories[1] = 'gaming';

      expect(stateManager.dispatch).toHaveBeenCalledWith(
        [
          {
            entities: { User: { '123': { id: '123', preferences: { categories: ['sports', 'gaming', 'music'] } } } },
            strategy: '$merge',
            type: UPDATE_ENTITIES_PARTIAL
          }
        ],
        false,
        'test-instance'
      );
    });

    it('should handle length modification on arrays within nested objects', () => {
      const userData = {
        id: '123',
        name: 'John',
        preferences: {
          categories: ['sports', 'tech', 'music']
        }
      };
      const user = EntityProxyManager.createEntityProxy('User', '123', userData, stateManager);

      user.preferences.categories.length = 2;

      expect(stateManager.dispatch).toHaveBeenCalledWith(
        [
          {
            entities: { User: { '123': { id: '123', preferences: { categories: ['sports', 'tech'] } } } },
            strategy: '$merge',
            type: UPDATE_ENTITIES_PARTIAL
          }
        ],
        false,
        'test-instance'
      );
    });

    it('should handle deeply nested array operations', () => {
      const userData = {
        id: '123',
        name: 'John',
        settings: {
          profile: {
            interests: ['coding', 'reading']
          }
        }
      };
      const user = EntityProxyManager.createEntityProxy('User', '123', userData, stateManager);

      user.settings.profile.interests.push('hiking');

      expect(stateManager.dispatch).toHaveBeenCalledWith(
        [
          {
            entities: {
              User: { '123': { id: '123', settings: { profile: { interests: ['coding', 'reading', 'hiking'] } } } }
            },
            strategy: '$merge',
            type: UPDATE_ENTITIES_PARTIAL
          }
        ],
        false,
        'test-instance'
      );
    });

    it('should handle array operations within nested relationship objects', () => {
      const profileId = '456';
      const userData = {
        id: '123',
        name: 'John',
        profile: {
          id: profileId,
          tags: ['personal', 'professional']
        }
      };

      // Setup state manager with existing profile entity
      stateManager.state = {
        User: { '123': userData },
        Profile: { [profileId]: { id: profileId, tags: ['personal', 'professional'] } }
      };

      const user = EntityProxyManager.createEntityProxy('User', '123', userData, stateManager);

      // Modify the array in the nested relationship object
      user.profile.tags.push('academic');

      // Should update the Profile entity directly
      expect(stateManager.dispatch).toHaveBeenCalledWith(
        [
          {
            entities: { Profile: { '456': { id: '456', tags: ['personal', 'professional', 'academic'] } } },
            strategy: '$set',
            type: UPDATE_ENTITIES_PARTIAL
          }
        ],
        false,
        'test-instance'
      );
    });

    it('should handle array operations on objects within relationship arrays', () => {
      const postId = '789';
      const userData = {
        id: '123',
        name: 'John',
        posts: [
          {
            id: postId,
            tags: ['draft', 'private']
          }
        ]
      };

      // Setup state manager with existing post entity
      stateManager.state = {
        User: { '123': userData },
        Post: { [postId]: { id: postId, tags: ['draft', 'private'] } }
      };

      const user = EntityProxyManager.createEntityProxy('User', '123', userData, stateManager);

      // Modify the array in an object within a relationship array
      user.posts[0].tags.push('featured');

      // Should update the Post entity directly
      expect(stateManager.dispatch).toHaveBeenCalledWith(
        [
          {
            entities: { Post: { '789': { id: '789', tags: ['draft', 'private', 'featured'] } } },
            strategy: '$set',
            type: UPDATE_ENTITIES_PARTIAL
          }
        ],
        false,
        'test-instance'
      );
    });
  });
});
