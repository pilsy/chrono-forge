function Guard(checkFunction: (...args: any[]) => boolean | Promise<boolean>): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor): void => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const canExecute = await checkFunction.apply(this, args);
      if (!canExecute) {
        throw new Error(`Guard check failed for method ${String(propertyKey)}`);
      }
      return originalMethod.apply(this, args);
    };
  };
}
