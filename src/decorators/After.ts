import { Hook } from './Hook';

/**
 * Decorator that defines a method as a lifecycle hook to be executed after a specific method.
 * This is a convenience decorator that provides a simpler syntax for `@Hook({ after: targetMethod })`.
 *
 * ## Parameters
 * @param {string} targetMethod - Name of the method this hook should execute after
 *
 * ## Features
 * - **Simplified Syntax**: Provides a cleaner way to define post-execution hooks
 * - **Method Interception**: Injects custom logic after specific workflow methods
 * - **Multiple Hook Support**: Multiple hooks can be registered for the same target method
 *
 * ## Usage Examples
 *
 * ### Basic Post-Execution Hook
 * ```typescript
 * @After('execute')
 * protected async notifyCompletion(): Promise<void> {
 *   await this.sendNotification('Workflow execution completed');
 * }
 * ```
 *
 * ## Notes
 * - Equivalent to `@Hook({ after: targetMethod })`
 * - Keep hooks lightweight to avoid impacting performance
 * - Multiple hooks for the same target execute in order of definition
 */
export const After = (targetMethod: string) => Hook({ after: targetMethod });
