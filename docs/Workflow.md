# Workflow Class Documentation

The `Workflow` class in ChronoForge is the foundational component for defining Temporal workflows using TypeScript. It provides a powerful framework for managing workflow execution, handling signals and queries, applying lifecycle hooks, and processing complex step sequences. This documentation offers an in-depth exploration of the `Workflow` class, its features, and how to use it effectively.

## Table of Contents

1. [Overview](#overview)
2. [Workflow Decorators](#workflow-decorators)
   - [@Temporal(options: { name?: string, taskQueue?: string })](#temporaloptions--name-string-taskqueue-string-)
   - [@Signal(name?: string)](#signalname-string)
   - [@Query(name?: string)](#queryname-string)
   - [@Hook(options: { before?: string; after?: string })](#hookoptions--before-string-after-string-)
   - [@Before(targetMethod: string)](#beforetargetmethod-string)
   - [@After(targetMethod: string)](#aftertargetmethod-string)
   - [@Property(options?: { get?: boolean | string; set?: boolean | string })](#propertyoptions--get-boolean--string-set-boolean--string-)
   - [@Step(options?: { name?: string; on?: () => boolean; before?: string | string[]; after?: string | string[]; retries?: number; timeout?: number; required?: boolean; onError?: (error: Error) => any })](#stepoptions--name-string-on---boolean-before-string--string-after-string--string-retries-number-timeout-number-required-boolean-onerror-error--error--any-)
3. [Workflow Execution Engine](#workflow-execution-engine)
   - [Step Management](#step-management)
     - [getSteps()](#getsteps)
     - [getCurrentSteps()](#getcurrentsteps)
     - [isStepsComplete Boolean](#isstepscomplete-boolean)
   - [Execution Flow](#execution-flow)
     - [Step Resolution](#step-resolution)
     - [Dynamic Branching](#dynamic-branching)
   - [Completion Handling](#completion-handling)
     - [Workflow Completion](#workflow-completion)
4. [Error Handling and Tracing](#error-handling-and-tracing)
   - [Error Management](#error-management)
   - [Tracing](#tracing)
5. [Workflow Class (`Workflow`)](#workflow-class-workflow)
   - [Base Class for Workflows](#base-class-for-workflows)
   - [Properties](#properties)
   - [Methods](#methods)
6. [Dynamic Workflow Creation](#dynamic-workflow-creation)
   - [Named Function for Workflow](#named-function-for-workflow)
     - [Dynamic Class Creation](#dynamic-class-creation)
     - [Workflow Function](#workflow-function)
7. [Additional Features](#additional-features)
   - [Pathway Management](#pathway-management)
     - [Branching Based on Step Return Values](#branching-based-on-step-return-values)
   - [Completion Pathways](#completion-pathways)
     - [Entry and Exit Steps](#entry-and-exit-steps)
     - [Pathway Calculation](#pathway-calculation)
8. [Complete Usage Example](#complete-usage-example)
9. [Conclusion](#conclusion)

---

## Overview

The `Workflow` class is a crucial component of the ChronoForge framework, serving as the base for defining Temporal workflows in TypeScript. It provides developers with the tools needed to create robust workflows that can handle complex state management, dynamic branching, error handling, and more.

The `Workflow` class extends `EventEmitter` to provide event-based communication within the workflow, and it includes built-in support for:

- Signal and query handling
- Event emission and subscription
- Workflow state management
- Child workflow management
- Execution flow control (pause, resume, cancel)
- Continuation (continueAsNew) support
- Structured logging

For an introduction to the `Workflow` class and its role within ChronoForge, please refer to the [Overview](./Workflow/overview.md) section.

---

## Workflow Decorators

ChronoForge uses decorators to simplify the process of defining and managing workflows. Decorators allow developers to easily add functionality such as signal handling, query management, hooks, and more.

### **`@Temporal(options: { name?: string, taskQueue?: string })`**

- **Purpose**: Marks a class as a Temporal workflow within the ChronoForge system.
- **Parameters**:
  - **`name?: string`**: An optional custom name for the workflow. If not provided, the class name is used.
  - **`taskQueue?: string`**: An optional task queue name for the workflow. Specifies which task queue the workflow should be registered with.
- **Behavior**:
  - Ensures that the class extends `Workflow`. If it doesn't, a dynamic class is created that does.
  - Manages initialization, binding of queries and signals, and wrapping the workflow logic within an OpenTelemetry span for tracing.
- **Documentation**: For a detailed explanation and examples, see the [Temporal Decorator Documentation](./Workflow/temporal_decorator.md).

### **`@Signal(name?: string)`**

- **Purpose**: Defines a method as a signal handler within the workflow.
- **Parameters**:
  - **`name?: string`**: An optional name for the signal. If not provided, the method name is used.
- **Behavior**: Binds the method to the specified signal name, allowing the workflow to react to incoming signals.
- **Documentation**: For more details, see the [Signal Decorator Documentation](./Workflow/signal_decorator.md).

### **`@Query(name?: string)`**

- **Purpose**: Defines a method as a query handler within the workflow.
- **Parameters**:
  - **`name?: string`**: An optional name for the query. If not provided, the method name is used.
- **Behavior**: Binds the method to the specified query name, enabling external querying of the workflow state.
- **Documentation**: For more details, see the [Query Decorator Documentation](./Workflow/query_decorator.md).

### **`@Hook(options: { before?: string; after?: string })`**

- **Purpose**: Defines hooks that should be executed before or after a specific method in the workflow.
- **Parameters**:
  - **`before?: string`**: The name of the method that this hook should run before.
  - **`after?: string`**: The name of the method that this hook should run after.
- **Behavior**: Wraps the target method with logic to execute the specified hooks in the correct order.
- **Documentation**: For more details, see the [Hook Decorator Documentation](./Workflow/hook_decorator.md).

### **`@Before(targetMethod: string)`**

- **Purpose**: Simplifies the creation of a hook that runs before a specific method.
- **Parameters**:
  - **`targetMethod: string`**: The name of the method that this hook should run before.
- **Behavior**: Acts as a shorthand for `@Hook({ before: targetMethod })`.

### **`@After(targetMethod: string)`**

- **Purpose**: Simplifies the creation of a hook that runs after a specific method.
- **Parameters**:
  - **`targetMethod: string`**: The name of the method that this hook should run after.
- **Behavior**: Acts as a shorthand for `@Hook({ after: targetMethod })`.

### **`@Property(options?: { get?: boolean | string; set?: boolean | string })`**

- **Purpose**: Simplifies the creation of properties with associated query and signal handlers.
- **Parameters**:
  - **`get?: boolean | string`**: Controls query generation. If `true`, a query handler is created with the property name. If a string is provided, the query handler is named accordingly. If `false`, no query handler is created.
  - **`set?: boolean | string`**: Controls signal generation. If `true`, a signal handler is created with the property name. If a string is provided, the signal handler is named accordingly. If `false`, no signal handler is created.
- **Behavior**: Automatically creates query and signal handlers for the property, allowing external systems to get and set the property value.

### **`@Step(options?: { name?: string; on?: () => boolean; before?: string | string[]; after?: string | string[]; retries?: number; timeout?: number; required?: boolean; onError?: (error: Error) => any })`**

- **Purpose**: Defines a method as a step within a workflow, allowing for complex execution flows based on dependencies and conditions.
- **Parameters**:
  - **`name?: string`**: An optional name for the step. If not provided, the method name is used.
  - **`on?: () => boolean`**: An optional condition function that must return `true` for the step to execute.
  - **`before?: string | string[]`**: Specifies one or more steps that should be executed before this step.
  - **`after?: string | string[]`**: Specifies one or more steps that should be executed after this step.
  - **`retries?: number`**: Maximum number of retry attempts if the step fails. Default is 0 (no retries).
  - **`timeout?: number`**: Timeout in milliseconds after which the step execution will be aborted.
  - **`required?: boolean`**: Whether this step is required for workflow completion. Default is true.
  - **`onError?: (error: Error) => any`**: Custom error handler for this specific step.
- **Behavior**: Marks a method as a workflow step with specific execution order, conditions, retry logic, and error handling.
- **Documentation**: For more details, see the [Step Decorator Documentation](./Step.md).

---

## Workflow Execution Engine

The Workflow Execution Engine in ChronoForge ensures that all steps are executed in the correct order based on defined dependencies and conditions. It manages the workflow's lifecycle, including step management, execution flow, and completion handling.

### **Step Management**

- **`getSteps()`**: Retrieves all registered steps within the workflow, including their dependencies, conditions, and execution status.
- **`getCurrentSteps()`**: Returns an array of steps that should currently be running based on their dependencies and conditions.
- **`isStepsComplete` Boolean**: Indicates whether all required steps have been executed.

### **Execution Flow**

- **Step Resolution**: The engine resolves the execution order of steps based on the registered dependencies (`before` and `after`) and conditions.
- **Dynamic Branching**: The return value of each step can determine subsequent steps, allowing for dynamic pathways within the workflow.

### **Completion Handling**

- **Workflow Completion**: A workflow is deemed complete when all steps that lead to an "end" condition have been successfully executed.

---

## Error Handling and Tracing

ChronoForge integrates robust error handling and tracing mechanisms to provide insights into workflow execution and to handle failures gracefully.

### **Error Management**

- **Error Handling**: Integrated mechanisms capture and manage errors during step execution, involving retries, skips, or workflow abortion based on error-handling strategies.
- **Custom Error Handlers**: Define custom error handlers for specific methods or steps using the `@OnError` decorator or the `onError` option in the `@Step` decorator.

### **Tracing**

- **OpenTelemetry Integration**: The system integrates with OpenTelemetry, tracing each step's execution to provide detailed monitoring and logging.
- **Structured Logging**: The `Workflow` class provides a structured logging interface that automatically includes workflow context information.

For more information on handling errors and tracing, refer to [Error Handling with `@OnError`](./Workflow/error_handling.md) and [Tracing](./Workflow/error_usage.md).

---

## Workflow Class (`Workflow`)

The `Workflow` class is the foundational abstract class that all workflows in the ChronoForge system must extend. It provides essential methods and properties for managing the core functionality of Temporal workflows.

### **Base Class for Workflows**

The `Workflow` class provides the necessary infrastructure for defining and executing Temporal workflows, including:

- Event emission and handling
- Signal and query binding
- Lifecycle management
- Child workflow handling
- Execution control (pause, resume, cancel)

### **Properties**

The `Workflow` class includes several important properties:

- **`handles`**: A cache of child workflow handles for managing child workflows.
- **`log`**: A structured logging interface for workflow-specific logging.
- **`queryHandlers`**: A map of query names to their handler functions.
- **`signalHandlers`**: A map of signal names to their handler functions.
- **`continueAsNew`**: A boolean flag indicating if the workflow should continue as new.
- **`maxIterations`**: The maximum number of iterations before continuing as new.
- **`status`**: The current status of the workflow (running, paused, cancelled, etc.).
- **`conditionTimeout`**: Optional timeout for condition checks.
- **`pendingUpdate`**: Flag indicating if the workflow has pending updates.
- **`pendingIteration`**: Flag indicating if the workflow is waiting for the next iteration.
- **`iteration`**: Current iteration count for the workflow.
- **`shouldContinueAsNew`**: Flag indicating if the workflow should continue as new after the current iteration.

### **Methods**

Key methods provided by the `Workflow` class include:

- **`execute(...args: unknown[]): Promise<unknown>`**: The abstract method that must be implemented by concrete workflow classes to define the workflow logic.
- **`executeWorkflow(...args: unknown[]): Promise<any>`**: The core method that manages workflow execution and lifecycle.
- **`pause(): void`**: Signal handler to pause workflow execution.
- **`resume(): void`**: Signal handler to resume workflow execution.
- **`cancel(): void`**: Signal handler to cancel workflow execution.
- **`emitAsync(event: string, ...args: any[]): Promise<boolean>`**: Asynchronously emit events to listeners.
- **`bindEventHandlers(): Promise<void>`**: Bind event handlers based on metadata.
- **`bindQueries(): void`**: Bind query handlers for the workflow.
- **`bindSignals(): void`**: Bind signal handlers for the workflow.
- **`executeSteps(): Promise<Record<string, any>>`**: Execute workflow steps in the correct order based on dependencies.
- **`handleMaxIterations(): Promise<void>`**: Handle the case when the workflow reaches the maximum number of iterations.
- **`handleExecutionError(err: any, reject: (err: Error) => void): Promise<void>`**: Handle execution errors in the workflow.
- **`forwardSignalToChildren(signalName: string, ...args: unknown[]): Promise<void>`**: Forward signals to child workflows.
- **`isInTerminalState(): boolean`**: Check if the workflow is in a terminal state (completed, cancelled, etc.).

---

## Dynamic Workflow Creation

ChronoForge supports the dynamic creation of workflows at runtime, allowing for flexible workflow designs that adapt to varying conditions.

### **Named Function for Workflow**

- **Dynamic Class Creation**: If a class does not extend `Workflow`, the `@Temporal` decorator dynamically creates a new class that does.
- **Workflow Function**: The workflow function is dynamically created, allowing it to be named based on the class or provided name.

---

## Additional Features

ChronoForge also offers advanced features like pathway management, branching based on step return values, and completion pathways.

### **Pathway Management**

- **Dependency-Based Execution**: Steps can be executed in a specific order based on their dependencies.
- **Conditional Execution**: Steps can be conditionally executed based on runtime conditions.

### **Branching Based on Step Return Values**

- **Dynamic Pathways**: The return value of a step can determine which subsequent steps should be executed.
- **Conditional Step Execution**: Steps can be conditionally executed based on the results of previous steps.

### **Completion Pathways**

- **Entry and Exit Steps**: Define entry and exit points for workflows to create clear execution paths.
- **Pathway Calculation**: The system calculates all possible execution pathways based on step dependencies and conditions.

---

## Complete Usage Example

Here's a complete example of a workflow that processes an order:

```typescript
import { Workflow, Step, Temporal, Signal, Query, Property } from 'chrono-forge';

interface OrderData {
  id: string;
  items: string[];
  total: number;
  customerId: string;
}

@Temporal({
  name: 'OrderProcessingWorkflow',
  taskQueue: 'order-processing'
})
class OrderProcessingWorkflow extends Workflow<OrderData, {}> {
  @Property()
  private orderStatus: string = 'pending';

  @Property()
  private paymentStatus: string = 'pending';

  @Property()
  private shipmentStatus: string = 'pending';

  @Signal()
  public async updatePaymentStatus(status: string): Promise<void> {
    this.paymentStatus = status;
    this.log.info(`Payment status updated to: ${status}`);
  }

  @Query()
  public getOrderSummary(): any {
    return {
      orderId: this.args.id,
      status: this.orderStatus,
      payment: this.paymentStatus,
      shipment: this.shipmentStatus,
      items: this.args.items,
      total: this.args.total
    };
  }

  @Step()
  private async validateOrder(): Promise<boolean> {
    this.log.info(`Validating order: ${this.args.id}`);
    
    // Validation logic
    const isValid = this.args.items.length > 0 && this.args.total > 0;
    
    if (isValid) {
      this.orderStatus = 'validated';
    } else {
      this.orderStatus = 'invalid';
    }
    
    return isValid;
  }

  @Step({
    after: 'validateOrder',
    on: function() { return this.orderStatus === 'validated'; }
  })
  private async processPayment(): Promise<boolean> {
    this.log.info(`Processing payment for order: ${this.args.id}`);
    
    // Payment processing logic
    this.paymentStatus = 'processing';
    
    // Simulate payment processing
    await workflow.sleep('2s');
    
    // Update payment status
    this.paymentStatus = 'completed';
    return true;
  }

  @Step({
    after: 'processPayment',
    on: function() { return this.paymentStatus === 'completed'; }
  })
  private async prepareShipment(): Promise<boolean> {
    this.log.info(`Preparing shipment for order: ${this.args.id}`);
    
    // Shipment preparation logic
    this.shipmentStatus = 'preparing';
    
    // Simulate shipment preparation
    await workflow.sleep('3s');
    
    // Update shipment status
    this.shipmentStatus = 'ready';
    return true;
  }

  @Step({
    after: 'prepareShipment',
    on: function() { return this.shipmentStatus === 'ready'; }
  })
  private async completeOrder(): Promise<void> {
    this.log.info(`Completing order: ${this.args.id}`);
    
    // Order completion logic
    this.orderStatus = 'completed';
    
    // Emit order completed event
    await this.emitAsync('orderCompleted', {
      orderId: this.args.id,
      customerId: this.args.customerId
    });
  }

  protected async execute(): Promise<any> {
    this.log.info(`Starting order processing workflow for order: ${this.args.id}`);
    
    // Execute all steps in the correct order
    const results = await this.executeSteps();
    
    return {
      orderId: this.args.id,
      status: this.orderStatus,
      results
    };
  }
}
```

## Conclusion

The `Workflow` class in ChronoForge provides a powerful and flexible foundation for building complex workflows with Temporal. By leveraging decorators, step management, and event-based communication, developers can create robust workflows that handle complex business processes with ease.

For more information on specific aspects of the `Workflow` class, please refer to the linked documentation sections.

---

## Advanced Topics

For more advanced topics and usage patterns, please refer to the following documentation:

- [StatefulWorkflow](./StatefulWorkflow.md): A specialized workflow class for managing complex state.
- [DSL Interpreter](./DSLInterpreter.md): A domain-specific language for defining workflows.
- [Entity Management](./entities.md): Managing entities within workflows.
