export function Conditional(condition: (...args: any[]) => boolean | Promise<boolean>): MethodDecorator {
  return (target: Object, propertyKey: string | symbol, descriptor: PropertyDescriptor): void => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      try {
        const shouldExecute = await condition.apply(this, args);
        if (shouldExecute) {
          return await originalMethod.apply(this, args);
        } else {
          console.log(`Conditional: Skipping ${String(propertyKey)} as condition not met.`);
        }
      } catch (error) {
        console.error(`Error executing condition for ${String(propertyKey)}:`, error);
      }
    };
  };
}
