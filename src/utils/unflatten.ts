import { assocPath, path, reduce, keys, split } from 'ramda';

export function unflatten(nestedObject: Record<string, unknown>) {
  return reduce(
    (mem, key) => {
      const pathParts = split('_', key);
      const pathValue = path([key], nestedObject);

      return assocPath(pathParts, pathValue, mem);
    },
    {},
    keys(nestedObject)
  );
}
