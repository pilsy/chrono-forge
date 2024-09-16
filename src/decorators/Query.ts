import 'reflect-metadata';
import { QUERY_METADATA_KEY } from './metadata';

export const Query = (name?: string) => {
  return (target: any, propertyKey: string) => {
    const queries = Reflect.getOwnMetadata(QUERY_METADATA_KEY, target) || []; // Use getOwnMetadata
    queries.push([name || propertyKey, propertyKey]);
    Reflect.defineMetadata(QUERY_METADATA_KEY, queries, target); // Define metadata for the current class
  };
};
