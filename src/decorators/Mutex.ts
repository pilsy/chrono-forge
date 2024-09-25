import { Mutex as MutexLock } from 'async-mutex';

export function Mutex(): MethodDecorator {
  const mutex = new MutexLock();

  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor): void => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      return mutex.runExclusive(() => originalMethod.apply(this, args));
    };
  };
}
