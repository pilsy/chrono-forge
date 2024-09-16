import 'reflect-metadata';
import { QUERY_METADATA_KEY } from '../workflows/Workflow';

export const Query = (name?: string) => {
  return (target: any, propertyKey: string) => {
    const queries = Reflect.getMetadata(QUERY_METADATA_KEY, target) || [];
    queries.push([name || propertyKey, propertyKey]);
    Reflect.defineMetadata(QUERY_METADATA_KEY, queries, target);
  };
};
