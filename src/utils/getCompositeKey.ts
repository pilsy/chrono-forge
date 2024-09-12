import dottie from 'dottie';

export function getCompositeKey(entity: Record<string, any>, idAttributes: string[]): string {
  return idAttributes.map((attr) => dottie.get(entity, attr)).join('-');
}
