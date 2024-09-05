import isObject from 'lodash.isobject';

export const limitRecursion = (ob: Record<string, any>, root: Record<string, any>) => {
  const seen = new WeakSet();

  const recurse = (obj: Record<string, any>, rootEntities: Record<string, any>) => {
    if (!obj || typeof obj !== 'object') return obj;

    // Check if we have already processed this object
    if (seen.has(obj)) {
      return obj?.id || null; // Return the ID or null to stop recursion
    }
    seen.add(obj); // Mark this object as processed

    const rootEntity = rootEntities[rootEntities.length - 1];

    return Object.entries(obj).reduce((acc, [key, value]): any => {
      if (rootEntity.schema[key]) {
        const subEntity = rootEntity.schema[key] instanceof Array ? rootEntity.schema[key][0] : rootEntity.schema[key];
        const subEntities = rootEntity.schema[key] instanceof Array ? obj[key] : obj[key];

        if (rootEntities[0] !== subEntity) {
          rootEntities.push(subEntity);
          if (!subEntities || subEntities === null) {
            return acc;
          }
          return {
            ...acc,
            [key]: Array.isArray(subEntities)
              ? subEntities.map((s: any): any => (typeof s !== 'string' && typeof s !== 'number' && s !== null ? recurse(s, rootEntities) : s))
              : typeof subEntities === 'string' || typeof subEntities === 'number' || subEntities === null
                ? subEntities
                : recurse(subEntities, rootEntities)
          };
        }
        return {
          ...acc,
          [key]: Array.isArray(subEntities)
            ? // @ts-ignore
              subEntities.map((s: any): any => (isObject(s) ? s?.id : s))
            : isObject(subEntities)
              ? // @ts-ignore
                subEntities?.id
              : subEntities
        };
      }

      return { ...acc, [key]: value };
    }, {});
  };

  if (Array.isArray(ob)) {
    return ob.map((o) => recurse(o, [root]));
  }
  return recurse(ob, [root]);
};
