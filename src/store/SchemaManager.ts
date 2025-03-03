import yaml from 'js-yaml';
import { schema, Schema } from 'normalizr';

/**
 * Represents a relationship between schemas with ID attribute and key.
 * This type extends the base Schema with additional relationship metadata.
 */
export type SchemaRelationship = {
  _idAttribute: string;
  _key: string;
  idAttribute: string | ((entity: any, parent?: any, key?: string) => any);
};

/**
 * Enhanced Entity schema that extends normalizr's Entity with additional schema definition and ID attribute.
 * Provides type safety for schema relationships and custom ID attribute functions.
 */
export interface EnhancedEntity extends schema.Entity {
  schema: {
    [key: string]: (Schema & SchemaRelationship) | [Schema & SchemaRelationship];
  };
  idAttribute: string | ((entity: any, parent?: any, key?: string) => any);
}

/**
 * Definition of all schemas with their names as keys.
 * Used as the primary configuration input for the SchemaManager.
 */
export type SchemasDefinition = {
  [schemaName: string]: SchemaDefinition;
};

/**
 * Definition of a single schema with optional ID attribute and relationships.
 * Each field represents either a single or array relationship to another entity.
 */
export type SchemaDefinition = {
  idAttribute?: string | ((entity: any, parent?: any, key?: string) => any);
} & Record<string, string | [string]>;

/**
 * Represents a relationship between entities.
 * Defines whether the relationship is to one (single) or many (collection) entities.
 */
export type Relationship = {
  relatedEntityName: string;
  isMany: boolean;
};

/**
 * Represents how an entity is referenced by another entity.
 * Contains the field name in the referencing entity and whether it's a collection.
 */
export type ReferencedBy = {
  fieldName: string;
  isMany: boolean;
};

/**
 * Map of entities that reference this entity.
 * Keys are the names of referencing entities, values describe how they reference this entity.
 */
export type ReferencedByMap = {
  [referencingEntityName: string]: ReferencedBy;
};

/**
 * Represents all relationships for an entity.
 * Includes both outgoing relationships and incoming references (_referencedBy).
 */
export type EntityRelationships = {
  [fieldName: string]: Relationship | undefined;
} & { _referencedBy: ReferencedByMap };

/**
 * Map of all entities and their relationships.
 * Provides a complete picture of the data model's relational structure.
 */
export type RelationshipMap = {
  [entityName: string]: EntityRelationships;
};

/**
 * Manages schema definitions and relationships between entities.
 * Implements the Singleton pattern to ensure a single source of truth for schemas.
 * Provides methods to create, retrieve, and analyze entity relationships.
 */
export class SchemaManager {
  private constructor() {}
  private static instance: SchemaManager;
  private schemas: Record<string, EnhancedEntity> = {};
  private relationshipMap: RelationshipMap = {};

  /**
   * Gets all registered schemas.
   * @returns Record of all schema entities indexed by name.
   */
  public static get schemas(): Record<string, EnhancedEntity> {
    return this.getInstance().getSchemas();
  }

  /**
   * Gets the relationship map between all entities.
   * @returns RelationshipMap containing all entity relationships.
   */
  public static get relationshipMap(): RelationshipMap {
    return this.getInstance().getRelationshipMap();
  }

  /**
   * Gets the singleton instance of SchemaManager.
   * Creates the instance if it doesn't exist yet.
   * @returns The singleton SchemaManager instance.
   */
  public static getInstance(): SchemaManager {
    if (!this.instance) {
      this.instance = new SchemaManager();
    }
    return this.instance;
  }

  /**
   * Sets schemas based on the provided configuration.
   * Creates schema entities and builds the relationship map.
   * @param schemaConfig The schema configuration to set.
   * @returns The created schema entities.
   */
  setSchemas(schemaConfig: SchemasDefinition): Record<string, EnhancedEntity> {
    // @ts-expect-error stfu
    this.schemas = this.createSchemas(schemaConfig);
    return this.schemas;
  }

