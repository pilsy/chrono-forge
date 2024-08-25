# ChronoForge

ChronoForge is an open-source framework designed to streamline the creation and management of workflows using Temporal.io in TypeScript. By providing a rich set of decorators, a robust workflow execution engine, and integrated state management, ChronoForge simplifies the development of complex workflows. The framework is ideal for building scalable, maintainable workflows that require intricate state management, dynamic branching, and robust error handling.

> ***Those who say it cannot be done should stop interrupting the people doing it.***

## Table of Contents

1. [Introduction](#introduction)
2. [Installation](#installation)
3. [Getting Started](#getting-started)
   - [Workflow Example](#workflow-example)
   - [Stateful Workflow Example](#stateful-workflow-example)
4. [Features](#features)
   - [Decorators Overview](#decorators-overview)
   - [Workflow Execution Engine](#workflow-execution-engine)
   - [State Management and Normalization](#state-management-and-normalization)
   - [Error Handling and Tracing](#error-handling-and-tracing)
   - [Dynamic Workflow Creation](#dynamic-workflow-creation)
5. [Documentation](#documentation)
6. [Contributing](#contributing)
7. [License](#license)

## Introduction

ChronoForge enhances the capabilities of Temporal.io by providing an intuitive and powerful framework for defining and managing workflows. Whether you are building simple workflows or managing complex, stateful workflows with dynamic execution paths, ChronoForge provides the tools and structure to help you succeed.

## Installation

To get started with ChronoForge, install it via npm or yarn:

```bash
npm install chrono-forge
```

Or with yarn:

```bash
yarn add chrono-forge
```

ChronoForge requires Node.js 14 or later and integrates seamlessly with Temporal.io's TypeScript SDK.

## Getting Started

ChronoForge offers a streamlined approach to creating both basic and stateful workflows. Below are examples demonstrating the use of the framework’s features.

### Workflow Example

A basic workflow in ChronoForge utilizes the `@ChronoFlow` decorator along with various step and signal decorators to define its logic:

```typescript
import { ChronoFlow, Workflow, Step, Signal, Query, Before, After } from 'chrono-forge';

@ChronoFlow({ name: 'SimpleWorkflow' })
class SimpleWorkflow extends Workflow {
  private data: string = '';

  @Query()
  getData() {
    return this.data;
  }

  @Signal()
  setData(newData: string) {
    this.data = newData;
  }

  @Step({ name: 'initialize' })
  async initialize() {
    console.log('Initializing workflow...');
  }

  @Step({ name: 'processData', after: 'initialize' })
  async processData() {
    console.log('Processing data:', this.data);
  }

  @Step({ name: 'finalize', after: 'processData' })
  async finalize() {
    console.log('Finalizing workflow.');
  }

  protected async execute() {
    console.log('Executing workflow...');
  }
}

export default SimpleWorkflow;
```

### Stateful Workflow Example

ChronoForge also supports stateful workflows that manage normalized state across executions:

```typescript
import { StatefulWorkflowClass, Signal, Query, Hook, ContinueAsNew } from 'chrono-forge';
import { schema } from 'normalizr';

const entitySchema = new schema.Entity('entity');

class MyStatefulWorkflow extends StatefulWorkflowClass {
  @Query()
  public getStateValue(key: string): any {
    return this.state[key];
  }

  @Signal()
  public updateStateValue(key: string, value: any): void {
    this.state[key] = value;
  }

  @Hook({ after: 'execute' })
  async afterExecution() {
    console.log('After execution hook.');
  }

  @ContinueAsNew()
  async continueAsNewWorkflow() {
    console.log('Continuing as new workflow...');
  }

  protected async execute() {
    console.log('Executing stateful workflow with normalized state...');
  }
}

export default MyStatefulWorkflow;
```

In this example, `MyStatefulWorkflow` handles normalized state using the `normalizr` library, allowing for complex state management across multiple executions.

## Features

### Decorators Overview

ChronoForge uses decorators to simplify workflow creation and management. Here are the key decorators available:

- **`@ChronoFlow(options: { name?: string })`**: Marks a class as a Temporal workflow. It automatically extends the `Workflow` class if needed and manages the workflow lifecycle.
- **`@Signal(name?: string)`**: Defines a method as a signal handler, allowing external entities to interact with the workflow.
- **`@Query(name?: string)`**: Defines a method as a query handler, enabling external entities to retrieve information about the workflow's state.
- **`@Step(options?: { name?: string; on?: () => boolean; before?: string | string[]; after?: string | string[] })`**: Registers a method as a step within a workflow, allowing for complex execution flows based on dependencies and conditions.
- **`@Hook(options: { before?: string; after?: string })`**: Defines hooks that are executed before or after specific methods in the workflow.
- **`@Before(targetMethod: string)`**: A shorthand for defining hooks that run before a specific method.
- **`@After(targetMethod: string)`**: A shorthand for defining hooks that run after a specific method.
- **`@Property(options?: { get?: boolean | string; set?: boolean | string })`**: Automatically generates query and signal handlers for a property.
- **`@Condition(timeout?: string)`**: Ensures that a method is only executed after a specified condition is met.
- **`@ContinueAsNew()`**: Indicates that a workflow should continue as a new instance, often used in long-running workflows to prevent excessive memory usage.

### Workflow Execution Engine

The Workflow Execution Engine in ChronoForge ensures that all steps are executed in the correct order based on defined dependencies and conditions. Key features include:

- **Step Management**: Manage and retrieve all registered steps, their execution status, and dependencies.
- **Execution Flow**: Resolve the execution order of steps dynamically, supporting branching based on step outcomes.
- **Completion Handling**: Automatically manage workflow completion by tracking the execution of entry and exit steps.

### State Management and Normalization

ChronoForge provides robust state management capabilities, especially in stateful workflows. The framework uses `normalizr` to handle normalized state, which makes it easier to manage complex data structures across workflow executions. Key features include:

- **State Querying and Updating**: Query and update state dynamically within the workflow.
- **Child Workflow Management**: Automatically manage the lifecycle of child workflows based on state changes.
- **Dynamic Subscription Handling**: Subscribe to state changes dynamically, notifying other workflows when updates occur.

For more detailed information on handling normalized state, refer to the [Entities Documentation](./docs/entities.md).

### Error Handling and Tracing

ChronoForge integrates with OpenTelemetry for tracing, providing detailed logs and monitoring for workflow execution. The framework’s error handling features include:

- **Error Management**: Capture and manage errors during step execution, including retries, skips, or workflow abortion based on error-handling strategies.
- **Tracing**: Use OpenTelemetry to trace workflow execution, enabling in-depth analysis and debugging.

### Dynamic Workflow Creation

ChronoForge supports the dynamic creation of workflows at runtime. This feature is particularly useful for workflows with complex branching logic or when workflows need to be generated based on runtime conditions. Key features include:

- **Named Function for Workflow**: Dynamically creates and names workflow functions, ensuring that workflows inherit all necessary functionality.
- **Dynamic Branching**: Supports branching within workflows based on step return values, allowing for highly flexible and adaptive workflows.

## Documentation

For detailed documentation on all features and usage, please refer to the following:

- **[StatefulWorkflowClass Documentation](docs/StatefulWorkflow.md)**: Comprehensive guide on using the `StatefulWorkflowClass`.
- **[WorkflowClass Documentation](docs/Workflow.md)**: Detailed documentation on the base `Workflow` class and its features.
- **[Entities Documentation](docs/entities.md)**: Guide on managing normalized state within workflows.

## Contributing

We welcome contributions from the community! Whether you’re fixing bugs, adding new features, or improving documentation, your contributions are valued. Please refer to our [Contributing Guidelines](./CONTRIBUTING.md) for more details.

## License

ChronoForge is licensed under the MIT License. See the [LICENSE](./LICENSE) file for more details.