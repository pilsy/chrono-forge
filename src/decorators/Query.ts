import 'reflect-metadata';
import { QUERY_METADATA_KEY } from './metadata';

/**
 * Decorator that defines a method as a query handler within a workflow.
 * Queries provide a synchronous way to retrieve the current state or computed values
 * from a running workflow without modifying its state.
 *
 * ## Parameters
 * @param {string} [name] - Optional custom name for the query. If not provided,
 *   the method name will be used as the query name.
 *
 * ## Features
 * - **Synchronous Reading**: Provides immediate access to workflow state or computed values
 * - **Read-Only Operations**: Cannot modify workflow state
 * - **Consistent Results**: Returns data consistent with workflow history
 * - **Real-Time Monitoring**: Enables workflow state inspection without interruption
 *
 * ## Usage Examples
 *
 * ### Basic Query Handler
 * ```typescript
 * @Query()
 * getStatus(): string {
 *   return this.status;
 * }
 * ```
 *
 * ### Custom Named Query
 * ```typescript
 * @Query('workflowStatus')
 * getStatus(): string {
 *   return this.status;
 * }
 * ```
 *
 * ## Notes
 * - Query handlers must be synchronous or return a Promise
 * - Queries cannot modify workflow state
 * - Keep query handlers lightweight to avoid blocking
 * - Return serializable data for efficient communication
 *
 * @example
 * ```typescript
 * @Temporal()
 * class OrderWorkflow extends Workflow {
 *   private orderDetails: OrderDetails;
 *
 *   @Query()
 *   getOrderStatus(): OrderStatus {
 *     return {
 *       status: this.orderDetails.status,
 *       lastUpdated: this.orderDetails.lastUpdated,
 *       currentStep: this.orderDetails.currentStep
 *     };
 *   }
 * }
 * ```
 */
export const Query = (name?: string) => {
  return (target: any, propertyKey: string) => {
    const queries = Reflect.getOwnMetadata(QUERY_METADATA_KEY, target) || [];
    queries.push([name ?? propertyKey, propertyKey]);
    Reflect.defineMetadata(QUERY_METADATA_KEY, queries, target);
  };
};
