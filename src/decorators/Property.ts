import 'reflect-metadata';
import { PROPERTY_METADATA_KEY, GETTER_METADATA_KEY, SETTER_METADATA_KEY } from './metadata';

export const Property = (options: { get?: boolean | string; set?: boolean | string } = {}) => {
  return (target: any, propertyKey: string) => {
    // Use getOwnMetadata to retrieve only metadata defined on the current class
    const properties = Reflect.getOwnMetadata(PROPERTY_METADATA_KEY, target) || [];

    properties.push({
      propertyKey,
      get: options.get || options.get === undefined,
      set: options.set || options.set === undefined,
      queryName: propertyKey,
      signalName: propertyKey
    });

    // Define metadata for the current class
    Reflect.defineMetadata(PROPERTY_METADATA_KEY, properties, target);

    if (options.get) {
      const getterName = typeof options.get === 'string' ? options.get : propertyKey;
      const getters = Reflect.getOwnMetadata(GETTER_METADATA_KEY, target) || {};
      getters[getterName] = propertyKey;
      Reflect.defineMetadata(GETTER_METADATA_KEY, getters, target);
    }

    if (options.set) {
      const setterName = typeof options.set === 'string' ? options.set : propertyKey;
      const setters = Reflect.getOwnMetadata(SETTER_METADATA_KEY, target) || {};
      setters[setterName] = propertyKey;
      Reflect.defineMetadata(SETTER_METADATA_KEY, setters, target);
    }
  };
};

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
