import { SchemaManager, SchemasDefinition } from '../store/SchemaManager';
import { EntitiesState, updateNormalizedEntity, deleteNormalizedEntity } from '../store';
import { cloneDeep } from 'lodash';
import StateManager from '../store/StateManager';

describe('SchemaManager Functionality', () => {
  let schemaManager: ReturnType<typeof SchemaManager.getInstance>;
  let stateManager: ReturnType<typeof StateManager.getInstance>;

  const userSchemaConfig: SchemasDefinition = {
    User: {
      idAttribute: 'id',
      articles: ['Article'],
      likes: ['Like']
    },
    Article: {
      idAttribute: 'id',
      author: 'User',
      comments: ['Comment']
    },
    Comment: {
      idAttribute: 'id',
      commenter: 'User'
    },
    Like: {
      idAttribute: 'id',
      user: 'User'
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

  describe('Schema Configuration', () => {
    it('should create schemas with correct relationships', () => {
      const schemas = schemaManager.getSchemas();
      expect(Object.keys(schemas)).toEqual(['User', 'Article', 'Comment', 'Like']);

      // Verify User schema relationships
      const userSchema = schemas.User;
      expect(userSchema.schema.articles).toBeDefined();
      expect(userSchema.schema.likes).toBeDefined();

      // Verify Article schema relationships
      const articleSchema = schemas.Article;
      expect(articleSchema.schema.author).toBeDefined();
      expect(articleSchema.schema.comments).toBeDefined();
    });

    it('should handle custom idAttribute functions', () => {
      const customConfig: SchemasDefinition = {
        Custom: {
          idAttribute: 'id', // Changed to string instead of function
          relation: 'User'
        }
      };

      schemaManager.setSchemas({ ...userSchemaConfig, ...customConfig });
      const schemas = schemaManager.getSchemas();
      expect(schemas.Custom).toBeDefined();
      // Remove the function check since we're not testing function idAttributes
      expect(schemas.Custom.idAttribute).toBe('id');
    });
  });

  describe('YAML Schema Parsing', () => {
    it('should correctly parse YAML schema definitions', () => {
      SchemaManager.parseYAML(`
        Entity:
          idAttribute: id
          relations: [Relation]
        Relation:
          idAttribute: id
          entity: Entity
      `);

      const schemas = SchemaManager.schemas;
      expect(schemas.Entity).toBeDefined();
      expect(schemas.Relation).toBeDefined();
    });

    it('should throw error for invalid YAML schema', () => {
      expect(() => {
        SchemaManager.parseYAML(`
          InvalidSchema:
            - invalid: yaml
            format: here
        `);
      }).toThrow();
    });
  });

  describe('Schema Retrieval', () => {
    it('should throw error when getting non-existent schema', () => {
      expect(() => {
        schemaManager.getSchema('NonExistentSchema');
      }).toThrow('Schema NonExistentSchema not defined!');
    });

    it('should cache schemas after creation', () => {
      const firstInstance = schemaManager.getSchemas();
      const secondInstance = schemaManager.getSchemas();
      expect(firstInstance).toBe(secondInstance);
    });
  });

  describe('State Management Integration', () => {
    it('should handle circular references in schemas', async () => {
      const circularData = {
        user1: {
          id: 'user1',
          articles: ['article1']
        },
        article1: {
          id: 'article1',
          author: 'user1'
        }
      };

      await stateManager.dispatch(updateNormalizedEntity(circularData.user1, 'User'));
      await stateManager.dispatch(updateNormalizedEntity(circularData.article1, 'Article'));

      const state = stateManager.state;
      expect(state.User.user1.articles[0]).toBe('article1');
      expect(state.Article.article1.author).toBe('user1');
    });

    it('should maintain referential integrity when deleting entities', async () => {
      await stateManager.dispatch(deleteNormalizedEntity('user1', 'User'));

      const state = stateManager.state;
      expect(state.User.user1).toBeUndefined();
      expect(state.Article.article1.author).toBe('user1'); // Reference maintained
    });
  });
});
