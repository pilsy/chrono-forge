import 'reflect-metadata'; // Ensure reflect-metadata is imported
import { GETTER_METADATA_KEY } from './metadata';

export const Get = (name?: string) => {
  return (target: any, propertyKey: string) => {
    const getters = Reflect.getOwnMetadata(GETTER_METADATA_KEY, target) || {}; // Use getOwnMetadata
    getters[name || propertyKey] = propertyKey;
    Reflect.defineMetadata(GETTER_METADATA_KEY, getters, target); // Define metadata for the current class
  };
};
