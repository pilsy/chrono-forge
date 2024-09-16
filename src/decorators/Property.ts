import 'reflect-metadata';
import { PROPERTY_METADATA_KEY, GETTER_METADATA_KEY, SETTER_METADATA_KEY } from '../workflows/Workflow';

export const Property = (options: { get?: boolean | string; set?: boolean | string } = {}) => {
  return (target: any, propertyKey: string) => {
    const properties = Reflect.getMetadata(PROPERTY_METADATA_KEY, target) || [];

    // const queryName = `query${capitalize(typeof options.get === 'string' ? options.get : propertyKey)}`;
    // const signalName = `signal${capitalize(typeof options.set === 'string' ? options.set : propertyKey)}`;

    properties.push({
      propertyKey,
      get: options.get || options.get === undefined,
      set: options.set || options.set === undefined,
      queryName: propertyKey,
      signalName: propertyKey
    });

    Reflect.defineMetadata(PROPERTY_METADATA_KEY, properties, target);

    if (options.get) {
      const getterName = typeof options.get === 'string' ? options.get : propertyKey;
      const getters = Reflect.getMetadata(GETTER_METADATA_KEY, target) || {};
      getters[getterName] = propertyKey;
      Reflect.defineMetadata(GETTER_METADATA_KEY, getters, target);
    }

    if (options.set) {
      const setterName = typeof options.set === 'string' ? options.set : propertyKey;
      const setters = Reflect.getMetadata(SETTER_METADATA_KEY, target) || {};
      setters[setterName] = propertyKey;
      Reflect.defineMetadata(SETTER_METADATA_KEY, setters, target);
    }
  };
};

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
