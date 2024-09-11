export const Property = (options: { get?: boolean | string; set?: boolean | string } = {}) => {
  return (target: any, propertyKey: string) => {
    if (!target.constructor._properties) {
      target.constructor._properties = [];
    }

    const queryName = `query${capitalize(typeof options.get === 'string' ? options.get : propertyKey)}`;
    const signalName = `signal${capitalize(typeof options.set === 'string' ? options.set : propertyKey)}`;

    target.constructor._properties.push({
      propertyKey,
      get: options.get || options.get === undefined,
      set: options.set || options.set === undefined,
      queryName,
      signalName
    });

    if (options.get) {
      const getterName = typeof options.get === 'string' ? options.get : propertyKey;
      target.constructor._getters = target.constructor._getters || {};
      target.constructor._getters[getterName] = propertyKey;
    }

    if (options.set) {
      const setterName = typeof options.set === 'string' ? options.set : propertyKey;
      target.constructor._setters = target.constructor._setters || {};
      target.constructor._setters[setterName] = propertyKey;
    }
  };
};

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
