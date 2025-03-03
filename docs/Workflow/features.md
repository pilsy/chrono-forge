# Workflow Class Features

The `Workflow` class in ChronoForge provides a rich set of features designed to simplify the development of Temporal workflows. This document outlines the key features and capabilities that make the `Workflow` class a powerful tool for building robust, maintainable workflows.

## Signal Handling

Signals allow external processes to asynchronously interact with running workflows. The `Workflow` class provides a simple way to define signal handlers using the `@Signal` decorator.

### Defining Signal Handlers

```typescript
import { Workflow, Temporal, Signal } from 'chrono-forge';

@Temporal({ name: 'OrderWorkflow' })
class OrderWorkflow extends Workflow {
  private orderStatus: string = 'pending';
  
  @Signal()
  async updateOrderStatus(newStatus: string): Promise<void> {
    this.orderStatus = newStatus;
    this.log.info(`Order status updated to: ${newStatus}`);
  }
  
  @Signal({ name: 'cancelOrder' })
  async cancel(reason: string): Promise<void> {
    this.orderStatus = 'cancelled';
    this.log.info(`Order cancelled: ${reason}`);
  }
  
  protected async execute(): Promise<any> {
    // Workflow implementation
  }
}
```

### Signal Options

The `@Signal` decorator accepts an options object with the following properties:

- `name`: Custom name for the signal (defaults to the method name)
- `description`: Description of the signal for documentation purposes

### Sending Signals to Workflows

From a client or activity:

```typescript
// Get a handle to the workflow
const handle = client.workflow.getHandle('workflowId');

// Send a signal
await handle.signal.updateOrderStatus('processing');
```

## Query Handling

Queries allow external processes to synchronously retrieve data from running workflows without changing the workflow state. The `Workflow` class provides a simple way to define query handlers using the `@Query` decorator.

### Defining Query Handlers

```typescript
import { Workflow, Temporal, Query } from 'chrono-forge';

@Temporal({ name: 'OrderWorkflow' })
class OrderWorkflow extends Workflow {
  private orderStatus: string = 'pending';
  private items: string[] = [];
  
  @Query()
  getOrderStatus(): string {
    return this.orderStatus;
  }
  
  @Query({ name: 'getItems' })
  retrieveItems(): string[] {
    return [...this.items];
  }
  
  protected async execute(): Promise<any> {
    // Workflow implementation
  }
}
```

### Query Options

The `@Query` decorator accepts an options object with the following properties:

- `name`: Custom name for the query (defaults to the method name)
- `description`: Description of the query for documentation purposes

### Querying Workflows

From a client or activity:

```typescript
// Get a handle to the workflow
const handle = client.workflow.getHandle('workflowId');

// Query the workflow
const status = await handle.query.getOrderStatus();
```

## Property Management

The `@Property` decorator simplifies state management by automatically generating signal and query handlers for class properties.

### Using Property Decorators

```typescript
import { Workflow, Temporal, Property } from 'chrono-forge';

@Temporal({ name: 'UserWorkflow' })
class UserWorkflow extends Workflow {
  @Property()
  private username: string = '';
  
  @Property({ readonly: true })
  private createdAt: Date = new Date();
  
  @Property({
    onUpdate: function(newValue) {
      this.log.info(`Email updated to: ${newValue}`);
    }
  })
  private email: string = '';
  
  protected async execute(): Promise<any> {
    // Workflow implementation
  }
}
```

### Property Options

The `@Property` decorator accepts an options object with the following properties:

- `readonly`: If true, only generates a query handler (no signal handler)
- `name`: Custom name for the property (defaults to the property name)
- `onUpdate`: Function to call when the property is updated via a signal
- `validate`: Function to validate new values before updating the property

### Accessing Properties

From a client or activity:

```typescript
// Get a handle to the workflow
const handle = client.workflow.getHandle('workflowId');

// Update a property
await handle.signal.setEmail('user@example.com');

// Query a property
const username = await handle.query.getUsername();
```

## Execution Control and Flow Management

The `Workflow` class provides methods for controlling the workflow's execution flow.

