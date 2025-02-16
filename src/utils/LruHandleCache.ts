export class LRUHandleCache<T> {
  private readonly cache = new Map<string, T>();
  private readonly maxSize: number;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  set(key: string, value: T): void {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey as string);
    }
    this.cache.delete(key);
    this.cache.set(key, value);
  }

  get(key: string): T | undefined {
    const value = this.cache.get(key);
    if (value) {
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  values(): IterableIterator<T> {
    return this.cache.values();
  }

  // Add additional useful methods
  keys(): IterableIterator<string> {
    return this.cache.keys();
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}
