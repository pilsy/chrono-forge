import 'reflect-metadata';
import { VALIDATOR_METADATA_KEY } from './metadata';

export const Validator = (actionName: string) => {
  return (target: any, propertyKey: string) => {
    const validators = Reflect.getMetadata(VALIDATOR_METADATA_KEY, target) || {};
    validators[actionName] = propertyKey;

    Reflect.defineMetadata(VALIDATOR_METADATA_KEY, validators, target);
  };
};
