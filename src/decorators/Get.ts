import 'reflect-metadata'; // Ensure reflect-metadata is imported
import { GETTER_METADATA_KEY } from '../workflows/Workflow';

export const Get = (name?: string) => {
  return (target: any, propertyKey: string) => {
    const getters = Reflect.getMetadata(GETTER_METADATA_KEY, target) || {};
    getters[name || propertyKey] = propertyKey;
    Reflect.defineMetadata(GETTER_METADATA_KEY, getters, target);
  };
};
