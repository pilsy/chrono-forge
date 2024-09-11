export const Step = (options: { name?: string; on?: () => boolean; before?: string | string[]; after?: string | string[] } = {}) => {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    const stepName = options.name || propertyKey;
    if (!target.constructor._steps) {
      target.constructor._steps = [];
    }
    target.constructor._steps.push({
      name: stepName,
      method: propertyKey,
      on: options.on,
      before: options.before,
      after: options.after
    });
  };
};
