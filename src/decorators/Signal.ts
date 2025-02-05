import 'reflect-metadata';
import { SIGNAL_METADATA_KEY } from './metadata';

export const Signal = (name?: string) => {
  return (target: any, propertyKey: string) => {
    const signals = Reflect.getOwnMetadata(SIGNAL_METADATA_KEY, target) || [];
    signals.push([name || propertyKey, propertyKey]);
    Reflect.defineMetadata(SIGNAL_METADATA_KEY, signals, target);
  };
};
