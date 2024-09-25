export function Conditional(condition: (...args: any[]) => boolean | Promise<boolean>): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor): void => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const shouldExecute = await condition.apply(this, args);
      if (shouldExecute) {
        return await originalMethod.apply(this, args);
      } else {
        console.log(`Conditional: Skipping ${String(propertyKey)} as condition not met.`);
      }
    };
  };
}
