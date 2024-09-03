### **Signal Handling in `Workflow` Class**

#### **Introduction to Signal Handling**

Signals are a powerful feature in Temporal workflows, providing a mechanism for real-time communication with running workflows. They allow external systems, other workflows, or activities to send asynchronous notifications or data to a workflow, which can trigger specific actions or updates within the workflow. The `Workflow` class in ChronoForge simplifies the process of handling signals by using the `@Signal` decorator, which allows developers to define signal handlers directly within their workflow classes.

#### **What are Signals?**

- **Signals** are asynchronous messages sent to a running workflow to trigger specific behaviors or to update its state. Unlike queries, signals can modify the workflow state or cause the workflow to perform some actions.
- Signals are particularly useful in scenarios where workflows need to react to external events or user inputs dynamically, such as pausing a workflow, updating a status, or injecting new data for processing.

#### **Defining Signal Handlers with the `@Signal` Decorator**

To handle signals in a workflow, the `Workflow` class provides the `@Signal` decorator, which is used to mark methods as signal handlers. When a signal is sent to the workflow, the corresponding method is invoked.

- **Purpose**: The `@Signal` decorator registers a method as a signal handler, allowing it to be triggered by signals sent to the workflow.
- **Usage**: Place the `@Signal` decorator above a method definition within a class that extends `Workflow` or its derivatives like `StatefulWorkflow`.

#### **Syntax and Usage**

To define a signal handler in a workflow, use the `@Signal` decorator as follows:

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
    // Main workflow logic
    console.log('Workflow executing with initial status:', this.status);
  }
}
```

- **Explanation**:
  - The `@Signal` decorator is applied to the `updateStatus` method, marking it as a signal handler.
  - When the signal `updateStatus` is sent to the workflow, the `updateStatus` method is invoked with the signal's payload (`newStatus`), updating the workflow's `status` property.

#### **How to Send Signals to a Workflow**

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

#### **Common Signal Handling Patterns and Use Cases**

Signals can be used in various scenarios to manage the state and behavior of workflows dynamically:

1. **Updating Workflow State**:
   - Signals can be used to update the internal state of a workflow without restarting or interrupting it.
   - Example: Updating the status of a long-running workflow based on external events.

2. **Controlling Workflow Execution**:
   - Signals can be used to control the execution flow of a workflow. For example, pausing or resuming a workflow based on user input or external triggers.
   - Example:
     ```typescript
     @Signal()
     async pauseWorkflow(): Promise<void> {
       this.status = 'paused';
       console.log('Workflow is paused.');
     }
     ```

3. **Inter-Workflow Communication**:
   - Signals can be used to enable communication between workflows, allowing one workflow to trigger actions in another workflow.
   - Example: Workflow A sends a signal to Workflow B to start processing once Workflow A completes its part.

4. **Injecting Data for Processing**:
   - Signals can be used to inject data into a workflow for processing without needing to terminate or restart the workflow.
   - Example: Sending a new batch of items to be processed by a running workflow.

#### **Best Practices for Signal Handling**

1. **Design Signal Handlers to be Idempotent**:
   - Signals may be delivered more than once due to network issues or retries. Ensure that signal handlers are idempotent, meaning multiple deliveries of the same signal will not cause unintended side effects.

2. **Avoid Long-Running Operations in Signal Handlers**:
   - Signal handlers should be quick to execute. Avoid performing long-running or blocking operations directly in the signal handler. If needed, delegate such tasks to a separate activity or method.

3. **Validate Signal Inputs**:
   - Always validate the input data received in signals to avoid processing invalid or malicious data.

4. **Use Signals for Real-Time, Low-Latency Interactions**:
   - Signals are ideal for real-time interactions that require immediate action or state updates. Use signals when you need to interact with a running workflow without delay.

#### **Conclusion**

Signal handling is a core feature of the `Workflow` class in ChronoForge, providing a powerful way to communicate with running workflows and control their behavior dynamically. By using the `@Signal` decorator, developers can define robust, reactive workflows that respond to real-time events, making Temporal workflows highly interactive and flexible.

For more details on handling signals and other advanced patterns, refer to the [Complete Usage Example](./complete_example.md) section.