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
        await currentScope.cancel(); // Ensure cancellation happens before proceeding
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
          do {
            effectiveDelay = ms - (Date.now() - lastCallTime);
            if (effectiveDelay > 0) {
              await sleep(Math.min(effectiveDelay, ms)); // Sleep for the remaining time or handle longer sleeps in chunks
            }
          } while (effectiveDelay > 0);

          // Once the sleep completes, clear the current scope
          currentScope = null;
          cancelling = false; // Reset the cancelling flag

          // Execute the original method with the latest arguments
          return await originalMethod.apply(this, lastArgs);
        });
      } catch (e) {
        // Suppress cancellation error only if it's a Temporal cancellation
        if (isCancellation(e)) {
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
