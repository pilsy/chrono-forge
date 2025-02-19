### **Complete Usage Example for `Workflow` Class**

#### **Introduction to the Complete Workflow Example**

This comprehensive example demonstrates how to create a fully functional workflow using all the key features of the `Workflow` class in ChronoForge. By combining signals, queries, error handling, and lifecycle hooks, developers can build robust workflows that are highly interactive, resilient, and adaptable to real-time events. This example will guide you through defining a workflow that handles complex business logic while maintaining readability, maintainability, and scalability.

#### **Overview of the Example Workflow**

The example workflow simulates a task management system where tasks are dynamically managed, and their states are tracked. It showcases how to:

- **Define and Handle Signals**: For asynchronous communication and state updates.
- **Define and Handle Queries**: For synchronous, read-only data retrieval.
- **Implement Error Handling**: For managing failures and ensuring resilience.
- **Use Lifecycle Hooks**: For injecting custom logic before and after specific methods.

This example demonstrates how to use these features together to create a cohesive and powerful workflow.

#### **Comprehensive Example: `TaskManagementWorkflow`**

```typescript
import {
  Workflow,
  Signal,
  Query,
  Hook,
  OnError,
  Temporal,
} from 'temporal-forge';

@Temporal()
export class TaskManagementWorkflow extends Workflow {
  private tasks: Record<string, string> = {}; // Stores task ID to status mapping
  private workflowStatus: string = 'initialized';
  private errors: string[] = []; // To track any errors encountered

  // Managed Paths
  protected configurePaths() {
    this.configureManagedPaths([{ path: 'tasks', workflowType: 'TaskWorkflow', idField: 'taskId' }]);
  }

  // Queries
  @Query()
  public getWorkflowStatus(): string {
    return this.workflowStatus;
  }

  @Query()
  public getTasks(): Record<string, string> {
    return this.tasks;
  }

  // Signals
  @Signal()
  public async addTask(taskId: string): Promise<void> {
    if (!this.tasks[taskId]) {
      this.tasks[taskId] = 'pending';
      console.log(`Task ${taskId} added.`);
    } else {
      console.log(`Task ${taskId} already exists.`);
    }
  }

  @Signal()
  public async updateTaskStatus(taskId: string, status: string): Promise<void> {
    if (this.tasks[taskId]) {
      this.tasks[taskId] = status;
      console.log(`Task ${taskId} status updated to ${status}.`);
    } else {
      console.log(`Task ${taskId} does not exist.`);
    }
  }

  @Signal()
  public async deleteTask(taskId: string): Promise<void> {
    if (this.tasks[taskId]) {
      delete this.tasks[taskId];
      console.log(`Task ${taskId} deleted.`);
    } else {
      console.log(`Task ${taskId} does not exist.`);
    }
  }

  // Hooks
  @Hook({ before: 'manageTasks' })
  private async logBeforeTaskManagement(): Promise<void> {
    console.log('Managing tasks...');
  }

  @Hook({ after: 'manageTasks' })
  private async logAfterTaskManagement(): Promise<void> {
    console.log('Tasks managed.');
  }

  // Error Handling
  @OnError('manageTasks')
  private async handleTaskManagementError(err: Error): Promise<void> {
    console.error('Error during task management:', err.message);
    this.errors.push(err.message);
  }

  @OnError('*')
  private async handleGlobalError(err: Error): Promise<void> {
    console.error('Unhandled error in workflow:', err.message);
    this.errors.push(err.message);
  }

  // Core Workflow Methods
  async manageTasks(): Promise<void> {
    // Automatically manage tasks based on signals
    await this.executeStateManagement();
  }

  async execute(params: any): Promise<void> {
    this.workflowStatus = 'running';
    console.log(`Workflow started with status: ${this.workflowStatus}`);
    try {
      await this.manageTasks();
    } catch (err) {
      console.error('Error in execute:', err);
    }
    this.workflowStatus = 'completed';
    console.log(`Workflow completed with status: ${this.workflowStatus}`);
  }
}

export default TaskManagementWorkflow;
```

#### **Explanation of `TaskManagementWorkflow` Example**

1. **State Management**:
   - The workflow manages tasks using a `tasks` object that maps task IDs to their statuses.
   - The `workflowStatus` variable tracks the overall status of the workflow, which can be queried at any time.

2. **Signal Handling**:
   - The `addTask`, `updateTaskStatus`, and `deleteTask` methods are signal handlers defined with the `@Signal` decorator. They allow external systems to add, update, or delete tasks in real-time.

3. **Query Handling**:
   - The `getWorkflowStatus` and `getTasks` methods are query handlers defined with the `@Query` decorator. They provide synchronous access to the workflow's current status and tasks.

4. **Lifecycle Hooks**:
   - The `logBeforeTaskManagement` and `logAfterTaskManagement` methods are lifecycle hooks defined with the `@Hook` decorator. They provide logging around the `manageTasks` method for better observability.

5. **Error Handling**:
   - The `handleTaskManagementError` method is an error handler for the `manageTasks` method, defined with the `@OnError` decorator. It logs errors and keeps track of them.
   - The `handleGlobalError` method is a global error handler that catches any unhandled errors across the workflow.

6. **Core Workflow Methods**:
   - The `manageTasks` method handles task management by executing state management logic.
   - The `execute` method is the main entry point for the workflow, starting with an initial status, managing tasks, and handling completion.

#### **Combining Features for Robust Workflow Design**

The `TaskManagementWorkflow` example demonstrates how signals, queries, error handling, and hooks can be combined to create a robust and interactive workflow:

- **Signals and Queries for Real-Time Interaction**: Signals allow for asynchronous state updates, while queries provide synchronous, read-only access to workflow data.
- **Error Handling for Resilience**: Specific error handlers manage errors in critical methods, while a global error handler catches any unhandled errors.
- **Lifecycle Hooks for Cross-Cutting Concerns**: Hooks provide a clean way to inject cross-cutting concerns like logging or validation without cluttering the core logic.
- **Comprehensive Workflow Logic**: By combining these features, the workflow can dynamically manage tasks, handle errors gracefully, and provide real-time observability.

#### **Best Practices Demonstrated in the Example**

1. **Design Workflows to be Modular and Maintainable**:
   - Separate concerns using signals, queries, hooks, and error handlers to keep the workflow logic clean and easy to understand.

2. **Use Specific Error Handlers for Critical Operations**:
   - Provide targeted error handling for critical methods to ensure that errors are managed appropriately.

3. **Ensure Lifecycle Hooks are Lightweight and Idempotent**:
   - Hooks should be lightweight to avoid impacting workflow performance and should be idempotent to maintain consistency.

4. **Validate Inputs in Signal Handlers**:
   - Always validate inputs received in signals to prevent processing invalid or malicious data.

#### **Conclusion**

The `TaskManagementWorkflow` provides a comprehensive example of how to use the `Workflow` class in ChronoForge to build robust, flexible, and interactive workflows. By leveraging signals, queries, error handling, and lifecycle hooks, developers can create workflows that handle complex business logic while maintaining readability, maintainability, and scalability. This documentation provides a complete guide to combining all these features effectively, ensuring that workflows are resilient and adaptable to real-world scenarios.

For further exploration and more advanced examples, refer to other sections in the documentation.
