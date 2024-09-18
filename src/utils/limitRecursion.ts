import { isObject } from 'lodash';

export const limitRecursion = (ob: Record<string, any>, root: Record<string, any>) => {
  const seen = new WeakSet();

  const recurse = (obj: Record<string, any>, rootEntities: Record<string, any>) => {
    if (!obj || typeof obj !== 'object') return obj;

    if (seen.has(obj)) {
      const idAttribute = rootEntities[rootEntities.length - 1].idAttribute || 'id';
      return obj?.[idAttribute] || null;
    }
    seen.add(obj);

    const rootEntity = rootEntities[rootEntities.length - 1];

    return Object.entries(obj).reduce((acc, [key, value]): any => {
      if (rootEntity.schema[key]) {
        const subEntity = Array.isArray(rootEntity.schema[key]) ? rootEntity.schema[key][0] : rootEntity.schema[key];
        const subEntities = Array.isArray(rootEntity.schema[key]) ? obj[key] : obj[key];

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

        const idAttribute = rootEntities[0].idAttribute || 'id';
        return {
          ...acc,
          [key]: Array.isArray(subEntities)
            ? // @ts-ignore
              subEntities.map((s: any): any => (isObject(s) ? s?.[idAttribute] : s))
            : isObject(subEntities)
              ? // @ts-ignore
                subEntities?.[idAttribute]
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
