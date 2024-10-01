import { Mutex as MutexLock } from 'async-mutex';

const instanceMutexMap: WeakMap<any, Map<string, MutexLock>> = new WeakMap();

export function Mutex(mutexName: string = 'execute'): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor): void => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      let mutexMap = instanceMutexMap.get(this);

      if (!mutexMap) {
        mutexMap = new Map<string, MutexLock>();
        instanceMutexMap.set(this, mutexMap);
      }

      let mutex = mutexMap.get(mutexName);

      if (!mutex) {
        mutex = new MutexLock();
        mutexMap.set(mutexName, mutex);
      }

      return mutex.runExclusive(() => originalMethod.apply(this, args));
    };
  };
}
