### **Handling Signals in `Workflow` Class**

#### **Introduction to Handling Signals in Workflows**

Signals in Temporal workflows provide a powerful mechanism for asynchronous communication with a running workflow. By sending signals, external systems or users can trigger specific actions or update the workflow's state without needing to stop or restart it. This allows workflows to react dynamically to real-time events and make them more flexible and interactive.

The `Workflow` class in ChronoForge enables easy definition and handling of signals through the `@Signal` decorator. This section provides a detailed guide to defining and handling signals in workflows, with examples and best practices.

#### **Overview of Signal Handling**

- **Signals as Asynchronous Messages**: Signals are asynchronous messages that can be sent to a running workflow to trigger specific actions or state updates.
- **Defining Signal Handlers with `@Signal`**: The `@Signal` decorator marks a method as a signal handler. When a signal with the corresponding name is sent to the workflow, the decorated method is invoked.
- **Real-Time Interaction**: Signals enable real-time interaction with workflows, allowing them to respond to external events or user inputs dynamically.

#### **How to Define and Handle Signals in Workflows**

To define a signal handler in a workflow, use the `@Signal` decorator provided by the ChronoForge framework. The method decorated with `@Signal` should contain logic to handle the signal and update the workflow's state or perform other actions as needed.

##### **Basic Example: Defining and Using Signals**

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
  - When the `updateStatus` signal is sent to the workflow, the method is invoked with the signal's payload (`newStatus`), updating the workflow's `status` property.

##### **Sending Signals to a Workflow**

To send a signal to a running workflow, you use the Temporal client in your application code. Here’s how to send the `updateStatus` signal to a running `ExampleWorkflow`:

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

#### **Advanced Signal Handling Scenarios**

Signals can be used in more advanced scenarios to handle complex logic, such as pausing and resuming workflows, injecting data for processing, or coordinating multiple workflows.

##### **Example: Pausing and Resuming a Workflow**

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
    // Continue workflow logic
  }
}
```

- **Explanation**:
  - The `pause` and `resume` methods are defined as signal handlers using the `@Signal` decorator.
  - The workflow can be paused and resumed by sending `pause` and `resume` signals, respectively. The `execute` method contains logic to check the `paused` state and waits if the workflow is paused.

##### **Example: Coordinating Between Multiple Workflows**

Signals can be used to enable communication between workflows, allowing one workflow to trigger actions in another workflow.

```typescript
import { Workflow, Signal } from 'temporal-forge';

@Temporal()
export class CoordinatorWorkflow extends Workflow {

  @Signal()
  async notifyChildWorkflow(childWorkflowId: string, message: string): Promise<void> {
    const childWorkflowHandle = await this.client.getHandle(childWorkflowId);
    await childWorkflowHandle.signal('receiveMessage', message);
    console.log(`Sent message to child workflow ${childWorkflowId}: ${message}`);
  }

  async execute(params: any): Promise<void> {
    console.log('Coordinator workflow is running.');
    // Main workflow logic
  }
}
```

- **Explanation**:
  - The `notifyChildWorkflow` method is a signal handler that sends a signal to a child workflow.
  - This setup allows for coordinated actions between multiple workflows, where a parent or coordinator workflow can control the flow of its child workflows using signals.

#### **Common Signal Handling Patterns and Use Cases**

1. **Updating Workflow State Dynamically**:
   - Signals are commonly used to update the internal state of a workflow based on external events or user inputs.
   - Example: Updating the status of a workflow, as shown in the basic example above.

2. **Controlling Workflow Execution Flow**:
   - Signals can be used to control the execution flow of a workflow, such as pausing, resuming, or stopping it based on external commands.
   - Example: The pausing and resuming workflow example illustrates how to manage execution control using signals.

3. **Inter-Workflow Communication and Coordination**:
   - Signals enable communication between different workflows, allowing one workflow to send signals to another for coordination or data exchange.
   - Example: The coordinating workflow example demonstrates how to send messages to child workflows.

4. **Injecting Data for Processing**:
   - Signals can be used to inject new data into a workflow for processing without needing to terminate or restart the workflow.
   - Example: Sending a new batch of items to be processed by a running workflow.

#### **Best Practices for Handling Signals**

1. **Design Signal Handlers to be Idempotent**:
   - Signals may be delivered more than once due to network issues or retries. Ensure that signal handlers are idempotent, meaning multiple deliveries of the same signal will not cause unintended side effects.

2. **Avoid Long-Running Operations in Signal Handlers**:
   - Signal handlers should be quick to execute. Avoid performing long-running or blocking operations directly in the signal handler. If needed, delegate such tasks to a separate activity or method.

3. **Validate Signal Inputs**:
   - Always validate the input data received in signals to avoid processing invalid or malicious data.

4. **Document Signals Clearly**:
   - Clearly document each signal handler's purpose and expected input to ensure that external systems know how to interact with the workflow correctly.

5. **Use Signals for Real-Time, Low-Latency Interactions**:
   - Signals are ideal for real-time interactions that require immediate action or state updates. Use signals when you need to interact with a running workflow without delay.

#### **Conclusion**

The `@Signal` decorator and signal handling capabilities in the `Workflow` class of ChronoForge provide powerful tools for asynchronous communication and dynamic interaction in Temporal workflows. By defining and handling signals effectively, developers can create workflows that are highly responsive, interactive, and adaptable to real-time events. This documentation provides detailed examples and best practices for using signals in workflows, ensuring developers can leverage this feature to its full potential.

For more detailed examples and advanced usage patterns, refer to the [Complete Usage Example](./complete_example.md) section.
