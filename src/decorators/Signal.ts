import 'reflect-metadata';
import { SIGNAL_METADATA_KEY } from './metadata';

export interface SignalOptions {
  /**
   * Custom name for the signal. If not provided, the method name will be used.
   */
  name?: string;

  /**
   * Custom error handler for this specific signal.
   * @param error The error that occurred during signal execution
   * @returns A value to use as the signal result, or throws to propagate the error
   */
  onError?: (error: Error) => any;
}

/**
 * Decorator that defines a method as a signal handler within a workflow.
 * Signals are asynchronous messages that can be sent to a running workflow to trigger
 * specific actions or update its state.
 *
 * ## Parameters
 * @param {string | SignalOptions} [options] - Optional configuration for the signal.
 *   If a string is provided, it will be used as the signal name.
 *   If an object is provided, it can contain:
 *   - name: Custom name for the signal
 *   - onError: Custom error handler for the signal
 *
 * ## Features
 * - **Asynchronous Communication**: Enables real-time, asynchronous interaction with running workflows
 * - **State Modification**: Can modify workflow state and trigger workflow actions
 * - **Dynamic Behavior**: Allows workflows to react to external events or inputs
 *
 * ## Usage Examples
 *
 * ### Basic Signal Handler
 * ```typescript
 * @Signal()
 * async updateStatus(newStatus: string): Promise<void> {
 *   this.status = newStatus;
 * }
 * ```
 *
 * ### Custom Named Signal
 * ```typescript
 * @Signal('setWorkflowStatus')
 * async updateStatus(newStatus: string): Promise<void> {
 *   this.status = newStatus;
 * }
 * ```
 *
 * ### Signal with Options
 * ```typescript
 * @Signal({
 *   name: 'setWorkflowStatus',
 *   onError: (error) => {
 *     console.error('Signal failed:', error);
 *     return null;
 *   }
 * })
 * async updateStatus(newStatus: string): Promise<void> {
 *   this.status = newStatus;
 * }
 * ```
 *
 * ## Notes
 * - Signal handlers should be idempotent when possible
 * - Avoid long-running operations in signal handlers
 * - Validate all inputs to prevent data corruption
 * - Signal handlers are automatically registered with Temporal
 *
 * @example
 * ```typescript
 * @Temporal()
 * class OrderWorkflow extends Workflow {
 *   private status: string = 'pending';
 *
 *   @Signal()
 *   async cancelOrder(reason: string): Promise<void> {
 *     this.status = 'cancelled';
 *     this.cancellationReason = reason;
 *     await this.notifyCustomer();
 *   }
 * }
 * ```
 */
export const Signal = (options?: string | SignalOptions) => {
  return (target: any, propertyKey: string) => {
    const signals = Reflect.getOwnMetadata(SIGNAL_METADATA_KEY, target) ?? [];
    const signalName = typeof options === 'string' ? options : (options?.name ?? propertyKey);
    signals.push([signalName, propertyKey, options && typeof options === 'object' ? options : undefined]);
    Reflect.defineMetadata(SIGNAL_METADATA_KEY, signals, target);
  };
};
