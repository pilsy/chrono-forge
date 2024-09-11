export const Query = (name?: string) => {
  return (target: any, propertyKey: string) => {
    if (!target.constructor._queries) {
      target.constructor._queries = [];
    }
    target.constructor._queries.push([name || propertyKey, propertyKey]);
  };
};
