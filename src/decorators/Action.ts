import 'reflect-metadata';
import { ACTIONS_METADATA_KEY } from './metadata';

export function Action(options?: { blocking?: boolean }) {
  return function (target: any, propertyKey: string) {
    const actions = Reflect.getOwnMetadata(ACTIONS_METADATA_KEY, target) || [];

    actions.push({
      method: propertyKey,
      options
    });

    Reflect.defineMetadata(ACTIONS_METADATA_KEY, actions, target);
  };
}
