# Complete Workflow Example

This document provides a comprehensive example of using the `Workflow` class in ChronoForge to create a fully functional workflow. The example demonstrates key features such as signals, queries, error handling, and lifecycle hooks.

## Task Management Workflow Example

In this example, we'll create a task management workflow that allows users to add, update, and delete tasks, as well as query the current state of tasks and the workflow itself.

```typescript
import { 
  Workflow, 
  Temporal, 
  Signal, 
  Query, 
  OnError, 
  Hook, 
  Property,
  Step
} from 'chrono-forge';
import { workflow } from '@temporalio/workflow';

// Define the task interface
interface Task {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in-progress' | 'completed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
}

// Define the workflow input parameters
interface TaskManagementWorkflowParams {
  workflowName: string;
  initialTasks?: Task[];
}

// Define the workflow result
interface TaskManagementWorkflowResult {
  completedTasks: Task[];
  cancelledTasks: Task[];
  status: string;
  errors: Error[];
}

@Temporal({
  name: 'TaskManagementWorkflow',
  description: 'A workflow for managing tasks with signals, queries, and error handling'
})
class TaskManagementWorkflow extends Workflow<TaskManagementWorkflowParams, TaskManagementWorkflowResult> {
  // State management
  private tasks: Record<string, Task> = {};
  
  @Property()
  private workflowStatus: string = 'initializing';
  
  private errors: Error[] = [];

  // Constructor
  constructor() {
    super();
    // Initialize any additional properties if needed
  }

  // Signal Handlers
  @Signal()
  async addTask(task: Omit<Task, 'createdAt' | 'updatedAt'>): Promise<void> {
    const now = new Date().toISOString();
    const newTask: Task = {
      ...task,
      createdAt: now,
      updatedAt: now
    };
    
    this.tasks[task.id] = newTask;
    this.log.info(`Task added: ${task.id}`);
  }

  @Signal()
  async updateTaskStatus(taskId: string, status: Task['status']): Promise<void> {
    if (!this.tasks[taskId]) {
      throw new Error(`Task with ID ${taskId} not found`);
    }
    
    this.tasks[taskId] = {
      ...this.tasks[taskId],
      status,
      updatedAt: new Date().toISOString()
    };
    
    this.log.info(`Task ${taskId} status updated to: ${status}`);
  }

  @Signal()
  async updateTaskDetails(taskId: string, updates: Partial<Pick<Task, 'title' | 'description'>>): Promise<void> {
    if (!this.tasks[taskId]) {
      throw new Error(`Task with ID ${taskId} not found`);
    }
    
    this.tasks[taskId] = {
      ...this.tasks[taskId],
      ...updates,
      updatedAt: new Date().toISOString()
    };
    
    this.log.info(`Task ${taskId} details updated`);
  }

  @Signal()
  async deleteTask(taskId: string): Promise<void> {
    if (!this.tasks[taskId]) {
      throw new Error(`Task with ID ${taskId} not found`);
    }
    
    delete this.tasks[taskId];
    this.log.info(`Task ${taskId} deleted`);
  }

  @Signal()
  async completeAllTasks(): Promise<void> {
    const now = new Date().toISOString();
    
    Object.keys(this.tasks).forEach(taskId => {
      if (this.tasks[taskId].status !== 'cancelled') {
        this.tasks[taskId] = {
          ...this.tasks[taskId],
          status: 'completed',
          updatedAt: now
        };
      }
    });
    
    this.log.info('All tasks marked as completed');
  }

  // Query Handlers
  @Query()
  getWorkflowStatus(): string {
    return this.workflowStatus;
  }

  @Query()
  getTasks(): Task[] {
    return Object.values(this.tasks);
  }

  @Query()
  getTaskById(taskId: string): Task | null {
    return this.tasks[taskId] || null;
  }

  @Query()
  getTasksByStatus(status: Task['status']): Task[] {
    return Object.values(this.tasks).filter(task => task.status === status);
  }

  @Query()
  getErrors(): Error[] {
    return [...this.errors];
  }

  // Error Handlers
  @OnError()
  async handleGenericError(error: Error): Promise<void> {
    this.errors.push(error);
    this.log.error(`Workflow error: ${error.message}`, { error });
  }

  @OnError({ errorType: 'TaskNotFoundError' })
  async handleTaskNotFoundError(error: Error): Promise<void> {
    this.errors.push(error);
    this.log.warn(`Task not found: ${error.message}`);
  }

  // Lifecycle Hooks
  @Hook({ type: 'before', target: 'execute' })
  async beforeExecute(): Promise<void> {
    this.log.info(`Starting task management workflow: ${this.args.workflowName}`);
    
    // Initialize tasks if provided
    if (this.args.initialTasks && this.args.initialTasks.length > 0) {
      this.args.initialTasks.forEach(task => {
        this.tasks[task.id] = task;
      });
      this.log.info(`Initialized with ${this.args.initialTasks.length} tasks`);
    }
  }

  @Hook({ type: 'after', target: 'execute' })
  async afterExecute(): Promise<void> {
    this.log.info(`Task management workflow completed: ${this.args.workflowName}`);
  }

  // Workflow Steps
  @Step()
  async initializeWorkflow(): Promise<void> {
    this.workflowStatus = 'active';
    this.log.info('Workflow initialized and active');
  }

  @Step({ after: 'initializeWorkflow' })
  async processInitialTasks(): Promise<void> {
    const pendingTasks = Object.values(this.tasks).filter(task => task.status === 'pending');
    
    for (const task of pendingTasks) {
      try {
        // Simulate processing
        await workflow.sleep('1s');
        
        // Update task status
        this.tasks[task.id] = {
          ...task,
          status: 'in-progress',
          updatedAt: new Date().toISOString()
        };
        
        this.log.info(`Task ${task.id} moved to in-progress`);
      } catch (error) {
        this.log.error(`Error processing task ${task.id}`, { error });
        this.errors.push(error as Error);
      }
    }
  }

  @Step({ 
    after: 'processInitialTasks',
    retries: 3,
    onError: function(error) {
      this.log.warn(`Error in final processing: ${error.message}`);
      return { retry: true };
    }
  })
  async finalizeWorkflow(): Promise<void> {
    this.workflowStatus = 'completing';
    
    // Perform any final processing
    await workflow.sleep('2s');
    
    this.workflowStatus = 'completed';
    this.log.info('Workflow finalized');
  }

  // Main workflow execution
  protected async execute(): Promise<TaskManagementWorkflowResult> {
    try {
      // Execute workflow steps
      await this.executeSteps();
      
      // Prepare result
      const completedTasks = Object.values(this.tasks).filter(task => task.status === 'completed');
      const cancelledTasks = Object.values(this.tasks).filter(task => task.status === 'cancelled');
      
      return {
        completedTasks,
        cancelledTasks,
        status: this.workflowStatus,
        errors: this.errors
      };
    } catch (error) {
      this.workflowStatus = 'failed';
      this.errors.push(error as Error);
      
      this.log.error('Workflow execution failed', { error });
      
      return {
        completedTasks: [],
        cancelledTasks: [],
        status: 'failed',
        errors: this.errors
      };
    }
  }
}
```

