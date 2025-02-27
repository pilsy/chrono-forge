import yaml from 'js-yaml';
import { schema, Schema } from 'normalizr';

/**
 * Represents a relationship between schemas with ID attribute and key
 */
export type SchemaRelationship = {
  _idAttribute: string;
  _key: string;
  idAttribute: string | ((entity: any, parent?: any, key?: string) => any);
};

/**
 * Enhanced Entity schema with additional schema definition and ID attribute
 */
export interface EnhancedEntity extends schema.Entity {
  schema: {
    [key: string]: (Schema & SchemaRelationship) | [Schema & SchemaRelationship];
  };
  idAttribute: string | ((entity: any, parent?: any, key?: string) => any);
}

/**
 * Definition of all schemas with their names as keys
 */
export type SchemasDefinition = {
  [schemaName: string]: SchemaDefinition;
};

/**
 * Definition of a single schema with ID attribute and relationships
 */
export type SchemaDefinition = {
  idAttribute?: string | ((entity: any, parent?: any, key?: string) => any);
} & Record<string, string | [string]>;

/**
 * Represents a relationship between entities
 */
export type Relationship = {
  relatedEntityName: string;
  isMany: boolean;
};

/**
 * Represents how an entity is referenced by another entity
 */
export type ReferencedBy = {
  fieldName: string;
  isMany: boolean;
};

/**
 * Map of entities that reference this entity
 */
export type ReferencedByMap = {
  [referencingEntityName: string]: ReferencedBy;
};

/**
 * Represents all relationships for an entity
 */
export type EntityRelationships = {
  [fieldName: string]: Relationship | undefined;
} & { _referencedBy: ReferencedByMap };

/**
 * Map of all entities and their relationships
 */
export type RelationshipMap = {
  [entityName: string]: EntityRelationships;
};

/**
 * Manages schema definitions and relationships between entities
 */
export class SchemaManager {
  private constructor() {}
  private static instance: SchemaManager;
  private schemas: Record<string, EnhancedEntity> = {};
  private relationshipMap: RelationshipMap = {};

  /**
   * Gets all registered schemas
   * @returns Record of all schemas
   */
  public static get schemas(): Record<string, EnhancedEntity> {
    return this.getInstance().getSchemas();
  }

  /**
   * Gets the relationship map between all entities
   * @returns RelationshipMap containing all entity relationships
   */
  public static get relationshipMap(): RelationshipMap {
    return this.getInstance().getRelationshipMap();
  }

  /**
   * Gets the singleton instance of SchemaManager
   * @returns SchemaManager instance
   */
  public static getInstance(): SchemaManager {
    if (!this.instance) {
      this.instance = new SchemaManager();
    }
    return this.instance;
  }

  /**
   * Sets schemas based on the provided configuration.
   * @param schemaConfig The schema configuration to set.
   * @returns The current schemas.
   */
  setSchemas(schemaConfig: SchemasDefinition): Record<string, EnhancedEntity> {
    // @ts-expect-error stfu
    this.schemas = this.createSchemas(schemaConfig);
    return this.schemas;
  }

  /**
   * Retrieves all schemas.
   * @returns The current schemas.
   */
  getSchemas(): Record<string, EnhancedEntity> {
    return this.schemas;
  }

  /**
   * Retrieves a specific schema by name.
   * @param schemaName The name of the schema to retrieve.
   * @returns The schema.
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
   * Supports defining relationships between schemas.
   * @param schemaConfig The schema configuration.
   * @returns The created schemas.
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
   * @param yamlSchema The YAML string containing schema definitions.
   */
  public static parseYAML(yamlSchema: string): void {
    const schemaManager = SchemaManager.getInstance();
    const schemaConfig = yaml.load(yamlSchema) as Record<string, any>;
    schemaManager.setSchemas(schemaConfig);
  }

  /**
   * Gets the relationship map for all entities
   * @returns RelationshipMap containing all entity relationships
   */
  public getRelationshipMap(): RelationshipMap {
    return this.relationshipMap;
  }
}

/**
 * Exports the schemas from SchemaManager
 */
export const { schemas } = SchemaManager;