### Starting Workflows

```typescript
import { Workflow, Temporal } from 'chrono-forge';

@Temporal({ name: 'ProcessingWorkflow' })
class ProcessingWorkflow extends Workflow<{ data: string }, void> {
  protected async execute(): Promise<void> {
    this.log.info(`Processing data: ${this.args.data}`);
    // Implementation
  }
}

// From a client:
const handle = await client.workflow.start(ProcessingWorkflow, {
  args: [{ data: 'example' }],
  taskQueue: 'processing-queue',
  workflowId: 'processing-1'
});
```

### Pausing and Resuming Workflows

The `Workflow` class provides built-in support for pausing and resuming workflow execution:

```typescript
import { Workflow, Temporal, Signal } from 'chrono-forge';

@Temporal({ name: 'LongRunningWorkflow' })
class LongRunningWorkflow extends Workflow {
  private paused: boolean = false;
  
  @Signal()
  async pause(): Promise<void> {
    this.paused = true;
  }
  
  @Signal()
  async resume(): Promise<void> {
    this.paused = false;
  }
  
  protected async execute(): Promise<any> {
    for (let i = 0; i < 100; i++) {
      // Check if paused before each step
      while (this.paused) {
        await this.sleep('1s');
      }
      
      // Perform work
      await this.doWork(i);
    }
  }
  
  private async doWork(step: number): Promise<void> {
    // Implementation
  }
}
```

### Cancelling Workflows

Workflows can be cancelled from external clients:

```typescript
// Get a handle to the workflow
const handle = client.workflow.getHandle('workflowId');

// Cancel the workflow
await handle.cancel();
```

## Error Handling with `@OnError`

The `Workflow` class provides robust error handling capabilities through the `@OnError` decorator.

### Defining Error Handlers

```typescript
import { Workflow, Temporal, OnError, Step } from 'chrono-forge';

@Temporal({ name: 'RobustWorkflow' })
class RobustWorkflow extends Workflow {
  @OnError()
  async handleError(error: Error): Promise<void> {
    this.log.error(`Workflow error: ${error.message}`);
    // Implement recovery logic
  }
  
  @OnError({ errorType: 'ValidationError' })
  async handleValidationError(error: ValidationError): Promise<void> {
    this.log.warn(`Validation error: ${error.message}`);
    // Handle validation errors specifically
  }
  
  @Step({
    onError: function(error) {
      this.log.warn(`Step error: ${error.message}`);
      return { retry: true };
    }
  })
  async riskyStep(): Promise<void> {
    // Implementation that might throw errors
  }
  
  protected async execute(): Promise<any> {
    try {
      // Workflow implementation
    } catch (error) {
      // Local error handling
    }
  }
}
```

### Error Handler Options

The `@OnError` decorator accepts an options object with the following properties:

- `errorType`: The type of error to handle (handles all errors if not specified)
- `priority`: Priority of the handler (higher priority handlers are called first)

## Lifecycle Management Hooks

The `Workflow` class provides hooks for injecting custom logic at different points in the workflow lifecycle.

### Using Lifecycle Hooks

```typescript
import { Workflow, Temporal, Hook } from 'chrono-forge';

@Temporal({ name: 'LifecycleWorkflow' })
class LifecycleWorkflow extends Workflow {
  @Hook({ type: 'before', target: 'execute' })
  async beforeExecute(): Promise<void> {
    this.log.info('Workflow execution starting');
    // Setup logic
  }
  
  @Hook({ type: 'after', target: 'execute' })
  async afterExecute(): Promise<void> {
    this.log.info('Workflow execution completed');
    // Cleanup logic
  }
  
  @Hook({ type: 'before', target: 'updateStatus' })
  async beforeStatusUpdate(newStatus: string): Promise<void> {
    this.log.info(`About to update status to: ${newStatus}`);
    // Validation logic
  }
  
  @Signal()
  async updateStatus(newStatus: string): Promise<void> {
    // Implementation
  }
  
  protected async execute(): Promise<any> {
    // Workflow implementation
  }
}
```

### Hook Options

