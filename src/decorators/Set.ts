export const Set = (name?: string) => {
  return (target: any, propertyKey: string) => {
    if (!target.constructor._setters) {
      target.constructor._setters = {};
    }
    target.constructor._setters[name || propertyKey] = propertyKey;
  };
};