## Using the Workflow

Here's how you can use the TaskManagementWorkflow from a client:

```typescript
import { Client } from '@temporalio/client';
import { TaskManagementWorkflow } from './task-management-workflow';

async function runWorkflow() {
  // Connect to Temporal
  const client = new Client();
  
  // Start the workflow
  const handle = await client.workflow.start(TaskManagementWorkflow, {
    args: [{
      workflowName: 'My Task Manager',
      initialTasks: [
        {
          id: '1',
          title: 'Initial Task',
          description: 'This is the first task',
          status: 'pending',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    }],
    taskQueue: 'task-management-queue',
    workflowId: 'task-management-' + Date.now()
  });
  
  console.log(`Started workflow: ${handle.workflowId}`);
  
  // Add a new task
  await handle.signal.addTask({
    id: '2',
    title: 'New Task',
    description: 'This is a new task added via signal',
    status: 'pending'
  });
  
  // Query the workflow
  const tasks = await handle.query.getTasks();
  console.log('Current tasks:', tasks);
  
  // Update a task
  await handle.signal.updateTaskStatus('2', 'in-progress');
  
  // Wait for the workflow to complete
  const result = await handle.result();
  console.log('Workflow completed with result:', result);
}

runWorkflow().catch(err => console.error(err));
```

## Key Features Demonstrated

This example demonstrates several key features of the `Workflow` class:

1. **State Management**: The workflow maintains state through the `tasks` object and the `workflowStatus` property.

2. **Signal Handling**: Multiple signal handlers are defined for adding, updating, and deleting tasks.

3. **Query Handling**: Query handlers provide access to the workflow's current state, including tasks and errors.

4. **Error Handling**: Custom error handlers manage different types of errors that may occur during workflow execution.

5. **Lifecycle Hooks**: Hooks are used to perform setup and cleanup operations before and after workflow execution.

6. **Step-Based Execution**: The workflow is broken down into steps with dependencies, retries, and error handling.

7. **Logging**: The workflow uses the built-in logger to record important events and errors.

8. **Typed Inputs and Outputs**: The workflow uses TypeScript interfaces to define its input parameters and result.

## Best Practices

This example follows several best practices for designing workflows:

1. **Modularity**: The workflow is broken down into discrete steps and signal handlers, each with a specific responsibility.

2. **Error Handling**: Comprehensive error handling ensures that the workflow can recover from failures or at least fail gracefully.

3. **Logging**: Detailed logging provides visibility into the workflow's execution and helps with debugging.

4. **Type Safety**: TypeScript interfaces ensure that the workflow's inputs and outputs are well-defined.

5. **State Management**: The workflow maintains a clear state model that can be queried and updated through signals.

6. **Input Validation**: Signal handlers validate inputs before updating the workflow state.

7. **Idempotency**: Operations like updating tasks are designed to be idempotent, allowing them to be safely retried.

## Conclusion

This example demonstrates how to use the `Workflow` class in ChronoForge to create a robust, maintainable workflow with comprehensive signal handling, query support, error management, and step-based execution. By following these patterns, you can create workflows that are resilient, observable, and easy to maintain.
