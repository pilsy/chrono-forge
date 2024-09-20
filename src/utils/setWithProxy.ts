export function setWithProxy(target: any, path: string, value: any) {
  const keys = path.split('.');
  let obj = target;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in obj)) {
      obj[key] = {};
    }
    obj = obj[key];
  }
  const lastKey = keys[keys.length - 1];
  obj[lastKey] = value;
}
