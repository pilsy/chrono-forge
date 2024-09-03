### **`@Query` Decorator**

#### **Introduction to the `@Query` Decorator**

The `@Query` decorator is an essential feature in the ChronoForge framework that allows developers to define query handlers within a workflow. Queries provide a synchronous way to retrieve the current state or computed values from a running workflow without altering its state. Unlike signals, which are asynchronous and can modify workflow state, queries are designed to be read-only and return consistent results based on the workflow's history.

Queries are ideal for situations where external systems, users, or other workflows need to fetch information from a running workflow without interrupting its execution flow.

#### **Purpose of the `@Query` Decorator**

- **Defines Query Handlers in Workflows**: The primary purpose of the `@Query` decorator is to register a method as a query handler within a workflow. This allows the method to be invoked when a query with the corresponding name is sent to the workflow.
- **Enables Synchronous, Read-Only Data Retrieval**: Queries provide a mechanism for retrieving data from a running workflow without affecting its state. This is useful for monitoring, reporting, and retrieving workflow metadata.
- **Supports Real-Time Monitoring and Inspection**: By defining query handlers, workflows can expose internal state or computed data in real time, providing better observability and transparency.

#### **How the `@Query` Decorator Works**

When the `@Query` decorator is applied to a method in a workflow class, it performs the following actions:

1. **Registers the Method as a Query Handler**: The method is registered with Temporal as a query handler, meaning it will be called when a query with the matching name is sent to the workflow.
2. **Enables Synchronous Data Access**: The decorated method is enabled to process queries, return data, and provide insight into the current state or results of computations.
3. **Associates Queries with Workflow Instances**: The queries are associated with specific workflow instances, allowing targeted data retrieval from individual workflows.

#### **Syntax and Usage of the `@Query` Decorator**

To use the `@Query` decorator, apply it to a method within a class that extends the `Workflow` class (or its derivatives, like `StatefulWorkflow`). The method should be defined to handle the query request and return the desired data.

##### **Basic Usage Example**

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

- **Explanation**:
  - The `@Query` decorator is applied to the `getStatus` method, marking it as a query handler.
  - When the `getStatus` query is called on the workflow, the method returns the current value of the `status` property.

##### **Sending Queries to a Workflow**

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

##### **Handling Complex Queries for Derived Data**

Queries can also be used to compute and return derived data based on the current state of the workflow. This is useful for generating summaries, aggregations, or other calculated metrics.

```typescript
import { Workflow, Query } from 'chrono-forge';

@ChronoFlow()
export class ProgressWorkflow extends Workflow {
  private totalSteps: number = 100;
  private completedSteps: number = 40;

  @Query()
  calculateProgress(): number {
    return (this.completedSteps / this.totalSteps) * 100;
  }

  async execute(params: any): Promise<void> {
    console.log('Workflow executing and calculating progress...');
    // Main workflow logic here
  }
}
```

- **Explanation**:
  - The `@Query` decorator is applied to the `calculateProgress` method, marking it as a query handler.
  - When the `calculateProgress` query is called on the workflow, the method calculates and returns the progress percentage.

#### **Common Query Handling Patterns and Use Cases**

1. **Retrieving Workflow State**:
   - Queries are commonly used to retrieve the internal state of a workflow without modifying it. This is useful for monitoring, reporting, or debugging purposes.
   - Example: Querying the current status of a workflow or fetching the value of a specific property.

2. **Calculating Derived Data**:
   - Queries can compute and return derived data based on the current workflow state. This can be helpful for generating summaries, aggregations, or other calculated metrics.
   - Example: Calculating progress based on completed steps and total steps in a workflow.

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

#### **Best Practices for Using the `@Query` Decorator**

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

The `@Query` decorator in the `Workflow` class of ChronoForge provides a powerful and flexible way to define query handlers for Temporal workflows. By enabling synchronous, read-only data retrieval, queries make workflows more observable and interactive, allowing external systems to fetch real-time information without disrupting workflow execution. With proper design and best practices, developers can use the `@Query` decorator to build robust workflows that support a wide range of monitoring, reporting, and data retrieval scenarios.

For more detailed examples and advanced usage patterns, refer to the [Complete Usage Example](./complete_example.md) section.