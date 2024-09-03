### **Detailed Feature Usage in `Workflow` Class**

#### **Introduction to Feature Usage in the `Workflow` Class**

The `Workflow` class in ChronoForge is the foundational component for defining Temporal workflows. It provides several powerful features, including signal handling, query handling, execution control, error management, and lifecycle management hooks. Each of these features is designed to simplify the development of robust, maintainable workflows that can handle complex business logic and real-time interactions.

This section provides an in-depth discussion of how to use each feature provided by the `Workflow` class, with detailed examples and best practices to ensure developers can effectively implement these features in their workflows.

#### **Table of Contents**

1. [Signal Handling](#1-signal-handling)
2. [Query Handling](#2-query-handling)
3. [Execution Control and Flow Management](#3-execution-control-and-flow-management)
4. [Error Handling with `@OnError`](#4-error-handling-with-onerror)
5. [Lifecycle Management Hooks](#5-lifecycle-management-hooks)

---

### **1. Signal Handling**

Signals are a core feature of Temporal workflows, allowing asynchronous communication with a running workflow to trigger specific actions or update its state. The `@Signal` decorator provided by the `Workflow` class is used to define signal handlers that respond to these asynchronous messages.

#### **How to Use Signals**

To define a signal handler in a workflow, use the `@Signal` decorator to mark a method that will handle the signal.

**Example: Defining and Using Signals**

```typescript
import { Workflow, Signal } from 'chrono-forge';

@ChronoFlow()
export class ExampleWorkflow extends Workflow {
  private status: string = 'initialized';

  @Signal()
  async updateStatus(newStatus: string): Promise<void> {
    this.status = newStatus;
    console.log(`Workflow status updated to: ${this.status}`);
  }

  async execute(params: any): Promise<void> {
    console.log('Workflow executing with initial status:', this.status);
    // Main workflow logic here
  }
}
```

- **Explanation**: The `updateStatus` method is marked with the `@Signal` decorator, making it a signal handler. When a signal named `updateStatus` is sent to this workflow, the method is invoked, and the workflow's state is updated accordingly.

#### **Best Practices for Signal Handling**

- Ensure signal handlers are idempotent.
- Avoid long-running operations directly in signal handlers.
- Validate all inputs received in signals to prevent data corruption or security issues.

For more details, refer to the [Signal Handling Documentation](./signal_handling.md).

---

### **2. Query Handling**

Queries provide a way to retrieve the current state or computed values from a running workflow. Unlike signals, which are asynchronous and can modify workflow state, queries are synchronous and read-only. The `@Query` decorator is used to define methods as query handlers.

#### **How to Use Queries**

To define a query handler, use the `@Query` decorator on a method that returns the required data.

**Example: Defining and Using Queries**

```typescript
import { Workflow, Query } from 'chrono-forge';

@ChronoFlow()
export class ExampleWorkflow extends Workflow {
  private status: string = 'initialized';

  @Query()
  getStatus(): string {
    return this.status;
  }

  async execute(params: any): Promise<void> {
    console.log('Workflow executing with initial status:', this.status);
    // Main workflow logic here
  }
}
```

- **Explanation**: The `getStatus` method is decorated with `@Query`, making it a query handler. When a query named `getStatus` is called on this workflow, the method returns the current status.

#### **Best Practices for Query Handling**

- Keep query handlers lightweight to avoid blocking the workflow.
- Ensure query handlers are idempotent and do not modify the workflow state.
- Return simple, serializable data for efficient communication.

For more details, refer to the [Query Handling Documentation](./query_handling.md).

---

### **3. Execution Control and Flow Management**

The `Workflow` class provides several key methods and strategies for managing the execution lifecycle of workflows, including starting, pausing, resuming, and terminating workflows. The `execute` method is the primary entry point where the core workflow logic is defined.

#### **How to Control Workflow Execution**

To manage workflow execution flow, you can use signal handlers to control the workflow state or methods like `continueAsNew` to manage long-running workflows.

**Example: Pausing and Resuming a Workflow**

```typescript
import { Workflow, Signal } from 'chrono-forge';

@ChronoFlow()
export class PausableWorkflow extends Workflow {
  private paused: boolean = false;

  @Signal()
  async pause(): Promise<void> {
    this.paused = true;
    console.log('Workflow is paused.');
  }

  @Signal()
  async resume(): Promise<void> {
    this.paused = false;
    console.log('Workflow is resumed.');
  }

  async execute(params: any): Promise<void> {
    while (this.paused) {
      await this.sleep(1000); // Wait until resumed
    }
    console.log('Workflow is executing after being resumed.');
  }
}
```

- **Explanation**: This workflow can be paused and resumed using signals. The `execute` method contains logic to check the `paused` state and waits if the workflow is paused.

#### **Best Practices for Execution Control**

- Use `continueAsNew` for long-running workflows to manage memory usage.
- Ensure proper cleanup and error handling when terminating workflows.
- Design workflows to handle external events gracefully, such as pausing and resuming.

For more details, refer to the [Execution Control Documentation](./execution_control.md).

---

### **4. Error Handling with `@OnError`**

Error handling is crucial for building resilient workflows that can recover from failures and provide meaningful insights into issues. The `@OnError` decorator allows developers to define custom error handlers for specific methods.

#### **How to Handle Errors in Workflows**

To define an error handler, use the `@OnError` decorator on a method that handles errors for another method.

**Example: Defining a Custom Error Handler**

```typescript
import { Workflow, OnError } from 'chrono-forge';

@ChronoFlow()
export class ErrorHandlingWorkflow extends Workflow {

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

- **Explanation**: The `handleError` method is registered as an error handler for the `execute` method using the `@OnError` decorator. When an error occurs in `execute`, `handleError` is invoked to manage the error.

#### **Best Practices for Error Handling**

- Use specific error handlers for critical methods to provide targeted error management.
- Implement retry logic with exponential backoff for handling transient errors.
- Log errors with sufficient context to aid in debugging and monitoring.

For more details, refer to the [Error Handling Documentation](./error_handling.md).

---

### **5. Lifecycle Management Hooks**

Lifecycle hooks allow developers to inject custom logic before or after specific methods are executed in a workflow. The `@Hook` decorator (speculative) enables pre- and post-execution logic, making workflows more flexible and manageable.

#### **How to Use Lifecycle Hooks**

To define lifecycle hooks, use the `@Hook` decorator with `before` or `after` options to specify the method to intercept.

**Example: Defining Lifecycle Hooks**

```typescript
import { Workflow, Hook } from 'chrono-forge';

@ChronoFlow()
export class ExampleWorkflow extends Workflow {

  @Hook({ before: 'execute' })
  protected async logBeforeExecution(): Promise<void> {
    console.log('Before executing main workflow logic...');
  }

  @Hook({ after: 'execute' })
  protected async logAfterExecution(): Promise<void> {
    console.log('After executing main workflow logic.');
  }

  async execute(params: any): Promise<void> {
    console.log('Executing main workflow logic...');
    // Main workflow logic here
  }
}
```

- **Explanation**: The `logBeforeExecution` and `logAfterExecution` methods are registered as hooks that run before and after the `execute` method, respectively.

#### **Best Practices for Lifecycle Hooks**

- Keep hooks lightweight to avoid delaying the main method's execution.
- Use hooks for cross-cutting concerns like logging, monitoring, or validation.
- Ensure that hooks are idempotent and do not introduce side effects.

For more details, refer to the [Lifecycle Management Hooks Documentation](./lifecycle_hooks.md).

---

### **Conclusion**

The `Workflow` class in ChronoForge offers a range of powerful features that enable developers to build flexible, interactive, and resilient workflows in Temporal. By leveraging signals, queries, error handling, execution control, and lifecycle hooks, developers can create workflows that handle complex business processes with ease. This documentation provides an in-depth guide to using these features effectively, ensuring that workflows are robust, maintainable, and capable of adapting to real-world challenges.

For a complete overview of these features and advanced usage patterns, refer to the [Complete Usage Example](./complete_example.md) section.