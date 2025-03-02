import { StateManager } from './StateManager';
import { EntityProxyManager } from './EntityProxyManager';

/**
 * EntityDataProxyWrapper provides backward compatibility with the original EntityDataProxy API
 * while using the new proxy-state-tree based implementation.
 */
export class EntityDataProxy {
  // Static cache of proxies to avoid recreating them
  private static readonly proxyCache = new Map<string, EntityDataProxy>();

  // The raw entity data
  private readonly data: any;

  // The StateManager instance that owns this proxy
  private readonly stateManager: StateManager;

  /**
   * Creates a new EntityDataProxy or returns a cached instance
   * @param entityName The entity type name
   * @param entityId The entity ID
   * @param data The entity data
   * @param stateManager The StateManager instance
   * @returns An EntityDataProxy instance
   */
  public static create(entityName: string, entityId: string, data: any, stateManager: StateManager): any {
    const cacheKey = `${entityName}::${entityId}`;

    // Return cached proxy if it exists and the state hasn't changed
    if (this.proxyCache.has(cacheKey)) {
      const cachedProxy = this.proxyCache.get(cacheKey)!;
      if (cachedProxy.data === data) {
        return cachedProxy.proxy;
      }
      this.proxyCache.delete(cacheKey);
    }

    // Create new proxy using EntityProxyManager
    const instance = new EntityDataProxy(entityName, entityId, data, stateManager);
    this.proxyCache.set(cacheKey, instance);
    return instance.proxy;
  }

  /**
   * Clear the proxy cache
   */
  public static clearCache(): void {
    this.proxyCache.clear();
    EntityProxyManager.clearCache();
  }

  /**
   * Remove a specific proxy from the cache
   * @param entityName The entity type name
   * @param entityId The entity ID
   */
  public static removeFromCache(entityName: string, entityId: string): void {
    const cacheKey = `${entityName}::${entityId}`;
    if (this.proxyCache.has(cacheKey)) {
      this.proxyCache.delete(cacheKey);
    }
    EntityProxyManager.removeFromCache(entityName, entityId);
  }

  /**
   * The JavaScript Proxy object that wraps the entity data
   */
  public readonly proxy: any;

  private constructor(
    private readonly entityName: string,
    private readonly entityId: string,
    data: any,
    stateManager: StateManager
  ) {
    this.data = data;
    this.stateManager = stateManager;

    // Initialize EntityProxyManager if needed
    if (!EntityProxyManager['proxyStateTree']) {
      EntityProxyManager.initialize();
    }

    // Get the proxy from EntityProxyManager
    this.proxy = EntityProxyManager.createEntityProxy(entityName, entityId, data, stateManager);
  }
}
