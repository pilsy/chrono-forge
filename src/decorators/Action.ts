import 'reflect-metadata';
import { ACTIONS_METADATA_KEY } from './metadata';

export interface ActionOptions<TInput = any, TOutput = any> {
  blocking?: boolean;
  inputType?: TInput;
  outputType?: TOutput;
}

export function Action<TInput, TOutput>(options?: ActionOptions<TInput, TOutput>) {
  return (target: any, propertyKey: string) => {
    const actions = Reflect.getMetadata(ACTIONS_METADATA_KEY, target) || [];
    actions.push({
      method: propertyKey,
      options: options || {}
    });
    Reflect.defineMetadata(ACTIONS_METADATA_KEY, actions, target);
  };
}
