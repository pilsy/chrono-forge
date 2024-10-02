import { sleep, CancellationScope, isCancellation } from '@temporalio/workflow';

export function Debounce(ms: number): MethodDecorator {
  let lastCallTime: number = 0;
  let lastArgs: any[] | null = null;
  let currentScope: CancellationScope | null = null;
  let cancelling = false;

  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor): void => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const currentTime = Date.now();

      // If there's an existing scope, cancel it
      if (currentScope !== null) {
        cancelling = true;
        currentScope.cancel();
      }

      // Update the last call time and arguments
      lastCallTime = currentTime;
      lastArgs = args;

      try {
        // Create a new cancellable scope for debouncing logic
        await CancellationScope.cancellable(async () => {
          currentScope = CancellationScope.current();

          // Recalculate the effective delay in a loop to accommodate multiple rapid calls
          let effectiveDelay;
          while ((effectiveDelay = ms - (Date.now() - lastCallTime)) > 0) {
            await sleep(Math.min(effectiveDelay, ms)); // Sleep for the remaining time or handle longer sleeps in chunks.
          }

          // Once the sleep completes, clear the current scope
          currentScope = null;

          // Execute the original method with the latest arguments
          return await originalMethod.apply(this, lastArgs);
        });
      } catch (e) {
        // Suppress cancellation error only if it's a Temporal cancellation
        if (isCancellation(e)) {
          // Handle workflow-specific cancellation logic here if needed
          // Reset cancelling flag
          if (currentScope && currentScope.consideredCancelled) {
            cancelling = false;
          }
        } else {
          // Re-throw the error if it's not a cancellation
          throw e;
        }
      }
    };
  };
}
