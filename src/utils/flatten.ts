import { isObject } from 'lodash';
import { map, chain, toPairs, fromPairs } from 'ramda';

export function flatten(nestedObject: Record<string, unknown>, maxDepth = 2): Record<string, any> {
  // @ts-ignore
  const traverse = (obj_, depth = 1) =>
    chain(
      // @ts-ignore
      ([k, v]) => (isObject(v) && depth < maxDepth ? map(([k_, v_]) => [`${k}_${k_}`, v_], traverse(v, depth + 1)) : [[k, v]]),
      toPairs(obj_)
    );

  return fromPairs(traverse(JSON.parse(JSON.stringify(nestedObject))));
}
