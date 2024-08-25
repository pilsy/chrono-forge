import { Schema } from 'normalizr';

let currentSchema: { [key: string]: Schema } | null = null;

export const setSchema = (schema: { [key: string]: Schema }): void => {
  currentSchema = schema;
};

export const getSchema = (): { [key: string]: Schema } | null => {
  return currentSchema;
};
