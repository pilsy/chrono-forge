/**
 * Decorator metadata store.
 *
 * Temporal's workflow sandbox freezes its global objects in current SDK versions, so polyfills that add
 * functions to the global `Reflect` object (such as `reflect-metadata`) throw
 * `TypeError: Cannot define property decorate, object is not extensible` while the workflow bundle loads,
 * and every workflow fails. This module keeps decorator metadata in a module-level `WeakMap` instead and
 * never touches a global.
 *
 * The three functions mirror the subset of the `reflect-metadata` API that temporal-forge used:
 * `defineMetadata(key, value, target)`, `getOwnMetadata(key, target)` and `getMetadata(key, target)`, where
 * `getMetadata` also looks up the prototype chain.
 */

type MetadataKey = symbol | string;

const store = new WeakMap<object, Map<MetadataKey, unknown>>();

/** Store `value` under `key` on `target` itself (not on its prototypes). */
export function defineMetadata(key: MetadataKey, value: unknown, target: object): void {
  let entries = store.get(target);
  if (!entries) {
    entries = new Map();
    store.set(target, entries);
  }
  entries.set(key, value);
}

/** The value stored under `key` on `target` itself, or `undefined`. */
export function getOwnMetadata<T = any>(key: MetadataKey, target: object): T | undefined {
  return store.get(target)?.get(key) as T | undefined;
}

/** The value stored under `key` on `target` or the nearest prototype that has one, or `undefined`. */
export function getMetadata<T = any>(key: MetadataKey, target: object): T | undefined {
  let current: object | null = target;
  while (current) {
    const entries = store.get(current);
    if (entries?.has(key)) {
      return entries.get(key) as T;
    }
    current = Object.getPrototypeOf(current);
  }
  return undefined;
}
