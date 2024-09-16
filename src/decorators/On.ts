import 'reflect-metadata';
import { EVENTS_METADATA_KEY } from './metadata';

export const On = (event: string) => {
  return (target: any, propertyKey: string) => {
    const eventHandlers = Reflect.getOwnMetadata(EVENTS_METADATA_KEY, target) || [];

    eventHandlers.push({ event, method: propertyKey });

    Reflect.defineMetadata(EVENTS_METADATA_KEY, eventHandlers, target);
  };
};