  /**
   * Retrieves all registered schemas.
   * @returns The current schema entities.
   */
  getSchemas(): Record<string, EnhancedEntity> {
    return this.schemas;
  }

  /**
   * Retrieves a specific schema by name.
   * @param schemaName The name of the schema to retrieve.
   * @returns The requested schema entity.
   * @throws Error if the schema is not defined.
   */
  getSchema(schemaName: string): EnhancedEntity {
    if (!this.schemas[schemaName]) {
      throw new Error(`Schema ${schemaName} not defined!`);
    }
    return this.schemas[schemaName];
  }

  /**
   * Creates schemas dynamically based on the configuration provided.
   * Performs a two-pass process:
   * 1. Creates schema entities without relationships
   * 2. Defines relationships between entities and builds the relationship map
   *
   * @param schemaConfig The schema configuration.
   * @returns The created schema entities.
   */
  private createSchemas(schemaConfig: SchemasDefinition) {
    const schemas: { [key: string]: schema.Entity } = {};
    this.relationshipMap = {};

    // First pass: Create schema entities without relationships
    for (const [name, definition] of Object.entries(schemaConfig)) {
      const { idAttribute } = definition;

      schemas[name] = new schema.Entity(
        name,
        {},
        {
          idAttribute: typeof idAttribute === 'string' || typeof idAttribute === 'function' ? idAttribute : 'id'
        }
      );

      // Initialize relationship map structure for this entity
      this.relationshipMap[name] = {
        _referencedBy: {} as { [referencingEntityName: string]: ReferencedBy }
      } as EntityRelationships;
    }

    // Second pass: Define relationships and build relationship map
    for (const [name, definition] of Object.entries(schemaConfig)) {
      const { idAttribute, ...relationships } = definition;
      const entitySchema = schemas[name];

      Object.entries(relationships).forEach(([relationKey, relationValue]) => {
        let relatedEntityName: string;
        let isMany = false;

        if (typeof relationValue === 'string') {
          relatedEntityName = relationValue;
        } else if (Array.isArray(relationValue)) {
          relatedEntityName = relationValue[0];
          isMany = true;
        } else {
          return;
        }

        // Define the relationship in the schema
        if (isMany) {
          entitySchema.define({ [relationKey]: [schemas[relatedEntityName]] });
        } else {
          entitySchema.define({ [relationKey]: schemas[relatedEntityName] });
        }

        // Add to relationship map
        if (!this.relationshipMap[name][relationKey]) {
          this.relationshipMap[name][relationKey] = {
            relatedEntityName,
            isMany
          };
        }

        // Add to _referencedBy of the related entity
        if (!(this.relationshipMap[relatedEntityName] as { _referencedBy: any })._referencedBy[name]) {
          (this.relationshipMap[relatedEntityName] as { _referencedBy: any })._referencedBy[name] = {
            fieldName: relationKey,
            isMany
          };
        }
      });
    }

    return schemas;
  }

  /**
   * Parses schemas from a YAML string and sets them in the SchemaManager.
   * Convenience method for initializing schemas from YAML configuration.
   *
   * @param yamlSchema The YAML string containing schema definitions.
   */
  public static parseYAML(yamlSchema: string): void {
    const schemaManager = SchemaManager.getInstance();
    const schemaConfig = yaml.load(yamlSchema) as Record<string, any>;
    schemaManager.setSchemas(schemaConfig);
  }

  /**
   * Gets the relationship map for all entities.
   * The relationship map describes both outgoing and incoming relationships.
   *
   * @returns RelationshipMap containing all entity relationships.
   */
  public getRelationshipMap(): RelationshipMap {
    return this.relationshipMap;
  }
}

/**
 * Exports the schemas from SchemaManager.
 * Provides a convenient way to access the schemas without directly using the SchemaManager.
 */
export const { schemas } = SchemaManager;
