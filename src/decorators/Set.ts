import 'reflect-metadata'; // Ensure reflect-metadata is imported
import { SETTER_METADATA_KEY } from '../workflows/Workflow';

export const Set = (name?: string) => {
  return (target: any, propertyKey: string) => {
    const setters = Reflect.getMetadata(SETTER_METADATA_KEY, target) || {};
    setters[name || propertyKey] = propertyKey;
    Reflect.defineMetadata(SETTER_METADATA_KEY, setters, target);
  };
};
