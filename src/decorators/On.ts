export const On = (event: string) => {
  return (target: any, propertyKey: string) => {
    if (!target.constructor._eventHandlers) {
      target.constructor._eventHandlers = [];
    }
    target.constructor._eventHandlers.push({ event, method: propertyKey });
  };
};
