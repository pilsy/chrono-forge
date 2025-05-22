# **Handling Queries in `Workflow` Class**

## **Introduction to Handling Queries in Workflows**

Queries in Temporal workflows provide a synchronous mechanism to retrieve the current state or computed values from a running workflow. Unlike signals, which are asynchronous and can modify the workflow's state, queries are read-only and are specifically designed to return consistent results based on the workflow's execution history. Queries are ideal for monitoring, reporting, and retrieving workflow metadata without interrupting or affecting the workflow's execution.

The `Workflow` class in ChronoForge enables the easy definition and handling of queries through the `@Query` decorator. This section provides a detailed guide on defining and handling queries in workflows, with examples and best practices.

## **Overview of Query Handling**

- **Queries as Synchronous, Read-Only Requests**: Queries are synchronous requests that allow external systems to fetch data from a running workflow without modifying its state.
- **Defining Query Handlers with `@Query`**: The `@Query` decorator marks a method as a query handler. When a query with the corresponding name is called, the decorated method is invoked to return the requested data.
- **Enhances Observability**: Queries provide real-time visibility into the workflow's state, making them essential for monitoring, debugging, and reporting.

## **How to Define and Handle Queries in Workflows**

To define a query handler in a workflow, use the `@Query` decorator provided by the ChronoForge framework. The method decorated with `@Query` should contain logic to retrieve and return the desired data.

## **Basic Example: Defining and Using Queries**

```typescript
import { Workflow, Query } from 'temporal-forge';

@Temporal()
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

## **Sending Queries to a Workflow**

To send a query to a running workflow, you use the Temporal client in your application code. Here’s how to send the `getStatus` query to a running `ExampleWorkflow`:

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

## **Advanced Query Handling Scenarios**

Queries can also be used to compute and return derived data based on the current state of the workflow. This is useful for generating summaries, aggregations, or other calculated metrics.

## **Example: Calculating and Returning Derived Data**

```typescript
import { Workflow, Query } from 'temporal-forge';

@Temporal()
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
  - When the `calculateProgress` query is called on the workflow, the method calculates and returns the progress percentage based on the current state.

## **Example: Retrieving Workflow Metadata**

Queries can also be used to retrieve metadata about a workflow, such as its start time, execution history, or other non-sensitive data.

```typescript
import { Workflow, Query } from 'temporal-forge';

@Temporal()
export class MetadataWorkflow extends Workflow {
  private startTime: Date = new Date();
  private executedSteps: number = 0;

  @Query()
  getWorkflowMetadata(): any {
    return {
      startTime: this.startTime,
      executedSteps: this.executedSteps,
    };
  }

  async execute(params: any): Promise<void> {
    this.executedSteps += 1;
    console.log('Workflow step executed.');
    // Main workflow logic here
  }
}
```

- **Explanation**:
  - The `getWorkflowMetadata` method is a query handler that returns metadata about the workflow, such as its start time and the number of steps executed.
  - This setup is useful for monitoring or debugging workflows without modifying their state.

## **Common Query Handling Patterns and Use Cases**

1. **Retrieving Workflow State for Monitoring and Reporting**:
   - Queries are commonly used to retrieve the internal state of a workflow for monitoring, reporting, or debugging purposes without affecting its execution.
   - Example: Querying the current status of a workflow or fetching the value of a specific property.

2. **Calculating and Returning Derived Data**:
   - Queries can compute and return derived data based on the current workflow state. This can be helpful for generating summaries, aggregations, or other calculated metrics.
   - Example: Calculating progress based on completed steps and total steps in a workflow.

3. **Enabling Polling Mechanisms for Real-Time Updates**:
   - External systems can poll a workflow periodically using queries to get the latest state or computed values. This is especially useful in cases where a UI needs to display real-time status updates.
   - Example: Polling a workflow to display its progress in a user interface.

4. **Fetching Workflow Metadata for Debugging and Analysis**:
   - Queries can be used to fetch metadata about a workflow, such as its start time, execution history, or other non-sensitive data.
   - Example: The metadata retrieval example above demonstrates how to expose workflow metadata using queries.

## **Best Practices for Handling Queries**

1. **Ensure Queries are Lightweight**:
   - Queries should be quick to execute and not involve heavy computation or I/O operations. If a query handler is slow, it may impact the responsiveness of the workflow.

2. **Keep Query Handlers Idempotent**:
   - Queries should always return the same result given the same workflow state. Avoid modifying any state or causing side effects in query handlers.

3. **Return Simple, Serializable Data**:
   - Queries should return data that is easy to serialize and deserialize. Avoid returning complex objects or data structures that may lead to serialization issues.

4. **Validate Query Inputs**:
   - Ensure that any inputs to query handlers are validated to prevent misuse or accidental errors.

5. **Document Query Handlers Clearly**:
   - Clearly document the purpose and expected output of each query handler to ensure that external systems know how to interact with the workflow correctly.

## **Conclusion**

The `@Query` decorator and query handling capabilities in the `Workflow` class of ChronoForge provide a powerful and flexible way to define synchronous, read-only data retrieval in Temporal workflows. By defining and handling queries effectively, developers can create workflows that offer enhanced observability, monitoring, and reporting without disrupting workflow execution. This documentation provides detailed examples and best practices for using queries in workflows, ensuring developers can leverage this feature to its full potential.

For more detailed examples and advanced usage patterns, refer to the [Complete Usage Example](./complete_example.md) section.
