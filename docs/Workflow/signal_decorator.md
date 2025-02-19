### **`@Signal` Decorator**

#### **Introduction to the `@Signal` Decorator**

The `@Signal` decorator is a key feature in the ChronoForge framework that allows developers to define signal handlers within a workflow. Signals are asynchronous messages that can be sent to a running workflow to trigger specific actions or update its state. By using the `@Signal` decorator, developers can easily define methods that handle these signals, enabling workflows to respond dynamically to external events or inputs.

Signals are an essential part of building interactive and responsive workflows in Temporal. They provide a way for external systems, users, or other workflows to communicate with running workflows, allowing workflows to be more flexible and adaptable to changing conditions.

#### **Purpose of the `@Signal` Decorator**

- **Defines Signal Handlers in Workflows**: The primary purpose of the `@Signal` decorator is to register a method as a signal handler within a workflow. This allows the method to be invoked when a signal with the corresponding name is sent to the workflow.
- **Enables Real-Time, Asynchronous Communication**: Signals provide a mechanism for real-time, asynchronous communication with a running workflow, making it possible to interact with the workflow without stopping or restarting it.
- **Supports Dynamic Workflow Behavior**: By defining signal handlers, workflows can dynamically change their behavior or state based on signals received, enabling more complex and interactive workflows.

#### **How the `@Signal` Decorator Works**

When the `@Signal` decorator is applied to a method in a workflow class, it performs the following actions:

1. **Registers the Method as a Signal Handler**: The method is registered with Temporal as a signal handler, meaning it will be called when a signal with the matching name is sent to the workflow.
2. **Enables Signal Reception and Handling**: The decorated method is enabled to receive signals, process the payload, and perform the necessary actions or state updates.
3. **Associates Signals with Workflow Instances**: The signals are associated with specific workflow instances, allowing targeted communication with individual workflows.

#### **Syntax and Usage of the `@Signal` Decorator**

To use the `@Signal` decorator, apply it to a method within a class that extends the `Workflow` class (or its derivatives, like `StatefulWorkflow`). The method should be defined to handle the incoming signal and its payload.

##### **Basic Usage Example**

```typescript
import { Workflow, Signal } from 'temporal-forge';

@Temporal()
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

- **Explanation**:
  - The `@Signal` decorator is applied to the `updateStatus` method, marking it as a signal handler.
  - When the `updateStatus` signal is sent to the workflow, the `updateStatus` method is invoked with the signal's payload (`newStatus`), updating the workflow's `status` property.

##### **Sending Signals to a Workflow**

To send a signal to a workflow, you typically use the Temporal client in your application code. Here’s an example of how you might send the `updateStatus` signal to a running `ExampleWorkflow`:

```typescript
import { WorkflowClient } from '@temporalio/client';

async function sendSignalToWorkflow() {
  const client = new WorkflowClient();
  const workflowHandle = client.getHandle('example-workflow-id'); // Workflow ID

  await workflowHandle.signal('updateStatus', 'running'); // Sending the signal
  console.log('Signal sent to workflow to update status to "running".');
}

sendSignalToWorkflow();
```

- **Explanation**:
  - The Temporal client sends the `updateStatus` signal to a workflow identified by `example-workflow-id`.
  - The signal's payload (`'running'`) is passed to the `updateStatus` method, which updates the workflow's state.

##### **Handling Signals for Complex Workflows**

Signals can be used to handle more complex scenarios, such as pausing and resuming workflows or injecting data for processing.

```typescript
import { Workflow, Signal } from 'temporal-forge';

@Temporal()
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

- **Explanation**:
  - Two signal handlers, `pause` and `resume`, are defined using the `@Signal` decorator.
  - The `pause` signal sets the workflow to a paused state, and the `resume` signal resumes execution.

#### **Common Signal Handling Patterns and Use Cases**

1. **Updating Workflow State**:
   - Signals are commonly used to update the internal state of a workflow without interrupting it.
   - Example: Updating the status of a workflow based on user input or external events.

2. **Controlling Workflow Execution**:
   - Signals can be used to control the execution flow, such as pausing or resuming a workflow.
   - Example: Handling a signal to pause a workflow until a certain condition is met.

3. **Inter-Workflow Communication**:
   - Signals can be used to enable communication between workflows, allowing one workflow to trigger actions in another workflow.
   - Example: Workflow A sends a signal to Workflow B to start processing once Workflow A completes its part.

4. **Injecting Data for Processing**:
   - Signals can be used to inject new data into a workflow for processing without needing to terminate or restart the workflow.
   - Example: Sending a new batch of items to be processed by a running workflow.

#### **Best Practices for Using the `@Signal` Decorator**

1. **Design Signal Handlers to be Idempotent**:
   - Signals may be delivered more than once due to network issues or retries. Ensure that signal handlers are idempotent, meaning multiple deliveries of the same signal will not cause unintended side effects.

2. **Avoid Long-Running Operations in Signal Handlers**:
   - Signal handlers should be quick to execute. Avoid performing long-running or blocking operations directly in the signal handler. If needed, delegate such tasks to a separate activity or method.

3. **Validate Signal Inputs**:
   - Always validate the input data received in signals to avoid processing invalid or malicious data.

4. **Use Signals for Real-Time, Low-Latency Interactions**:
   - Signals are ideal for real-time interactions that require immediate action or state updates. Use signals when you need to interact with a running workflow without delay.

5. **Document Signal Handlers Clearly**:
   - Clearly document each signal handler's purpose and expected input to ensure that external systems know how to interact with the workflow correctly.

#### **Conclusion**

The `@Signal` decorator in the `Workflow` class of ChronoForge provides a powerful and flexible way to define signal handlers for Temporal workflows. By enabling asynchronous communication and dynamic interaction with running workflows, signals make workflows more responsive and adaptable to real-time events. With proper design and best practices, developers can use the `@Signal` decorator to build robust workflows that can handle a wide range of scenarios and interactions.

For more detailed examples and advanced usage patterns, refer to the [Complete Usage Example](./complete_example.md) section.
