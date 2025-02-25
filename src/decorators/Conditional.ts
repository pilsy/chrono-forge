/**
 * Decorator that conditionally executes a method based on a supplied condition function.
 * Unlike the @Condition decorator which waits for a condition to be met, @Conditional
 * immediately skips the method execution if the condition is not met.
 *
 * ## Parameters
 * @param {() => boolean} conditionFn - Function that determines if the method should execute.
 *   Should return true to allow execution, false to skip.
 *
 * ## Features
 * - **Conditional Execution**: Skips method execution if condition is not met
 * - **Synchronous Evaluation**: Condition is checked immediately before method execution
 * - **No Waiting**: Unlike @Condition, does not wait for condition to become true
 * - **State-Aware**: Can access workflow state through the condition function
 *
 * ## Common Use Cases
 * 1. Skip processing based on workflow state
 * 2. Implement feature flags in workflows
 * 3. Control execution flow based on configuration
 * 4. Implement optional workflow steps
 *
 * ## Usage Examples
 * ```typescript
 * class WorkflowExample {
 *   private isEnabled = false;
 *
 *   // Method will only execute if isEnabled is true
 *   @Conditional(() => this.isEnabled)
 *   protected async processData(): Promise<void> {
 *     // This code is skipped if isEnabled is false
 *   }
 *
 *   // Complex condition combining multiple states
 *   @Conditional(() => this.isEnabled && this.hasData && !this.isProcessing)
 *   protected async complexOperation(): Promise<void> {
 *     // Only executes if all conditions are met
 *   }
 * }
 * ```
 *
 * ## Notes
 * - Condition function should be pure and deterministic
 * - Avoid side effects in the condition function
 * - Can be combined with other decorators like @Action or @Mutex
 * - Different from @Condition which waits for conditions to be met
 *
 * @see Condition
 * @see Action
 * @see Mutex
 */
export function Conditional(condition: (...args: any[]) => boolean | Promise<boolean>): MethodDecorator {
  return (target: Object, propertyKey: string | symbol, descriptor: PropertyDescriptor): void => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      try {
        const shouldExecute = await condition.apply(this, args);
        if (shouldExecute) {
          return await originalMethod.apply(this, args);
        } else {
          // @ts-ignore
          this.log.info(`Conditional: Skipping ${String(propertyKey)} as condition not met.`);
        }
      } catch (error) {
        console.error(`Error executing condition for ${String(propertyKey)}:`, error);
      }
    };
  };
}
