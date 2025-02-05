import { schema } from 'normalizr';

export type SchemasDefinition = {
  [schemaName: string]: SchemaDefinition;
};

export type SchemaDefinition = {
  idAttribute?: string | ((entity: any, parent?: any, key?: string) => any);
} & Record<string, string | [string] | undefined>; // ✅ Fixed typing issue

export class SchemaManager {
  private constructor() {}
  private static instance: SchemaManager;
  private schemas: { [key: string]: schema.Entity } = {};
  private schemaDefinitions: SchemasDefinition = {}; // Stores definitions before resolution

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
  setSchemas(schemaConfig: SchemasDefinition): { [key: string]: schema.Entity } {
    this.schemaDefinitions = { ...this.schemaDefinitions, ...schemaConfig }; // Merge new definitions
    this.schemas = this.createSchemas(this.schemaDefinitions);
    return this.schemas;
  }

  /**
   * Registers a schema dynamically (used by AutoSchema).
   * If the schema already exists, it updates it.
   * @param schemaName The name of the schema.
   * @param schemaDefinition The schema definition.
   */
  registerSchema(schemaName: string, schemaDefinition: SchemaDefinition): void {
    this.schemaDefinitions[schemaName] = schemaDefinition;
    this.schemas = this.createSchemas(this.schemaDefinitions);
  }

  /**
   * Retrieves all schemas.
   * @returns The current schemas.
   */
  getSchemas(): { [key: string]: schema.Entity } {
    return this.schemas;
  }

  /**
   * Retrieves a specific schema by name.
   * @param schemaName The name of the schema to retrieve.
   * @returns The schema.
   * @throws Error if the schema is not defined.
   */
  getSchema(schemaName: string): schema.Entity {
    if (!this.schemas[schemaName]) {
      throw new Error(`Schema ${schemaName} not defined!`);
    }
    return this.schemas[schemaName];
  }

  /**
   * Overrides an existing schema dynamically at runtime.
   * @param schemaName The schema name.
   * @param overrideDefinition The new definition.
   */
  overrideSchema(schemaName: string, overrideDefinition: Partial<SchemaDefinition>): void {
    if (!this.schemaDefinitions[schemaName]) {
      throw new Error(`Schema ${schemaName} not found for override!`);
    }

    this.schemaDefinitions[schemaName] = {
      ...this.schemaDefinitions[schemaName],
      ...overrideDefinition
    };

    this.schemas = this.createSchemas(this.schemaDefinitions);
  }

  /**
   * Creates schemas dynamically based on the configuration provided.
   * Supports defining relationships between schemas.
   * @param schemaConfig The schema configuration.
   * @returns The created schemas.
   */
  private createSchemas(schemaConfig: SchemasDefinition) {
    const schemas: { [key: string]: schema.Entity } = {};

    // First pass: Create schema entities without relationships
    for (const [name, definition] of Object.entries(schemaConfig)) {
      const { idAttribute, ...relationships } = definition;

      schemas[name] = new schema.Entity(
        name,
        {},
        {
          idAttribute: typeof idAttribute === 'string' || typeof idAttribute === 'function' ? idAttribute : 'id'
        }
      );
    }

    // Second pass: Define relationships
    for (const [name, definition] of Object.entries(schemaConfig)) {
      const { idAttribute, ...relationships } = definition;
      const entitySchema = schemas[name];

      Object.entries(relationships).forEach(([relationKey, relationValue]) => {
        if (typeof relationValue === 'string') {
          if (!schemas[relationValue]) {
            console.warn(`Schema ${relationValue} not yet registered. Deferring resolution.`);
            return;
          }
          entitySchema.define({ [relationKey]: schemas[relationValue] });
        } else if (Array.isArray(relationValue)) {
          if (!schemas[relationValue[0]]) {
            console.warn(`Schema ${relationValue[0]} not yet registered. Deferring resolution.`);
            return;
          }
          entitySchema.define({ [relationKey]: [schemas[relationValue[0]]] });
        }
      });
    }

    return schemas;
  }
}
