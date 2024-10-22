import { CancellationScope } from '@temporalio/workflow';
import { Debounce } from '../../decorators/Debounce';

const sleep = async (duration = 1000) =>
  new Promise((resolve) => {
    setTimeout(async () => {
      resolve(true);
    }, duration);
  });

// jest.mock('@temporalio/workflow', () => ({
//   sleep: jest.fn().mockResolvedValue(undefined), // Mock sleep to be instantaneous
//   CancellationScope: {
//     cancellable: jest.fn(),
//     current: jest.fn().mockReturnValue({
//       cancel: jest.fn().mockResolvedValue(undefined)
//     })
//   }
// }));

describe('Debounce Decorator', () => {
  let mockMethod: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockMethod = jest.fn();
  });

  function createTestClass() {
    class TestClass {
      @Debounce(100) // Set debounce delay to 100ms for testing
      async testMethod(...args: any[]) {
        return mockMethod(...args);
      }
    }
    return new TestClass();
  }

  test('should execute the method after the debounce period with a single call', async () => {
    const testInstance = createTestClass();
    await testInstance.testMethod('first call');

    // expect(mockMethod).not.toHaveBeenCalled(); // Not called immediately
    await sleep(110); // Wait for debounce delay
    expect(mockMethod).toHaveBeenCalledWith('first call'); // Called after debounce period
  });

  test('should only execute the last method call when multiple calls are made within the debounce period', async () => {
    const testInstance = createTestClass();

    // Call the method rapidly
    testInstance.testMethod('first call');
    testInstance.testMethod('second call');
    testInstance.testMethod('third call');

    await sleep(100); // Wait for debounce delay

    // Only the last call should have been executed
    expect(mockMethod).toHaveBeenCalledTimes(1);
    expect(mockMethod).toHaveBeenCalledWith('third call');
  });

  test('should execute all method calls if they are spaced beyond the debounce period', async () => {
    const testInstance = createTestClass();

    // Call the method with enough time between each call
    testInstance.testMethod('first call');
    await sleep(150); // Wait longer than debounce period
    testInstance.testMethod('second call');
    await sleep(150);

    expect(mockMethod).toHaveBeenCalledTimes(2);
    expect(mockMethod).toHaveBeenCalledWith('first call');
    expect(mockMethod).toHaveBeenCalledWith('second call');
  });

  test('should cancel the previous call when a new call is made within the debounce period', async () => {
    const testInstance = createTestClass();

    testInstance.testMethod('first call');
    await sleep(50); // Call the method within debounce period
    testInstance.testMethod('second call');

    await sleep(100); // Wait for debounce period

    // The first call should have been cancelled, only the second call should execute
    expect(mockMethod).toHaveBeenCalledTimes(1);
    expect(mockMethod).toHaveBeenCalledWith('second call');
    expect(CancellationScope.current().cancel).toHaveBeenCalled(); // Cancellation should have been called
  });

  test('should handle asynchronous execution of original method and wait for its completion', async () => {
    const testInstance = createTestClass();

    // Mock the original method to take some time to finish
    mockMethod.mockResolvedValueOnce(sleep(100));

    await testInstance.testMethod('async call');

    // expect(mockMethod).not.toHaveBeenCalledImmediately(); // Not immediately called
    await sleep(100); // Wait for debounce
    expect(mockMethod).toHaveBeenCalled(); // Now it gets called

    // Ensure the method finishes before resetting debounce
    await sleep(100); // Wait for the async method to complete
    expect(CancellationScope.current().cancel).not.toHaveBeenCalled(); // Cancellation should not happen during method execution
  });

  test('should reset after method execution completes', async () => {
    const testInstance = createTestClass();

    // Mock an async method call
    mockMethod.mockResolvedValueOnce(sleep(100));

    await testInstance.testMethod('reset test');
    await sleep(200); // Wait for debounce and async execution to complete

    // Now make another call after everything is reset
    testInstance.testMethod('second call');
    await sleep(100); // Wait for debounce

    expect(mockMethod).toHaveBeenCalledTimes(2);
    expect(mockMethod).toHaveBeenCalledWith('second call');
  });

  test('should pass the latest arguments to the debounced method', async () => {
    const testInstance = createTestClass();

    // Call with different arguments
    testInstance.testMethod('first call', 1);
    testInstance.testMethod('second call', 2);
    testInstance.testMethod('third call', 3);

    await sleep(100); // Wait for debounce

    // Only the last call should be executed with the latest arguments
    expect(mockMethod).toHaveBeenCalledTimes(1);
    expect(mockMethod).toHaveBeenCalledWith('third call', 3);
  });

  test('should correctly handle cancellation errors', async () => {
    const testInstance = createTestClass();

    // Simulate a cancellation error in Temporal
    const cancellationError = new Error('cancellation error');
    cancellationError.name = 'CancellationError';
    // CancellationScope.current().cancel.mockRejectedValueOnce(cancellationError);

    testInstance.testMethod('cancellation test');
    await sleep(100); // Wait for debounce

    // Ensure no calls were executed due to cancellation
    expect(mockMethod).not.toHaveBeenCalled();
  });
});
