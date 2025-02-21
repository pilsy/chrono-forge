import { Mutex as MutexLock } from 'async-mutex';

const instanceMutexMap: Map<any, Map<string, MutexLock>> = new Map();

/**
 * Decorator that ensures exclusive execution of a method using a mutex lock.
 * This prevents concurrent execution of the decorated method within the same instance.
 *
 * ## Parameters
 * @param {string} [mutexName='execute'] - Name of the mutex lock. Methods sharing the same
 *   mutexName will be mutually exclusive. Defaults to 'execute'.
 *
 * ## Features
 * - **Thread Safety**: Ensures only one execution of the method at a time
 * - **Instance-Level Locking**: Mutex locks are scoped to class instances
 * - **Named Locks**: Support for multiple named mutexes within the same instance
 * - **Async Support**: Works with both async and sync methods
 *
 * ## Common Use Cases
 * 1. Protecting shared resource access
 * 2. Preventing race conditions in state updates
 * 3. Ensuring sequential execution of critical sections
 * 4. Coordinating workflow state changes
 *
 * ## Usage Examples
 * ```typescript
 * class WorkflowExample {
 *   @Mutex('stateUpdate')
 *   async updateState(): Promise<void> {
 *     // This code will run exclusively
 *   }
 *
 *   @Mutex() // Uses default 'execute' mutex name
 *   async execute(): Promise<void> {
 *     // This code will run exclusively
 *   }
 * }
 * ```
 *
 * ## Notes
 * - Different methods can share the same mutex by using the same mutexName
 * - The decorator automatically handles async/await operations
 * - Locks are released automatically after method completion or error
 *
 * @decorator
 * @see {@link MutexLock} from 'async-mutex'
 */
export function Mutex(mutexName: string = 'execute'): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor): void => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      let mutexMap = instanceMutexMap.get(this);

      if (!mutexMap) {
        mutexMap = new Map<string, MutexLock>();
        instanceMutexMap.set(this, mutexMap);
      }

      let mutex = mutexMap.get(mutexName);

      if (!mutex) {
        mutex = new MutexLock();
        mutexMap.set(mutexName, mutex);
      }

      return mutex.runExclusive(() => originalMethod.apply(this, args));
    };
  };
}