The `@Hook` decorator accepts an options object with the following properties:

- `type`: The type of hook ('before' or 'after')
- `target`: The name of the method to hook into
- `priority`: Priority of the hook (higher priority hooks are called first)

## Step-Based Execution

The `Workflow` class provides a powerful step-based execution model through the `@Step` decorator.

### Defining Workflow Steps

```typescript
import { Workflow, Temporal, Step } from 'chrono-forge';

@Temporal({ name: 'OrderProcessingWorkflow' })
class OrderProcessingWorkflow extends Workflow {
  private orderData: any = {};
  
  @Step()
  async validateOrder(): Promise<void> {
    // Validation logic
    this.orderData.validated = true;
  }
  
  @Step({ 
    after: 'validateOrder',
    on: function() { return this.orderData.validated === true; }
  })
  async processPayment(): Promise<void> {
    // Payment processing logic
    this.orderData.paymentProcessed = true;
  }
  
  @Step({ 
    after: 'processPayment',
    retries: 3,
    timeout: '1m'
  })
  async shipOrder(): Promise<void> {
    // Shipping logic
    this.orderData.shipped = true;
  }
  
  protected async execute(): Promise<any> {
    await this.executeSteps();
    return this.orderData;
  }
}
```

### Step Options

The `@Step` decorator accepts an options object with the following properties:

- `name`: Custom name for the step (defaults to the method name)
- `before`: Steps that must execute before this step
- `after`: Steps that must execute after this step
- `on`: Condition function that determines if the step should execute
- `retries`: Number of times to retry the step if it fails
- `timeout`: Maximum time the step can run before timing out
- `required`: Whether the step is required for workflow completion
- `onError`: Custom error handler for the step

## Logging and Tracing

The `Workflow` class provides built-in logging and tracing capabilities.

### Using the Logger

```typescript
import { Workflow, Temporal } from 'chrono-forge';

@Temporal({ name: 'LoggingWorkflow' })
class LoggingWorkflow extends Workflow {
  protected async execute(): Promise<any> {
    this.log.info('Workflow started');
    this.log.debug('Debug information', { context: 'some context' });
    
    try {
      // Risky operation
    } catch (error) {
      this.log.error('Operation failed', { error });
    }
    
    this.log.info('Workflow completed');
  }
}
```

### OpenTelemetry Integration

The `Workflow` class integrates with OpenTelemetry for distributed tracing:

```typescript
import { Workflow, Temporal } from 'chrono-forge';

@Temporal({ name: 'TracedWorkflow' })
class TracedWorkflow extends Workflow {
  protected async execute(): Promise<any> {
    // Create a span for a specific operation
    const result = await this.tracer.startActiveSpan('processData', async (span) => {
      try {
        // Operation implementation
        const result = await this.processData();
        
        // Add attributes to the span
        span.setAttributes({
          'data.size': result.size,
          'data.type': result.type
        });
        
        span.end();
        return result;
      } catch (error) {
        // Record error in the span
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.end();
        throw error;
      }
    });
    
    return result;
  }
  
  private async processData(): Promise<any> {
    // Implementation
  }
}
```

## Child Workflow Management

The `Workflow` class provides tools for managing child workflows.

### Creating and Managing Child Workflows

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

### Signaling Child Workflows

```typescript
import { Workflow, Temporal, Signal } from 'chrono-forge';

@Temporal({ name: 'ParentWorkflow' })
class ParentWorkflow extends Workflow {
  @Signal()
  async updateChildWorkflow(data: any): Promise<void> {
    const childHandle = this.handles.get('child1');
    if (childHandle) {
      await childHandle.signal.update(data);
    }
  }
  
  protected async execute(): Promise<any> {
    // Implementation
  }
}
```

## Conclusion

The `Workflow` class in ChronoForge provides a comprehensive set of features for building robust, maintainable Temporal workflows. By leveraging these features, developers can create complex workflows with clear execution paths, robust error handling, and seamless integration with Temporal's powerful orchestration capabilities.

For more detailed information on specific features and usage patterns, refer to the other sections of this documentation.
