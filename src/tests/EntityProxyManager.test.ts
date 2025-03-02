import { EntityProxyManager } from '../store/EntityProxyManager';
import { StateManager } from '../store/StateManager';
import { v4 as uuidv4 } from 'uuid';
import { SchemaManager, RelationshipMap } from '../store/SchemaManager';
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
    stateManager = {
      instanceId: 'test-instance',
      dispatch: jest.fn(),
      state: {},
      isEntityReferenced: jest.fn().mockReturnValue(false)
    } as unknown as StateManager;

    // Spy on dispatch method
    dispatchSpy = jest.spyOn(stateManager, 'dispatch');

    // Mock SchemaManager with proper types
    const mockRelationshipMap = {
      User: {
        profile: { relatedEntityName: 'Profile', isMany: false },
        posts: { relatedEntityName: 'Post', isMany: true },
        friends: { relatedEntityName: 'User', isMany: true },
        _referencedBy: {}
      },
      Profile: {
        user: { relatedEntityName: 'User', isMany: false },
        _referencedBy: {}
      },
      Post: {
        author: { relatedEntityName: 'User', isMany: false },
        comments: { relatedEntityName: 'Comment', isMany: true },
        _referencedBy: {}
      },
      Comment: {
        post: { relatedEntityName: 'Post', isMany: false },
        author: { relatedEntityName: 'User', isMany: false },
        _referencedBy: {}
      }
    } as unknown as RelationshipMap;

    jest.spyOn(SchemaManager, 'relationshipMap', 'get').mockReturnValue(mockRelationshipMap);

    jest.spyOn(SchemaManager, 'schemas', 'get').mockReturnValue({
      User: { idAttribute: 'id' },
      Profile: { idAttribute: 'id' },
      Post: { idAttribute: 'id' },
      Comment: { idAttribute: 'id' }
    } as any);
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
            entities: { '123': { name: 'Johnny' } },
            entityId: '123',
            entityName: 'User',
            strategy: '$merge',
            type: 'entities.partialUpdate'
          }
        ],
        false,
        'test-instance'
      );

      expect(stateManager.dispatch).toHaveBeenNthCalledWith(
        2,
        [
          {
            entities: { '123': { age: 31 } },
            entityId: '123',
            entityName: 'User',
            strategy: '$merge',
            type: 'entities.partialUpdate'
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
            entities: { '123': { bio: null } },
            entityId: '123',
            entityName: 'User',
            strategy: '$merge',
            type: 'entities.partialUpdate'
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
            entities: { '123': { tags: ['developer', 'javascript', 'typescript'] } },
            entityId: '123',
            entityName: 'User',
            strategy: '$set',
            type: 'entities.partialUpdate'
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
            entities: { '123': { tags: ['developer', 'javascript'] } },
            entityId: '123',
            entityName: 'User',
            strategy: '$set',
            type: 'entities.partialUpdate'
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
            entities: { '123': { tags: ['developer', 'node', 'typescript'] } },
            entityId: '123',
            entityName: 'User',
            strategy: '$set',
            type: 'entities.partialUpdate'
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
            entities: { '123': { tags: ['developer', 'node', 'typescript'] } },
            entityId: '123',
            entityName: 'User',
            strategy: '$set',
            type: 'entities.partialUpdate'
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
            entities: { '123': { tags: ['developer', 'javascript'] } },
            entityId: '123',
            entityName: 'User',
            strategy: '$set',
            type: 'entities.partialUpdate'
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
            entities: { '123': { metadata: { joinDate: '2023-01-01', lastLogin: '2023-06-16' } } },
            entityId: '123',
            entityName: 'User',
            strategy: '$merge',
            type: 'entities.partialUpdate'
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
              '123': { settings: { preferences: { notifications: { email: true, push: true }, theme: 'light' } } }
            },
            entityId: '123',
            entityName: 'User',
            strategy: '$merge',
            type: 'entities.partialUpdate'
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
            type: 'entities.upsertEntities'
          },
          {
            entities: { '123': { profile: '456' } },
            entityId: '123',
            entityName: 'User',
            strategy: '$merge',
            type: 'entities.partialUpdate'
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
            entities: { '123': { profile: null } },
            entityId: '123',
            entityName: 'User',
            strategy: '$set',
            type: 'entities.partialUpdate'
          },
          { entityId: '456', entityName: 'Profile', type: 'entities.deleteEntity' }
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
            type: 'entities.upsertEntities'
          },
          {
            entities: { '123': { friends: ['456'] } },
            entityId: '123',
            entityName: 'User',
            strategy: '$set',
            type: 'entities.partialUpdate'
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
            entityName: 'User',
            entityId: '123',
            entities: { '123': { name: 'Johnny' } }
          })
        ]),
        false,
        'test-instance'
      );
    });

    it.skip('should handle deeply nested entity relationships', () => {
      // Setup complex state
      const userId = uuidv4();
      const postId = uuidv4();
      const commentId = uuidv4();

      stateManager.state = {
        User: {
          [userId]: { id: userId, name: 'John', posts: [postId] }
        },
        Post: {
          [postId]: { id: postId, title: 'Test Post', author: userId, comments: [commentId] }
        },
        Comment: {
          [commentId]: { id: commentId, text: 'Great post!', post: postId, author: userId }
        }
      };

      // Create a proxy for the user
      const userData = { id: userId, name: 'John', posts: [postId] };
      const user = EntityProxyManager.createEntityProxy('User', userId, userData, stateManager);

      // Create a new comment to add
      const newCommentId = uuidv4();
      const newComment = { id: newCommentId, text: 'Another comment', author: userId };

      // Add the comment to the post's comments array
      const post = { id: postId, title: 'Test Post', comments: [commentId, newCommentId] };
      user.posts = [post];

      // Verify dispatch was called with actions that handle the deep relationship
      expect(stateManager.dispatch).toHaveBeenCalled();

      // The exact assertions would depend on how your implementation handles this complex case
      // This is a simplified check
      const calls = (stateManager.dispatch as jest.Mock).mock.calls;
      const flattenedActions = calls.reduce((acc: any[], call: any[]) => [...acc, ...call[0]], []);

      // Check for actions related to the new comment
      const hasNewCommentAction = flattenedActions.some(
        (action: any) => action.type === 'entities.upsertEntities' && action.entities?.Comment?.[newCommentId]
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
            entities: { '123': { preferences: { categories: ['sports', 'tech', 'music'] } } },
            entityId: '123',
            entityName: 'User',
            strategy: '$merge',
            type: 'entities.partialUpdate'
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
            entities: { '123': { preferences: { categories: ['sports', 'tech'] } } },
            entityId: '123',
            entityName: 'User',
            strategy: '$merge',
            type: 'entities.partialUpdate'
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
            entities: { '123': { preferences: { categories: ['sports', 'gaming', 'music'] } } },
            entityId: '123',
            entityName: 'User',
            strategy: '$merge',
            type: 'entities.partialUpdate'
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
            entities: { '123': { preferences: { categories: ['sports', 'gaming', 'music'] } } },
            entityId: '123',
            entityName: 'User',
            strategy: '$merge',
            type: 'entities.partialUpdate'
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
            entities: { '123': { preferences: { categories: ['sports', 'tech'] } } },
            entityId: '123',
            entityName: 'User',
            strategy: '$merge',
            type: 'entities.partialUpdate'
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
            entities: { '123': { settings: { profile: { interests: ['coding', 'reading', 'hiking'] } } } },
            entityId: '123',
            entityName: 'User',
            strategy: '$merge',
            type: 'entities.partialUpdate'
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
            entities: { '456': { tags: ['personal', 'professional', 'academic'] } },
            entityId: '456',
            entityName: 'Profile',
            strategy: '$set',
            type: 'entities.partialUpdate'
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
            entities: { '789': { tags: ['draft', 'private', 'featured'] } },
            entityId: '789',
            entityName: 'Post',
            strategy: '$set',
            type: 'entities.partialUpdate'
          }
        ],
        false,
        'test-instance'
      );
    });
  });
});
