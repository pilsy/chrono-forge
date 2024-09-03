### **Query Handling in `Workflow` Class**

#### **Introduction to Query Handling**

Queries in Temporal workflows provide a way to retrieve the current state or computed values from a running workflow without modifying its state. Unlike signals, which are asynchronous and can change the state of a workflow, queries are synchronous and read-only. They are particularly useful when external systems need to fetch information from a workflow without interrupting its execution.

The `Workflow` class in ChronoForge simplifies the process of handling queries through the use of the `@Query` decorator, allowing developers to define query handlers directly within their workflow classes.

#### **What are Queries?**

- **Queries** are synchronous requests sent to a running workflow to fetch its current state or any derived data. Queries are guaranteed to be consistent with the workflow's history up to the point when the query is executed, providing reliable and up-to-date information.
- Queries are read-only operations. They do not modify the state or affect the execution flow of the workflow.

#### **Defining Query Handlers with the `@Query` Decorator**

To handle queries in a workflow, the `Workflow` class provides the `@Query` decorator, which is used to mark methods as query handlers. When a query is sent to the workflow, the corresponding method is invoked to return the requested data.

- **Purpose**: The `@Query` decorator registers a method as a query handler, making it accessible to external systems or other workflows that need to retrieve data.
- **Usage**: Place the `@Query` decorator above a method definition within a class that extends `Workflow` or its derivatives like `StatefulWorkflow`.

#### **Syntax and Usage**

To define a query handler in a workflow, use the `@Query` decorator as follows:

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
    // Main workflow logic
    console.log('Workflow executing with initial status:', this.status);
  }
}
```

- **Explanation**:
  - The `@Query` decorator is applied to the `getStatus` method, marking it as a query handler.
  - When the `getStatus` query is called on the workflow, the method returns the current value of the `status` property.

#### **How to Send Queries to a Workflow**

To send a query to a workflow, you typically use the Temporal client in your application code. Here’s an example of how you might send the `getStatus` query to a running `ExampleWorkflow`:

```typescript
import { WorkflowClient } from '@temporalio/client';

async function queryWorkflowStatus() {
  const client = new WorkflowClient();
  const workflowHandle = client.getHandle('example-workflow-id'); // Workflow ID

  const status = await workflowHandle.query('getStatus'); // Sending the query
  console.log('Current workflow status:', status);
}

queryWorkflowStatus();
```

- **Explanation**:
  - The Temporal client sends the `getStatus` query to a workflow identified by `example-workflow-id`.
  - The `getStatus` query returns the current status of the workflow, which is then logged to the console.

#### **Common Query Handling Patterns and Use Cases**

Queries can be used in various scenarios to retrieve the current state or computed values from a running workflow:

1. **Retrieving Workflow State**:
   - Queries can be used to retrieve the internal state of a workflow without modifying it. This is useful for monitoring, reporting, or debugging purposes.
   - Example: Querying the current status of a workflow or fetching the value of a specific property.

2. **Calculating Derived Data**:
   - Queries can compute and return derived data based on the current workflow state. This can be helpful for generating summaries, aggregations, or other calculated metrics.
   - Example:
     ```typescript
     @Query()
     calculateProgress(): number {
       // Calculate progress based on internal state
       return (this.completedSteps / this.totalSteps) * 100;
     }
     ```

3. **Enabling Polling Mechanisms**:
   - External systems can poll a workflow periodically using queries to get the latest state or computed values. This is especially useful in cases where a UI needs to display real-time status updates.
   - Example: Polling a workflow to display its progress in a user interface.

4. **Fetching Workflow Metadata**:
   - Queries can be used to fetch metadata about a workflow, such as its start time, execution history, or other non-sensitive data.
   - Example:
     ```typescript
     @Query()
     getWorkflowMetadata(): any {
       return {
         startTime: this.startTime,
         executedSteps: this.executedSteps,
       };
     }
     ```

#### **Best Practices for Query Handling**

1. **Ensure Queries are Lightweight**:
   - Queries should be quick to execute and not involve heavy computation or I/O operations. If a query handler is slow, it may impact the responsiveness of the workflow.

2. **Keep Queries Idempotent**:
   - Queries should always return the same result given the same workflow state. Avoid modifying any state or causing side effects in query handlers.

3. **Return Simple, Serializable Data**:
   - Queries should return data that is easy to serialize and deserialize. Avoid returning complex objects or data structures that may lead to serialization issues.

4. **Validate Query Inputs**:
   - Ensure that any inputs to query handlers are validated to prevent misuse or accidental errors.

5. **Document Query Handlers Clearly**:
   - Clearly document the purpose and expected output of each query handler to ensure that external systems know how to interact with the workflow correctly.

#### **Conclusion**

Query handling is a fundamental feature of the `Workflow` class in ChronoForge, providing a mechanism to retrieve state and computed values from running workflows without interrupting their execution. By using the `@Query` decorator, developers can define efficient, read-only query handlers that make Temporal workflows more interactive and accessible to external systems.

For more details on query handling and other advanced patterns, refer to the [Complete Usage Example](./complete_example.md) section.