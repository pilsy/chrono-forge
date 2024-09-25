export function Audit(): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor): void => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      console.log(`Audit: Calling ${String(propertyKey)} with args:`, args);
      const result = await originalMethod.apply(this, args);
      console.log(`Audit: ${String(propertyKey)} returned:`, result);
      return result;
    };
  };
}
