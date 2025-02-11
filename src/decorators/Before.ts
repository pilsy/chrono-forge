import { Hook } from './Hook';

/**
 * Decorator that defines a method as a lifecycle hook to be executed before a specific method.
 * This is a convenience decorator that provides a simpler syntax for `@Hook({ before: targetMethod })`.
 *
 * ## Parameters
 * @param {string} targetMethod - Name of the method this hook should execute before
 *
 * ## Features
 * - **Simplified Syntax**: Provides a cleaner way to define pre-execution hooks
 * - **Method Interception**: Injects custom logic before specific workflow methods
 * - **Multiple Hook Support**: Multiple hooks can be registered for the same target method
 *
 * ## Usage Examples
 *
 * ### Basic Pre-Execution Hook
 * ```typescript
 * @Before('execute')
 * protected async validateInputs(): Promise<void> {
 *   if (!this.isValid()) {
 *     throw new Error('Invalid workflow state');
 *   }
 * }
 * ```
 *
 * ## Notes
 * - Equivalent to `@Hook({ before: targetMethod })`
 * - Keep hooks lightweight to avoid impacting performance
 * - Multiple hooks for the same target execute in order of definition
 */
export const Before = (targetMethod: string) => Hook({ before: targetMethod });
