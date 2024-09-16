import 'reflect-metadata'; // Ensure reflect-metadata is imported
import { SETTER_METADATA_KEY } from './metadata';

export const Set = (name?: string) => {
  return (target: any, propertyKey: string) => {
    const setters = Reflect.getOwnMetadata(SETTER_METADATA_KEY, target) || {}; // Use getOwnMetadata
    setters[name || propertyKey] = propertyKey;
    Reflect.defineMetadata(SETTER_METADATA_KEY, setters, target); // Define metadata for the current class
  };
};
