# Overview of the Workflow Class

## Introduction

The `Workflow` class is the cornerstone of the ChronoForge framework, providing a robust foundation for building Temporal workflows in TypeScript. It abstracts away much of the complexity involved in working directly with Temporal's low-level APIs, offering a more intuitive and developer-friendly interface for defining workflows.

By extending the `Workflow` class, developers can create stateful, resilient, and maintainable workflows that leverage Temporal's powerful orchestration capabilities while writing clean, declarative TypeScript code.

## Core Concepts

### What is a Workflow?

In Temporal, a workflow is a durable function execution that can span multiple services and maintain state across failures. Workflows in Temporal are designed to be:

- **Resilient**: They can recover from failures and continue execution from where they left off.
- **Scalable**: They can handle large volumes of concurrent executions.
- **Observable**: They provide visibility into their execution state and history.
- **Maintainable**: They can be versioned and updated without disrupting running instances.

The `Workflow` class in ChronoForge encapsulates these principles and provides a structured way to define workflows that adhere to Temporal's best practices.

### The Role of the `Workflow` Class

The `Workflow` class serves as an abstract base class that all workflow implementations in ChronoForge should extend. It provides:

1. **Core Infrastructure**: Essential methods and properties for interacting with Temporal's workflow engine.
2. **Decorator Support**: Integration with ChronoForge's decorator system for defining signals, queries, and hooks.
3. **State Management**: Utilities for managing workflow state and handling state transitions.
4. **Error Handling**: Robust error handling mechanisms to ensure workflow resilience.
5. **Lifecycle Management**: Methods for controlling workflow execution flow (pause, resume, cancel).
6. **Child Workflow Management**: Tools for creating and managing child workflows.
7. **Logging and Tracing**: Structured logging and OpenTelemetry integration for observability.

## Key Features

### Event-Based Architecture

The `Workflow` class extends `EventEmitter`, providing an event-based architecture for workflow execution. This allows for:

- **Decoupled Components**: Different parts of the workflow can communicate without tight coupling.
- **Lifecycle Hooks**: Events can be emitted at key points in the workflow lifecycle.
- **Custom Events**: Developers can define and listen for custom events specific to their workflow logic.

### Declarative API with Decorators

ChronoForge leverages TypeScript decorators to provide a declarative API for defining workflow behavior:

- **`@Temporal`**: Marks a class as a Temporal workflow.
- **`@Signal`**: Defines methods that handle external signals.
- **`@Query`**: Defines methods that respond to queries without changing workflow state.
- **`@Hook`**: Defines methods that run before or after other methods.
- **`@Property`**: Creates properties with automatic query and signal handlers.
- **`@Step`**: Defines methods as workflow steps with dependencies and conditions.

### Structured Execution Flow

The `Workflow` class provides a structured execution flow through:

- **Step-Based Execution**: Define workflow steps with dependencies and conditions.
- **Dependency Resolution**: Automatically determine the correct execution order based on step dependencies.
- **Conditional Execution**: Execute steps only when specific conditions are met.
- **Error Recovery**: Handle errors at the step level with retry logic and custom error handlers.

### Comprehensive State Management

State management in the `Workflow` class includes:

- **Property Decorators**: Easily expose workflow state as queryable properties.
- **Signal Handlers**: Update workflow state in response to external signals.
- **Memoization**: Store and retrieve workflow state efficiently.
- **ContinueAsNew Support**: Handle long-running workflows by continuing as new when needed.

## Basic Usage

Here's a simple example of how to create a workflow using the `Workflow` class:

```typescript
import { Workflow, Temporal, Signal, Query, Property } from 'chrono-forge';

interface OrderProcessingParams {
  orderId: string;
  customerId: string;
}

@Temporal({ name: 'OrderProcessingWorkflow' })
class OrderProcessingWorkflow extends Workflow<OrderProcessingParams, {}> {
  @Property()
  private orderStatus: string = 'pending';

  @Signal()
  async updateStatus(newStatus: string): Promise<void> {
    this.orderStatus = newStatus;
    this.log.info(`Order status updated to: ${newStatus}`);
  }

  @Query()
  getOrderStatus(): string {
    return this.orderStatus;
  }

  protected async execute(): Promise<any> {
    this.log.info(`Starting order processing for order ${this.args.orderId}`);
    
    // Workflow logic here
    this.orderStatus = 'processing';
    
    // Simulate some processing time
    await workflow.sleep('5s');
    
    this.orderStatus = 'completed';
    this.log.info(`Order processing completed for order ${this.args.orderId}`);
    
    return { orderId: this.args.orderId, status: this.orderStatus };
  }
}
```

## Advanced Features

The `Workflow` class includes several advanced features for building complex workflows:

### Step-Based Execution

For more complex workflows, you can use the `@Step` decorator to define steps with dependencies:

```typescript
import { Workflow, Temporal, Step } from 'chrono-forge';

@Temporal({ name: 'StepBasedWorkflow' })
class StepBasedWorkflow extends Workflow {
  private data: any = {};

  @Step()
  async step1(): Promise<void> {
    this.data.step1 = 'completed';
  }

  @Step({ after: 'step1' })
  async step2(): Promise<void> {
    this.data.step2 = 'completed';
  }

  @Step({ 
    after: 'step2',
    on: function() { return this.data.step2 === 'completed'; }
  })
  async step3(): Promise<void> {
    this.data.step3 = 'completed';
  }

  protected async execute(): Promise<any> {
    await this.executeSteps();
    return this.data;
  }
}
```

### Child Workflow Management

The `Workflow` class provides tools for managing child workflows:

```typescript
import { Workflow, Temporal } from 'chrono-forge';
import { workflow } from '@temporalio/workflow';

@Temporal({ name: 'ParentWorkflow' })
class ParentWorkflow extends Workflow {
  protected async execute(): Promise<any> {
    // Start a child workflow
    const childHandle = await workflow.startChild('ChildWorkflow', {
      args: [{ data: 'some data' }],
      taskQueue: 'my-task-queue',
      workflowId: 'child-workflow-' + workflow.uuid4()
    });
    
    // Store the handle for later use
    this.handles.set('child1', childHandle);
    
    // Wait for the child workflow to complete
    const result = await childHandle.result();
    
    return result;
  }
}
```

### Error Handling

The `Workflow` class includes robust error handling mechanisms:

```typescript
import { Workflow, Temporal, Step } from 'chrono-forge';

@Temporal({ name: 'ErrorHandlingWorkflow' })
class ErrorHandlingWorkflow extends Workflow {
  @Step({
    retries: 3,
    onError: (error) => {
      console.error('Step failed:', error);
      return { error: error.message };
    }
  })
  async riskyStep(): Promise<void> {
    // This step might fail, but will be retried up to 3 times
    // If it still fails, the onError handler will be called
  }

  protected async execute(): Promise<any> {
    try {
      await this.executeSteps();
      return { success: true };
    } catch (error) {
      this.log.error('Workflow failed:', error);
      return { success: false, error: error.message };
    }
  }
}
```

## Conclusion

The `Workflow` class in ChronoForge provides a powerful and flexible foundation for building Temporal workflows in TypeScript. By abstracting away much of the complexity of working directly with Temporal's APIs, it allows developers to focus on their business logic while still leveraging the full power of Temporal's orchestration capabilities.

Whether you're building simple workflows or complex, multi-step processes with dependencies and error handling, the `Workflow` class provides the tools and structure you need to create robust, maintainable, and scalable workflow applications.

For more detailed information on specific features and usage patterns, refer to the other sections of this documentation.
