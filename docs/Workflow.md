### `@Workflow` Decorator and `WorkflowClass` Documentation

The `@Workflow` decorator and `WorkflowClass` in this framework are designed to simplify and enhance the process of creating Temporal workflows in TypeScript. They provide a powerful, extensible foundation for building workflows with advanced capabilities such as automatic handling of signals, queries, hooks, events, and state management. This document provides a comprehensive overview of all the features available in the `@Workflow` decorator and `WorkflowClass`, along with usage examples.

---

## Table of Contents

1. [Overview](#overview)
2. [WorkflowClass Features](#workflowclass-features)
   - [Automatic Signal and Query Binding](#automatic-signal-and-query-binding)
   - [Hooks for Method Interception](#hooks-for-method-interception)
   - [Event Emission and Handling](#event-emission-and-handling)
   - [Signal Forwarding to Child Workflows](#signal-forwarding-to-child-workflows)
   - [Error Handling with @OnError](#error-handling-with-onerror)
   - [Support for continueAsNew](#support-for-continueasnew)
   - [Integration with StatefulWorkflow for Complex State Management](#integration-with-statefulworkflow-for-complex-state-management)
3. [@Workflow Decorator Features](#workflow-decorator-features)
   - [Automatic Class Extension](#automatic-class-extension)
   - [Dynamic Workflow Function Creation](#dynamic-workflow-function-creation)
4. [Detailed Feature Usage](#detailed-feature-usage)
   - [Automatic Signal and Query Binding](#1-automatic-signal-and-query-binding-usage)
   - [Hooks for Method Interception](#2-hooks-for-method-interception-usage)
   - [Event Emission and Handling](#3-event-emission-and-handling-usage)
   - [Signal Forwarding to Child Workflows](#4-signal-forwarding-to-child-workflows-usage)
   - [Error Handling with @OnError](#5-error-handling-with-onerror-usage)
   - [Support for continueAsNew](#6-support-for-continueasnew-usage)
   - [Integration with StatefulWorkflow](#7-integration-with-statefulworkflow-usage)
   - [@Workflow Decorator Usage](#8-workflow-decorator-usage)
   - [Complete Usage Example](#9-complete-usage-example)
5. [Conclusion](#conclusion)

---

## Overview
The `@Workflow` decorator and `WorkflowClass` are designed to streamline the creation of Temporal workflows by providing a rich set of features out of the box. These include automatic signal and query handling, support for method hooks, event handling and emission, error handling, and more. The framework is designed to be extensible, allowing developers to build complex workflows with minimal boilerplate.

## WorkflowClass Features

### 1. Automatic Signal and Query Binding
- **Signals**: Methods decorated with `@Signal` automatically become signal handlers in the workflow.
- **Queries**: Methods decorated with `@Query` automatically become query handlers in the workflow.

These methods can be invoked externally using Temporal's `signal` and `query` mechanisms.

### 2. Hooks for Method Interception
- **Before Hooks**: Run custom logic before a specified method is invoked.
- **After Hooks**: Run custom logic after a specified method has completed.
- **Combined Hooks**: Run logic both before and after a method.

Hooks are useful for injecting custom behavior around critical workflow methods, like `execute`.

### 3. Event Emission and Handling
- **Event Emission**: The `WorkflowClass` extends `EventEmitter`, allowing it to emit and handle events within the workflow.
- **Event Handling**: The `@On` decorator is used to bind methods to specific events, optionally filtered by workflow type.

This allows for complex event-driven workflows that can respond dynamically to internal or external events.

### 4. Signal Forwarding to Child Workflows
- **Automatic Signal Forwarding**: Signals received by the parent workflow can be forwarded to all child workflows.
- **Selective Forwarding**: Control which signals are forwarded using the `@On` decorator with the `forwardToChildren` option.

This feature simplifies the management of hierarchical workflows by ensuring that important signals (e.g., pause, resume) are propagated throughout the workflow tree.

### 5. Error Handling with @OnError
- **Custom Error Handling**: The `@OnError` decorator allows developers to specify custom error handling logic for specific methods.
- **Global Error Handling**: If no specific error handler is defined, a global error handler can be used as a catch-all.

This feature helps in managing errors gracefully within the workflow, ensuring robust execution even in the face of failures.

### 6. Support for continueAsNew
- **Automatic Continuation**: Workflows can be configured to automatically continue as new instances after a specified number of iterations or time.
- **State Preservation**: The framework handles the preservation and transfer of state between workflow instances.

This feature is crucial for long-running workflows that need to periodically renew themselves to avoid hitting execution limits.

### 7. Integration with StatefulWorkflow for Complex State Management
- **State Management**: The `StatefulWorkflow` class extends `WorkflowClass` to provide built-in state management.
- **Child Workflow Management**: Automatically manage the lifecycle of child workflows based on state changes.
- **Subscription Handling**: Support for dynamic subscriptions to state changes.

This integration is ideal for workflows that need to manage complex, nested state and interactions with multiple child workflows.

## @Workflow Decorator Features

### 1. Automatic Class Extension
- **Dynamic Class Extension**: If a class does not already extend `WorkflowClass`, the `@Workflow` decorator automatically extends it, simplifying the workflow creation process.
- **Seamless Integration**: Developers can focus on writing workflow logic without worrying about boilerplate code for class extension.

### 2. Dynamic Workflow Function Creation

- **Named Function Creation**: The `@Workflow` decorator dynamically creates and exports a named function for each workflow, making it discoverable by Temporal.
- **Custom Naming**: Developers can specify custom names for the workflow functions using the `name` option in the decorator.

This feature ensures that the workflow is correctly registered and can be executed by Temporal.

## Detailed Feature Usage

### 1. Automatic Signal and Query Binding Usage

#### Defining Signals and Queries
```typescript
import { WorkflowClass, Signal, Query } from './Workflow';

class Optic extends WorkflowClass {
  protected data: string = '';

  @Signal()
  public async setData(data: string) {
    this.data = data;
  }

  @Query()
  public getData(): string {
    return this.data;
  }
}
```
**Explanation**: 
- The `@Signal` decorator makes `setData` a signal handler.
- The `@Query` decorator makes `getData` a query handler.

### 2. Hooks for Method Interception Usage

#### Using Hooks
```typescript
import { WorkflowClass, Hook } from './Workflow';

class Optic extends WorkflowClass {
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

### 3. Event Emission and Handling Usage

#### Emitting and Handling Events
```typescript
import { WorkflowClass, On } from './Workflow';

class Optic extends WorkflowClass {
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

### 4. Signal Forwarding to Child Workflows Usage

#### Forwarding Signals
```typescript
import { WorkflowClass, On } from './Workflow';

class ParentWorkflow extends WorkflowClass {
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
- The `handlePause` method will handle the `pause` signal and forward it to all child workflows.

### 5. Error Handling with @OnError Usage

#### Handling Errors
```typescript
import { WorkflowClass, OnError } from './Workflow';

class Optic extends WorkflowClass {
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

### 6. Support for continueAsNew Usage

#### Automatic Continuation
```typescript
import { WorkflowClass, Hook } from './Workflow';

class Optic extends WorkflowClass {
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

### 7. Integration with StatefulWorkflow Usage

#### Managing Child Workflows
```typescript
import { StatefulWorkflowClass, On } from './StatefulWorkflow';

class MyStatefulWorkflow extends StatefulWorkflowClass {
  protected configurePaths() {
    this.configureManagedPaths([{ path: 'threads', workflowType: 'ThreadWorkflow', idAttribute: 'threadId' }]);
  }

  @On('childWorkflowComplete', 'ThreadWorkflow')
  protected async onThreadComplete(workflowId: string, result: any) {
    console.log(`Thread ${workflowId} completed with result:`, result);
  }

  protected async execute() {
    // Execution logic
  }
}
```
**Explanation**:
- `configurePaths` defines which parts of the state are managed as child workflows.
- `onThreadComplete` handles the completion of a `ThreadWorkflow` child workflow.

### 8. @Workflow Decorator Usage

#### Creating a Workflow
```typescript
import { Workflow } from './Workflow';

@Workflow({ name: 'CustomWorkflow' })
class Optic {
  protected async execute() {
    // Execution logic
  }
}
```
**Explanation**:
- The `@Workflow` decorator registers the class as a Temporal workflow.
- The workflow is named `CustomWorkflow`.


### 9. Complete Usage Example

This example demonstrates how to use all the features provided by the `@Workflow` decorator and `WorkflowClass`. The workflow simulates a document processing system where documents are received, processed, and stored. It showcases how to use signals, queries, hooks, events, error handling, and more.

```typescript
import { Workflow, WorkflowClass, Signal, Query, Hook, On, OnError } from './Workflow';

// Define the workflow using the @Workflow decorator
@Workflow({ name: 'DocumentProcessingWorkflow' })
class DocumentProcessingWorkflow extends WorkflowClass {
  private documentContent: string = '';
  private processedContent: string = '';
  private status: 'idle' | 'processing' | 'completed' = 'idle';

  // Queries
  @Query()
  public getStatus(): string {
    return this.status;
  }

  @Query()
  public getProcessedContent(): string {
    return this.processedContent;
  }

  // Signals
  @Signal()
  public uploadDocument(content: string): void {
    this.documentContent = content;
    this.status = 'processing';
    this.emit('documentUploaded', content);
  }

  @Signal()
  public finalizeProcessing(): void {
    this.status = 'completed';
    this.emit('processingCompleted', this.processedContent);
  }

  // Hooks
  @Hook({ before: 'processDocument' })
  private async logBeforeProcessing() {
    console.log('Starting document processing...');
  }

  @Hook({ after: 'processDocument' })
  private async logAfterProcessing() {
    console.log('Document processing completed.');
  }

  // Error Handling
  @OnError('processDocument')
  private async handleProcessingError(err: Error) {
    console.error('Error during document processing:', err);
    this.status = 'idle';
  }

  // Event Handling
  @On('documentUploaded')
  private async onDocumentUploaded(content: string) {
    console.log('Document uploaded:', content);
    await this.processDocument();
  }

  @On('processingCompleted')
  private async onProcessingCompleted(processedContent: string) {
    console.log('Processing completed with content:', processedContent);
    await this.storeDocument(processedContent);
  }

  // Core Workflow Methods
  protected async execute(): Promise<void> {
    console.log('Workflow started');
    this.status = 'idle';
    // Workflow execution logic
  }

  private async processDocument(): Promise<void> {
    try {
      this.processedContent = this.documentContent.toUpperCase(); // Simulate processing
    } catch (err) {
      throw new Error('Processing failed');
    }
  }

  private async storeDocument(content: string): Promise<void> {
    console.log('Storing document:', content);
    // Simulate storing the document
  }
}

export default DocumentProcessingWorkflow;
```

## Conclusion

The `@Workflow` decorator and `WorkflowClass` provide a comprehensive, extensible foundation for building complex workflows with Temporal. By automatically handling signals, queries, hooks, and events, as well as providing robust error handling and state management capabilities, this framework enables developers to focus on business logic rather than boilerplate code. 

Whether you're building simple workflows or complex, stateful workflows with nested child workflows, this framework offers the tools you need to succeed. The flexibility and power of `WorkflowClass` and `StatefulWorkflowClass` make it easy to build reliable, maintainable workflows for any application.