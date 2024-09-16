import 'reflect-metadata';
import { SIGNAL_METADATA_KEY } from '../workflows/Workflow';

export const Signal = (name?: string) => {
  return (target: any, propertyKey: string) => {
    const signals = Reflect.getMetadata(SIGNAL_METADATA_KEY, target) || [];
    signals.push([name || propertyKey, propertyKey]);
    Reflect.defineMetadata(SIGNAL_METADATA_KEY, signals, target);
  };
};
