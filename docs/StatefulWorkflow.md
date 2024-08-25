### `StatefulWorkflow` Documentation

The `StatefulWorkflow` is designed to provide powerful state management capabilities within Temporal workflows. It enables seamless handling of complex states, automatic management of child workflows, and dynamic event-driven processing. This document details all the features available in the `StatefulWorkflow`, with usage examples for each feature.

---

## Table of Contents

1. [Overview](#overview)
2. [StatefulWorkflow Features](#statefulworkflowclass-features)
   - [State Management](#1-state-management)
   - [Child Workflow Management](#2-child-workflow-management)
   - [Dynamic Subscription Handling](#3-dynamic-subscription-handling)
   - [Hooks for Method Interception](#4-hooks-for-method-interception)
   - [Event Emission and Handling](#5-event-emission-and-handling)
   - [Error Handling with @OnError](#6-error-handling-with-onerror)
   - [Support for continueAsNew](#7-support-for-continueasnew)
   - [Signal Forwarding to Child Workflows](#8-signal-forwarding-to-child-workflows)
3. [Detailed Feature Usage](#detailed-feature-usage)
   - [State Management Usage](#1-state-management-usage)
   - [Child Workflow Management Usage](#2-child-workflow-management-usage)
   - [Dynamic Subscription Handling Usage](#3-dynamic-subscription-handling-usage)
   - [Hooks for Method Interception Usage](#4-hooks-for-method-interception-usage)
   - [Event Emission and Handling Usage](#5-event-emission-and-handling-usage)
   - [Error Handling with @OnError Usage](#6-error-handling-with-onerror-usage)
   - [Support for continueAsNew Usage](#7-support-for-continueasnew-usage)
   - [Signal Forwarding to Child Workflows Usage](#8-signal-forwarding-to-child-workflows-usage)
   - [Complete Usage Example](#9-complete-usage-example)
4. [Conclusion](#conclusion)

---

## Overview

The `StatefulWorkflow` is an advanced tool designed for managing complex state and interactions within Temporal workflows. It provides built-in support for state management, automatic handling of child workflows, dynamic subscription and event handling, and much more. The goal is to make it easier to build robust, scalable workflows that require intricate state management.

## StatefulWorkflow Features

### 1. State Management

- **Built-in State Management**: The `StatefulWorkflow` provides a state management mechanism that allows workflows to store, query, and update their state over time.
- **Deep State Inspection**: Developers can query specific paths within the state, enabling precise control over state retrieval and manipulation.

### 2. Child Workflow Management

- **Automatic Child Workflow Handling**: Automatically manage the lifecycle of child workflows based on the current state, including starting new workflows, updating existing ones, and canceling obsolete workflows.
- **Configurable Managed Paths**: Specify which paths in the state should be treated as collections of child workflows, along with the workflow types and identifier fields.

### 3. Dynamic Subscription Handling

- **Dynamic Subscription Management**: Support for dynamic subscriptions that listen for changes to specific paths within the state, allowing other workflows to be notified of state changes.
- **Automatic Notification**: Automatically notify subscribed workflows when changes occur in the monitored paths, using configured signals.

### 4. Hooks for Method Interception

- **Before and After Hooks**: Run custom logic before and after specific methods, such as `execute` or `executeStateManagement`.
- **Combined Hooks**: Run logic both before and after methods, useful for injecting behavior around critical workflow processes.

### 5. Event Emission and Handling

- **Event Emission**: The `StatefulWorkflow` extends `WorkflowClass`, which in turn extends `EventEmitter`, allowing it to emit and handle events within the workflow.
- **Event Handling**: The `@On` decorator is used to bind methods to specific events, optionally filtered by workflow type or child workflow events.

### 6. Error Handling with @OnError

- **Custom Error Handling**: The `@OnError` decorator allows developers to specify custom error handling logic for specific methods or events.
- **Global Error Handling**: If no specific error handler is defined, a global error handler can be used as a catch-all for the entire workflow.

### 7. Support for continueAsNew

- **Automatic Continuation**: The workflow can automatically continue as a new instance after a specified number of iterations or when a certain condition is met.
- **State Preservation**: The framework handles the preservation and transfer of state between workflow instances seamlessly.

### 8. Signal Forwarding to Child Workflows

- **Automatic Signal Forwarding**: Signals received by the parent workflow can be automatically forwarded to all managed child workflows.
- **Selective Forwarding**: Control which signals are forwarded to child workflows using the `@On` decorator with the `forwardToChildren` option.

## Detailed Feature Usage

### 1. State Management Usage

#### Querying and Updating State
```typescript
import { StatefulWorkflow, Signal, Query } from './StatefulWorkflow';

class MyStatefulWorkflow extends StatefulWorkflow {
  @Query()
  public getStateValue(key: string): any {
    return this.state[key];
  }

  @Signal()
  public updateStateValue(key: string, value: any): void {
    this.state[key] = value;
  }

  protected async execute() {
    // Workflow execution logic
  }
}
```
**Explanation**:
- `getStateValue` allows querying specific keys in the workflow's state.
- `updateStateValue` allows updating the state with new values.

### 2. Child Workflow Management Usage

#### Managing Child Workflows
```typescript
import { StatefulWorkflow } from './StatefulWorkflow';

class MyStatefulWorkflow extends StatefulWorkflow {
  protected configurePaths() {
    this.configureManagedPaths([{ path: 'threads', workflowType: 'ThreadWorkflow', idAttribute: 'threadId' }]);
  }

  protected async execute() {
    // Workflow execution logic
  }
}
```
**Explanation**:
- `configurePaths` defines which paths in the state are treated as collections of child workflows.

### 3. Dynamic Subscription Handling Usage

#### Managing Subscriptions
```typescript
import { StatefulWorkflow, Signal } from './StatefulWorkflow';

class MyStatefulWorkflow extends StatefulWorkflow {
  @Signal()
  public async subscribeToChanges(subscription: { workflowId: string; signalName: string; dataWatchPath: string }): Promise<void> {
    await this.subscribe(subscription);
  }

  protected async execute() {
    // Workflow execution logic
  }
}
```
**Explanation**:
- `subscribeToChanges` dynamically subscribes another workflow to changes in the state.

### 4. Hooks for Method Interception Usage

#### Using Hooks
```typescript
import { StatefulWorkflow, Hook } from './StatefulWorkflow';

class MyStatefulWorkflow extends StatefulWorkflow {
  @Hook({ before: 'execute' })
  protected async logBeforeExecution() {
    console.log('Before executing...');
  }

  @Hook({ after: 'execute' })
  protected async logAfterExecution() {
    console.log('After executing...');
  }

  protected async execute() {
    console.log('Executing main workflow logic...');
  }
}
```
**Explanation**:
- `logBeforeExecution` runs before `execute`.
- `logAfterExecution` runs after `execute`.

### 5. Event Emission and Handling Usage

#### Emitting and Handling Events
```typescript
import { StatefulWorkflow, On } from './StatefulWorkflow';

class MyStatefulWorkflow extends StatefulWorkflow {
  @On('customEvent')
  public async handleCustomEvent(data: string) {
    console.log(`Custom event received: ${data}`);
  }

  protected async execute() {
    this.emit('customEvent', 'Hello, World!');
  }
}
```
**Explanation**:
- The `handleCustomEvent` method is bound to the `customEvent` event and will be triggered when `customEvent` is emitted.

### 6. Error Handling with @OnError Usage

#### Handling Errors
```typescript
import { StatefulWorkflow, OnError } from './StatefulWorkflow';

class MyStatefulWorkflow extends StatefulWorkflow {
  @OnError('execute')
  protected async handleError(err: Error) {
    console.error('Error during execution:', err);
  }

  protected async execute() {
    throw new Error('Something went wrong!');
  }
}
```
**Explanation**:
- `handleError` is invoked if an error occurs during the `execute` method.

### 7. Support for continueAsNew Usage

#### Automatic Continuation
```typescript
import { StatefulWorkflow, Hook } from './StatefulWorkflow';

class MyStatefulWorkflow extends StatefulWorkflow {
  private iteration = 0;

  @Hook({ after: 'execute' })
  protected async checkForContinuation() {
    if (this.iteration >= 10000) {
      await this.continueAsNew();
    }
  }

  protected async execute() {
    this.iteration++;
    // Execution logic
  }
}
```
**Explanation**:
- `checkForContinuation` checks if the workflow should continue as new after a certain number of iterations.

### 8. Signal Forwarding to Child Workflows Usage

#### Forwarding Signals
```typescript
import { StatefulWorkflow, On } from './StatefulWorkflow';

class ParentWorkflow extends StatefulWorkflow {
  @On('pause', undefined, { forwardToChildren: true })
  public async handlePause() {
    console.log('Parent workflow paused.');
  }

  protected async execute() {
    // Execution logic
  }
}
```
**Explanation**:
- The `handlePause

` method will handle the `pause` signal and forward it to all child workflows.

### 9. Complete Usage Example

#### Overview

This example demonstrates how to use all the features provided by the `StatefulWorkflow`. The workflow simulates a project management system where tasks are dynamically managed, and their states are tracked across multiple child workflows.

```typescript
import {
  StatefulWorkflow,
  Signal,
  Query,
  Hook,
  On,
  OnError,
} from './StatefulWorkflow';

class ProjectManagementWorkflow extends StatefulWorkflow {
  private projectName: string = '';
  private taskUpdates: any[] = [];

  // Managed Paths
  protected configurePaths() {
    this.configureManagedPaths([{ path: 'tasks', workflowType: 'TaskWorkflow', idAttribute: 'taskId' }]);
  }

  // Queries
  @Query()
  public getProjectName(): string {
    return this.projectName;
  }

  @Query()
  public getTaskUpdates(): any[] {
    return this.taskUpdates;
  }

  // Signals
  @Signal()
  public updateProjectName(name: string): void {
    this.projectName = name;
  }

  @Signal()
  public updateTask(taskId: string, updates: any): void {
    this.pendingChanges.push({ updates, entityName: 'tasks', strategy: 'merge' });
  }

  @Signal()
  public deleteTask(taskId: string): void {
    this.pendingChanges.push({ deletions: { taskId }, entityName: 'tasks' });
  }

  // Hooks
  @Hook({ before: 'manageChildWorkflows' })
  private async logBeforeTaskManagement() {
    console.log('Managing tasks...');
  }

  @Hook({ after: 'manageChildWorkflows' })
  private async logAfterTaskManagement() {
    console.log('Tasks managed.');
  }

  // Error Handling
  @OnError('manageChildWorkflows')
  private async handleTaskManagementError(err: Error) {
    console.error('Error during task management:', err);
  }

  // Event Handling
  @On('childWorkflowComplete', 'TaskWorkflow')
  private async onTaskComplete(workflowId: string, result: any) {
    console.log(`Task ${workflowId} completed with result:`, result);
    this.taskUpdates.push({ workflowId, result });
  }

  @On('childWorkflowFailed', 'TaskWorkflow')
  private async onTaskFailed(workflowId: string, error: Error) {
    console.error(`Task ${workflowId} failed with error:`, error);
  }

  @On('pause', undefined, { forwardToChildren: true })
  private async onPause() {
    console.log('Project management workflow paused.');
  }

  // Core Workflow Methods
  protected async execute(): Promise<void> {
    console.log(`Project Management Workflow for ${this.projectName} started.`);
    // Execution logic
  }

  private async manageChildWorkflows(): Promise<void> {
    // Automatically manage child workflows based on state changes
    await this.executeStateManagement();
  }
}

export default ProjectManagementWorkflow;
```

### Explanation of `ProjectManagementWorkflow` Example

- **State Management**:
  - Manages tasks as child workflows through the `tasks` path in the state.
  - Dynamically tracks and updates the status of each task.
  
- **Child Workflow Management**:
  - Automatically starts, updates, and cancels task workflows as they are added, modified, or removed.

- **Hooks**:
  - `logBeforeTaskManagement` and `logAfterTaskManagement` are used to log the task management process.
  
- **Error Handling**:
  - `handleTaskManagementError` is triggered if there’s an error during task management.

- **Event Handling**:
  - `onTaskComplete` and `onTaskFailed` handle the completion or failure of task workflows.
  
- **Signal Forwarding**:
  - The `pause` signal is automatically forwarded to all child task workflows.

- **continueAsNew**:
  - The workflow automatically continues as new after a certain number of iterations.


## Conclusion

The `StatefulWorkflow` provides a comprehensive, extensible foundation for building complex, stateful workflows with Temporal. By automatically handling state management, child workflows, signals, queries, events, and hooks, this framework enables developers to focus on business logic while providing a robust architecture for managing complex workflow interactions.

Whether you're building simple stateful workflows or managing intricate nested workflows with dynamic states and child workflows, this framework offers the tools you need to succeed. The flexibility and power of `StatefulWorkflow` make it easy to build reliable, maintainable workflows for any application.