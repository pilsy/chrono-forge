import 'reflect-metadata';
import { SchemaManager } from '../store/SchemaManager'; // Ensure this exists

const AUTO_SCHEMA_KEY = 'AutoSchema:properties';

// Define a class constructor type
type ClassConstructor<T = any> = { new (...args: any[]): T };

export function AutoSchema(): ClassDecorator {
  return (target: Function) => {
    if (typeof target !== 'function') {
      throw new Error('AutoSchema can only be applied to classes');
    }

    // Try to instantiate the class safely
    let instance: any;
    try {
      instance = new (target as ClassConstructor)();
    } catch (error) {
      console.warn(`Warning: AutoSchema could not instantiate ${target.name}.`);
      instance = {};
    }

    // Get instance properties (not prototype methods)
    const properties = Reflect.ownKeys(instance);

    // Store detected properties in metadata
    Reflect.defineMetadata(AUTO_SCHEMA_KEY, properties, target);

    console.log(`AutoSchema detected properties for ${target.name}:`, properties);

    // ✅ Register the schema in SchemaManager
    SchemaManager.getInstance().registerSchema(target.name, properties as any);
  };
}

// Utility function to retrieve properties of a decorated class
export function getClassProperties(target: Function): string[] {
  return Reflect.getMetadata(AUTO_SCHEMA_KEY, target) || [];
}
