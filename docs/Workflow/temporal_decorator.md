### **`@Temporal` Decorator**

#### **Introduction to the `@Temporal` Decorator**

The `@Temporal` decorator is a critical component in the ChronoForge framework that registers a class as a Temporal workflow. This decorator ensures that the class is recognized by Temporal's workflow engine and is set up correctly for execution. By using the `@Temporal` decorator, developers can easily define workflows without having to manually configure the underlying workflow registration process.

The `@Temporal` decorator simplifies workflow development by handling essential setup tasks, making the workflow ready to execute and interact with Temporal’s orchestration system.

#### **Purpose of the `@Temporal` Decorator**

- **Registers a Class as a Temporal Workflow**: The primary purpose of the `@Temporal` decorator is to mark a class as a Temporal workflow. This registration is necessary for Temporal to discover and manage the workflow during execution.
- **Handles Workflow Setup Tasks**: The decorator takes care of the necessary setup tasks required for a Temporal workflow, including registering metadata, defining entry points, and ensuring compatibility with Temporal's execution model.
- **Ensures Consistent Workflow Structure**: By applying the `@Temporal` decorator, developers can maintain a consistent structure for workflows across the application, making the codebase more maintainable and readable.

#### **How the `@Temporal` Decorator Works**

When the `@Temporal` decorator is applied to a class, it performs the following actions:

1. **Registers the Class as a Workflow**: The class is registered with Temporal, enabling it to be instantiated and managed by Temporal's workflow engine.
2. **Sets Up Workflow Metadata**: Metadata such as workflow name, version, and other configuration options are set up to ensure the workflow is properly initialized.
3. **Defines the Workflow Entry Point**: The `execute` method of the class is designated as the entry point for workflow execution. Temporal calls this method when the workflow is started.
4. **Configures Signals and Queries**: Any methods decorated with `@Signal` or `@Query` are registered as signal and query handlers, enabling asynchronous interaction with the workflow.

#### **Syntax and Usage of the `@Temporal` Decorator**

To use the `@Temporal` decorator, you apply it to a class that extends the `Workflow` class (or its derivatives, like `StatefulWorkflow`). This decorator must be included in any class that is intended to be a Temporal workflow.

##### **Basic Usage Example**

```typescript
import { Workflow, Temporal } from 'temporal-forge';

@Temporal()
export class ExampleWorkflow extends Workflow {
  
  async execute(params: any): Promise<void> {
    console.log('Workflow is executing with parameters:', params);
    // Main workflow logic here
  }
}
```

- **Explanation**:
  - The `@Temporal()` decorator is applied to the `ExampleWorkflow` class to register it as a Temporal workflow.
  - The `execute` method serves as the entry point for the workflow logic.

##### **Specifying a Custom Workflow Name**

You can provide a custom name for the workflow by passing options to the `@Temporal` decorator. This is useful when you want to have a specific name that is different from the class name.

```typescript
import { Workflow, Temporal } from 'temporal-forge';

@Temporal({ name: 'CustomWorkflowName' })
export class CustomWorkflow extends Workflow {

  async execute(params: any): Promise<void> {
    console.log('Custom workflow is executing.');
    // Main workflow logic here
  }
}
```

- **Explanation**:
  - The `@Temporal({ name: 'CustomWorkflowName' })` decorator registers the workflow with a custom name `CustomWorkflowName`.
  - This name will be used by Temporal when referring to this workflow.

##### **Combining `@Temporal` with Other Decorators**

The `@Temporal` decorator can be used in conjunction with other decorators such as `@Signal`, `@Query`, and `@OnError` to define a complete and interactive workflow.

```typescript
import { Workflow, Temporal, Signal, Query, OnError } from 'temporal-forge';

@Temporal({ name: 'InteractiveWorkflow' })
export class InteractiveWorkflow extends Workflow {
  
  private status: string = 'initialized';

  @Signal()
  async updateStatus(newStatus: string): Promise<void> {
    this.status = newStatus;
    console.log(`Workflow status updated to: ${this.status}`);
  }

  @Query()
  getStatus(): string {
    return this.status;
  }

  @OnError('execute')
  protected async handleError(err: Error): Promise<void> {
    console.error('Error during execution:', err);
    // Additional error handling logic
  }

  async execute(params: any): Promise<void> {
    console.log('Workflow executing with initial status:', this.status);
    // Main workflow logic here
  }
}
```

- **Explanation**:
  - The `@Temporal` decorator registers the `InteractiveWorkflow` as a Temporal workflow.
  - The `@Signal`, `@Query`, and `@OnError` decorators are used to define signal handling, query handling, and error handling capabilities within the workflow.

#### **Best Practices for Using the `@Temporal` Decorator**

1. **Always Use `@Temporal` to Register Workflows**:
   - Ensure that every workflow class is decorated with `@Temporal` to make it discoverable by Temporal. Missing this decorator will prevent the workflow from being registered and executed.

2. **Define Clear and Descriptive Workflow Names**:
   - When specifying custom workflow names, use clear and descriptive names that reflect the workflow's purpose. This makes it easier to manage workflows in Temporal and improves observability.

3. **Combine with Other Decorators for Full Functionality**:
   - Use `@Temporal` in combination with other decorators like `@Signal`, `@Query`, and `@OnError` to build robust and interactive workflows that can handle dynamic inputs and errors gracefully.

4. **Ensure the `execute` Method is Defined**:
   - The `execute` method is the entry point for the workflow and must be defined in any class decorated with `@Temporal`. This method contains the main logic that will run when the workflow starts.

5. **Follow Temporal Best Practices**:
   - Ensure that workflows follow Temporal best practices, such as ensuring idempotency, handling signals and queries correctly, and managing long-running operations using features like `ContinueAsNew`.

#### **Conclusion**

The `@Temporal` decorator is a foundational element of the ChronoForge framework, enabling developers to register and manage Temporal workflows with ease. By handling essential setup tasks and ensuring workflows are properly configured, `@Temporal` simplifies the workflow development process and allows developers to focus on building business logic and interactive features.

For more detailed examples and advanced usage patterns, refer to the [Complete Usage Example](./complete_example.md) section.
