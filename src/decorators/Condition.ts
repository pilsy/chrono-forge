import { condition, CancellationScope } from '@temporalio/workflow';
import type { Duration } from '@temporalio/common';

/**
 * Decorator that wraps a method to execute only after a specified condition is met.
 * The decorated method will wait until the condition function returns true or the optional timeout is reached.
 * The execution occurs within a cancellable scope, allowing for proper cleanup if cancelled.
 *
 * ## Parameters
 * @param {() => boolean} conditionFn - Function that returns a boolean indicating if the condition is met.
 *   This function will be polled until it returns true or the timeout is reached.
 * @param {Duration} [timeout] - Optional timeout duration after which the condition check will fail.
 *   Uses Temporal's Duration type. If not provided, will wait indefinitely.
 *
 * ## Features
 * - **Conditional Execution**: Method only executes after condition is satisfied
 * - **Timeout Support**: Optional timeout to prevent infinite waiting
 * - **Cancellation Support**: Executes in a cancellable scope for proper cleanup
 * - **Temporal Integration**: Uses Temporal's condition and CancellationScope
 *
 * ## Usage Examples
 * ```typescript
 * class WorkflowExample {
 *   private isReady = false;
 *
 *   // Wait indefinitely for condition
 *   @Condition(() => this.isReady)
 *   async processWhenReady(): Promise<void> {
 *     // This code will only run when isReady is true
 *   }
 *
 *   // Wait with timeout
 *   @Condition(() => this.isReady, '30 seconds')
 *   async processWithTimeout(): Promise<void> {
 *     // This code will run when isReady is true or after 30 seconds
 *   }
 * }
 * ```
 *
 * ## Error Handling
 * - If a timeout is specified and reached, the condition will throw an error
 * - If the workflow is cancelled, the cancellation will be propagated properly
 *
 * ## Notes
 * - The condition function should be deterministic and only depend on workflow state
 * - Avoid side effects in the condition function
 * - The timeout parameter uses Temporal's Duration type (e.g., '30 seconds', '1 minute')
 * - The decorated method must be async
 *
 * @decorator
 * @throws {Error} If the timeout is reached before the condition is met
 * @see {@link condition} from '@temporalio/workflow'
 * @see {@link CancellationScope} from '@temporalio/workflow'
 */
export const Condition = (conditionFn: () => boolean, timeout?: Duration) => {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      return await CancellationScope.cancellable(async () => {
        if (timeout) {
          await condition(conditionFn, timeout);
        } else {
          await condition(conditionFn);
        }
        return originalMethod.apply(this, args);
      });
    };
  };
};
