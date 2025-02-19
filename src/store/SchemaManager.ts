import yaml from 'js-yaml';
import { schema } from 'normalizr';

export type SchemasDefinition = {
  [schemaName: string]: SchemaDefinition;
};

export type SchemaDefinition = {
  idAttribute?: string | ((entity: any, parent?: any, key?: string) => any);
} & Record<string, string | [string]>;

export class SchemaManager {
  private constructor() {}
  private static instance: SchemaManager;
  private schemas: { [key: string]: schema.Entity } = {};
  private static cachedSchemas: { [key: string]: schema.Entity } | null = null;

  public static get schemas(): { [key: string]: schema.Entity } {
    return this.getInstance().getSchemas();
  }

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
    this.schemas = this.createSchemas(schemaConfig);
    SchemaManager.cachedSchemas = this.schemas;
    return this.schemas;
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
   * Creates schemas dynamically based on the configuration provided.
   * Supports defining relationships between schemas.
   * @param schemaConfig The schema configuration.
   * @returns The created schemas.
   */
  private createSchemas(schemaConfig: SchemasDefinition) {
    const schemas: { [key: string]: schema.Entity } = {};

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
    }

    // Second pass: Define relationships
    for (const [name, definition] of Object.entries(schemaConfig)) {
      const { idAttribute, ...relationships } = definition;
      const entitySchema = schemas[name];

      Object.entries(relationships).forEach(([relationKey, relationValue]) => {
        if (typeof relationValue === 'string') {
          entitySchema.define({ [relationKey]: schemas[relationValue] });
        } else if (Array.isArray(relationValue)) {
          entitySchema.define({ [relationKey]: [schemas[relationValue[0]]] });
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
}

export const { schemas } = SchemaManager;
