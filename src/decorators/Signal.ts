import 'reflect-metadata';
import { SIGNAL_METADATA_KEY } from './metadata';

/**
 * Decorator that defines a method as a signal handler within a workflow.
 * Signals are asynchronous messages that can be sent to a running workflow to trigger
 * specific actions or update its state.
 *
 * ## Parameters
 * @param {string} [name] - Optional custom name for the signal. If not provided,
 *   the method name will be used as the signal name.
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
 * ## Notes
 * - Signal handlers should be idempotent when possible
 * - Avoid long-running operations in signal handlers
 * - Validate all inputs to prevent data corruption
 * - Signal handlers are automatically registered with Temporal
 *
 * @example
 * ```typescript
 * @ChronoFlow()
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
export const Signal = (name?: string) => {
  return (target: any, propertyKey: string) => {
    const signals = Reflect.getOwnMetadata(SIGNAL_METADATA_KEY, target) || [];
    signals.push([name ?? propertyKey, propertyKey]);
    Reflect.defineMetadata(SIGNAL_METADATA_KEY, signals, target);
  };
};
