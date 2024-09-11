export const ContinueAsNew = () => {
  return (target: any, propertyKey: string) => {
    if (!target.constructor.prototype._continueAsNewMethod) {
      target.constructor.prototype._continueAsNewMethod = propertyKey;
    } else {
      throw new Error(
        `@ContinueAsNew decorator can only be applied to one method in a class. It has already been applied to ${target.constructor.prototype._continueAsNewMethod}.`
      );
    }
  };
};
