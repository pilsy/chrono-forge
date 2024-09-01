import { schema as NormalizrSchema } from 'normalizr';

interface SchemaDefinition {
  idAttribute?: string | ((entity: any, parent?: any, key?: string) => any);
  [key: string]: any;
}

export class SchemaManager {
  private static instance: SchemaManager;
  private schemas: { [key: string]: NormalizrSchema.Entity } = {};

  private constructor() {}

  public setSchemas(schemaConfig: { [key: string]: SchemaDefinition }): void {
    this.schemas = this.createSchemas(schemaConfig);
  }

  public getSchemas(): { [key: string]: NormalizrSchema.Entity } {
    return this.schemas;
  }

  public getSchema(schemaName: string): NormalizrSchema.Entity {
    if (!this.schemas[schemaName]) {
      throw new Error(`Schema ${schemaName} not defined!`);
    }
    return this.schemas[schemaName];
  }

  public clearSchemas(): void {
    this.schemas = {};
  }

  // Creates schemas dynamically based on the configuration provided
  private createSchemas(schemaConfig: { [key: string]: SchemaDefinition }): {
    [key: string]: NormalizrSchema.Entity;
  } {
    const schemas: { [key: string]: NormalizrSchema.Entity } = {};

    // First pass: Create schema entities without relationships
    for (const [name, definition] of Object.entries(schemaConfig)) {
      const { idAttribute, ...relations } = definition;

      // Properly handle idAttribute casting
      schemas[name] = new NormalizrSchema.Entity(
        name,
        {},
        {
          idAttribute: typeof idAttribute === 'string' || typeof idAttribute === 'function' ? idAttribute : 'id'
        }
      );
    }

    // Second pass: Define relationships
    for (const [name, definition] of Object.entries(schemaConfig)) {
      const { idAttribute, ...relations } = definition;
      const entitySchema = schemas[name];

      Object.entries(relations).forEach(([relationKey, relationValue]) => {
        if (typeof relationValue === 'string') {
          entitySchema.define({ [relationKey]: schemas[relationValue] });
        } else if (Array.isArray(relationValue)) {
          entitySchema.define({ [relationKey]: [schemas[relationValue[0]]] });
        }
      });
    }

    return schemas;
  }

  // Static method to retrieve the singleton instance
  public static getInstance(): SchemaManager {
    if (!this.instance) {
      this.instance = new SchemaManager();
    }
    return this.instance;
  }
}

export default SchemaManager.getInstance();
