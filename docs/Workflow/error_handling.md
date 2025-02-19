### **Error Handling with `@OnError` in `Workflow` Class**

#### **Introduction to Error Handling in Workflows**

Error handling is a critical aspect of building robust and reliable workflows in Temporal. Workflows often involve complex logic and interactions with external systems, making them susceptible to errors and exceptions. Proper error handling ensures that workflows can recover from failures gracefully, retry operations when necessary, and provide meaningful information for debugging and monitoring.

The `Workflow` class in ChronoForge provides a structured error handling strategy using the `@OnError` decorator, allowing developers to define custom error handlers for specific methods or the entire workflow. This approach provides fine-grained control over error management and ensures that workflows remain resilient and maintainable.

#### **Error Handling Strategy in the `Workflow` Class**

The `Workflow` class adopts a comprehensive error handling strategy that includes:

1. **Centralized Error Management**:
   - All errors thrown during workflow execution can be caught and managed centrally. This allows for consistent error logging, monitoring, and handling throughout the workflow's lifecycle.

2. **Custom Error Handlers with `@OnError`**:
   - Developers can define custom error handlers for specific methods using the `@OnError` decorator. This allows workflows to handle errors differently depending on the context in which they occur.

3. **Support for Retrying Operations**:
   - Error handlers can include logic to retry failed operations, either immediately or after a delay. This is useful for handling transient errors or failures due to external dependencies.

#### **Using the `@OnError` Decorator for Custom Error Handling**

The `@OnError` decorator is used to define a method as an error handler for a specific workflow method. When an error occurs in the specified method, the decorated error handler method is invoked to handle the error.

- **Purpose**: The `@OnError` decorator allows developers to specify custom error handling logic for specific workflow methods, providing a way to manage errors based on the context.
- **Usage**: Place the `@OnError` decorator above a method definition within a class that extends `Workflow` or its derivatives like `StatefulWorkflow`.

#### **Syntax and Usage**

To define a custom error handler in a workflow, use the `@OnError` decorator as follows:

```typescript
import { Workflow, OnError } from 'temporal-forge';

@Temporal()
export class ExampleWorkflow extends Workflow {

  @OnError('execute')
  protected async handleError(err: Error): Promise<void> {
    console.error('Error during execution:', err.message);
    // Additional error handling logic, such as retries or cleanup
  }

  async execute(params: any): Promise<void> {
    // Main workflow logic
    throw new Error('Simulated error in workflow execution'); // Example error
  }
}
```

- **Explanation**:
  - The `@OnError('execute')` decorator is applied to the `handleError` method, indicating that it will handle errors thrown during the `execute` method.
  - When an error is thrown in the `execute` method, the `handleError` method is invoked to handle it.

#### **Common Error Handling Patterns and Use Cases**

1. **Handling Errors in Workflow Execution**:
   - Errors occurring in the `execute` method or any core workflow logic can be handled by defining an error handler that logs the error, retries the operation, or performs cleanup tasks.
   - Example:

     ```typescript
     @OnError('execute')
     protected async handleError(err: Error): Promise<void> {
       console.error('Execution error:', err);
       // Retry logic or cleanup can be added here
     }
     ```

2. **Defining Global Error Handlers**:
   - Global error handlers can be defined to catch any unhandled errors in the workflow. This is useful for capturing and logging unexpected errors.
   - Example:

     ```typescript
     @OnError('*')
     protected async handleGlobalError(err: Error): Promise<void> {
       console.error('Global error handler caught an error:', err);
     }
     ```

   - **Explanation**:
     - The `@OnError('*')` decorator specifies a global error handler that catches all errors in the workflow.

3. **Retrying Failed Operations**:
   - Error handlers can be used to retry operations that have failed due to transient errors, such as network timeouts or temporary service outages.
   - Example:

     ```typescript
     @OnError('performTask')
     protected async retryTask(err: Error): Promise<void> {
       console.log('Error occurred in performTask, retrying...');
       await this.sleep(1000); // Wait before retrying
       await this.performTask(); // Retry the task
     }

     async performTask(): Promise<void> {
       // Task logic that may throw an error
     }
     ```

4. **Performing Cleanup on Errors**:
   - Error handlers can be used to perform cleanup tasks when an error occurs. This ensures that resources are released, and the system remains consistent.
   - Example:

     ```typescript
     @OnError('execute')
     protected async cleanupOnError(err: Error): Promise<void> {
       console.error('Error during execution, cleaning up resources.');
       // Cleanup logic here
     }
     ```

5. **Conditional Error Handling Based on Error Type**:
   - Error handlers can inspect the type of error and apply different handling logic based on the error type or context.
   - Example:

     ```typescript
     @OnError('fetchData')
     protected async handleFetchError(err: Error): Promise<void> {
       if (err.message.includes('Network')) {
         console.log('Network error detected, retrying fetch...');
         await this.sleep(5000);
         await this.fetchData();
       } else {
         console.error('Unhandled error:', err);
         throw err; // Re-throw if not handled
       }
     }
     ```

#### **Best Practices for Error Handling with `@OnError`**

1. **Use Specific Error Handlers for Critical Methods**:
   - Define specific error handlers for methods that perform critical tasks or interact with external systems. This allows for more targeted and effective error management.

2. **Implement Backoff Strategies for Retrying**:
   - When retrying failed operations, use exponential backoff or other backoff strategies to avoid overwhelming the system or external services.

3. **Log Errors with Contextual Information**:
   - Ensure that all error handlers log errors with sufficient contextual information, such as the method name, parameters, and error message. This helps with debugging and monitoring.

4. **Avoid Overusing Global Error Handlers**:
   - While global error handlers can catch all errors, they should not be overused. Specific error handlers provide more control and clarity over error management.

5. **Clean Up Resources on Errors**:
   - Always clean up resources, such as open connections, temporary files, or locks, when an error occurs. This helps prevent resource leaks and ensures the system remains stable.

#### **Conclusion**

The `@OnError` decorator in the `Workflow` class of ChronoForge provides a powerful and flexible way to handle errors in Temporal workflows. By allowing developers to define custom error handlers for specific methods or globally, it ensures that workflows can recover gracefully from failures, retry operations when necessary, and maintain a high level of reliability and maintainability.

For more detailed examples and best practices, refer to the [Complete Usage Example](./complete_example.md) section.
