# ChronoForge Decorators Reference

## Overview

ChronoForge provides a rich set of decorators that enable declarative workflow development. These decorators simplify common patterns, improve code readability, and enhance the development experience when building Temporal workflows. This document serves as a central reference for all decorators available in the framework.

## Core Workflow Decorators

| Decorator | Purpose | Documentation |
|-----------|---------|---------------|
| **`@Temporal`** | Marks a class as a Temporal workflow, configuring workflow name and task queue | [Temporal Decorator](./temporal_decorator.md) |
| **`@Signal`** | Defines a method as a signal handler | [Signal Decorator](./signal_decorator.md) |
| **`@Query`** | Defines a method as a query handler | [Query Decorator](./query_decorator.md) |
| **`@Property`** | Creates a property with associated query and signal handlers | [Property Usage](./signal_usage.md#property-decorator) |

## Execution Flow Decorators

| Decorator | Purpose | Documentation |
|-----------|---------|---------------|
| **`@Step`** | Defines a method as a workflow step with dependencies and conditions | [Step Decorator](../Step.md) |
| **`@Hook`** | Defines hooks that execute before or after specific methods | [Hook Decorator](./hook_decorator.md) |
| **`@Before`** | Shorthand for defining a hook that runs before a method | [Hook Usage](./hook_usage.md#before-shorthand) |
| **`@After`** | Shorthand for defining a hook that runs after a method | [Hook Usage](./hook_usage.md#after-shorthand) |

## State and Action Decorators

| Decorator | Purpose | Documentation |
|-----------|---------|---------------|
| **`@Action`** | Defines a typed, executable action within a workflow | [Action Decorator](./action_decorator.md) |
| **`@Validator`** | Validates inputs for actions before execution | [Action Decorator](./action_decorator.md#validating-actions-with-validator) |
| **`@On`** | Registers a method as an event handler for specific events | [On Decorator](./on_decorator.md) |

## Concurrency Control Decorators

| Decorator | Purpose | Documentation |
|-----------|---------|---------------|
| **`@Mutex`** | Ensures exclusive execution of a method using a mutex lock | [Mutex Decorator](./mutex_decorator.md) |
| **`@Debounce`** | Limits how often a method can be called, executing only the last call | [Debounce Decorator](./debounce_decorator.md) |
| **`@Guard`** | Protects method execution with conditional checks | [Guard Decorator](./guard_decorator.md) |

## Error Handling Decorators

| Decorator | Purpose | Documentation |
|-----------|---------|---------------|
| **`@OnError`** | Defines error handlers for specific methods or the entire workflow | [Error Handling](./error_handling.md) |

## Usage Examples

### Basic Workflow with Core Decorators

```typescript
import { Workflow, Temporal, Signal, Query } from 'chrono-forge';

@Temporal({ name: 'OrderWorkflow', taskQueue: 'order-queue' })
class OrderWorkflow extends Workflow {
  private order: any;
  
  @Signal('updateOrder')
  public onUpdateOrder(orderData: any): void {
    this.order = { ...this.order, ...orderData };
  }
  
  @Query('getOrderStatus')
  public getOrderStatus(): string {
    return this.order?.status || 'unknown';
  }
  
  async execute(orderId: string): Promise<void> {
    // Workflow implementation
  }
}
```

### Advanced Workflow with Multiple Decorators

```typescript
@Temporal({ name: 'ProcessingWorkflow' })
class ProcessingWorkflow extends Workflow {
  @Step({ name: 'fetchData' })
  protected async fetchData(): Promise<any> {
    // Step implementation
  }
  
  @Step({ after: 'fetchData' })
  @Guard(function(data: any) {
    return data && data.isValid;
  })
  protected async processData(data: any): Promise<void> {
    // Protected step implementation
  }
  
  @Mutex('stateUpdate')
  protected async updateState(newState: any): Promise<void> {
    // Thread-safe state update
  }
  
  @On('dataProcessed')
  protected async handleProcessedData(result: any): Promise<void> {
    // Event handler implementation
  }
  
  @OnError()
  protected handleError(error: Error): void {
    // Error handling logic
  }
}
```

## Best Practices

1. **Decorator Order**: When applying multiple decorators to a method, consider their execution order. Generally, put decorators that modify method behavior (like Guards) before decorators that register the method for a purpose (like Signal).

2. **Type Safety**: Use generic type parameters where available (like with `@Action<TInput, TOutput>`) to leverage TypeScript's type system.

3. **Clear Naming**: Use clear, descriptive names for decorated methods that indicate their purpose.

4. **Single Responsibility**: Each decorated method should have a single, clear responsibility.

5. **Documentation**: Document the purpose and behavior of decorated methods, especially when using complex combinations of decorators.

## Additional Resources

- [Workflow Class Documentation](../Workflow.md)
- [StatefulWorkflow Documentation](../StatefulWorkflow.md)
- [Complete Usage Examples](./complete_example.md)
