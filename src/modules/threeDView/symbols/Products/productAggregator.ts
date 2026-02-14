export class ProductAggregator<T> {
  private readonly cache = new Map<string, T>();

  getOrCreate(cacheKey: string, factory: () => T): T {
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached;
    const next = factory();
    this.cache.set(cacheKey, next);
    return next;
  }

  get(cacheKey: string): T | undefined {
    return this.cache.get(cacheKey);
  }

  clear() {
    this.cache.clear();
  }

  delete(cacheKey: string) {
    this.cache.delete(cacheKey);
  }
}

export function createProductAggregator<T>() {
  return new ProductAggregator<T>();
}
