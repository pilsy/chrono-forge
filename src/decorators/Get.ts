export const Get = (name?: string) => {
  return (target: any, propertyKey: string) => {
    if (!target.constructor._getters) {
      target.constructor._getters = {};
    }
    target.constructor._getters[name || propertyKey] = propertyKey;
  };
};
