export function CacheResult(): MethodDecorator {
  const cache = new Map<string, any>();

  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor): void => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const cacheKey = JSON.stringify(args);
      if (cache.has(cacheKey)) {
        return cache.get(cacheKey);
      }

      const result = await originalMethod.apply(this, args);
      cache.set(cacheKey, result);
      return result;
    };
  };
}
