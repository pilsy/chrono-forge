# ChronoForge [![Test Suite](https://github.com/pilsy/chrono-forge/actions/workflows/run-tests.yml/badge.svg)](https://github.com/pilsy/chrono-forge/actions/workflows/run-tests.yml)

ChronoForge is an open-source framework designed to streamline the creation and management of workflows using Temporal.io in TypeScript. By providing a rich set of decorators, a robust workflow execution engine, and integrated state management, ChronoForge simplifies the development of complex workflows. The framework is ideal for building scalable, maintainable workflows that require intricate state management, dynamic branching, and robust error handling.

> ***"Those who say it cannot be done should stop interrupting the people doing it."***

## Documentation

For detailed documentation on all features and usage, please refer to the following:

- **[StatefulWorkflow Documentation](docs/StatefulWorkflow.md)**: Comprehensive guide on using the `StatefulWorkflowClass`.
- **[Workflow Documentation](docs/Workflow.md)**: Detailed documentation on the base `Workflow` class and its features.
- **[Entities Documentation](docs/entities.md)**: Guide on managing normalized state within workflows.

## Table of Contents

1. [Introduction to ChronoForge](#introduction-to-chronoforge)
2. [Installation](#installation)
3. [Getting Started](#getting-started)
   - [Workflow Example](#workflow-example)
   - [Stateful Workflow Example](#stateful-workflow-example)
4. [Core Concepts and Features](#core-concepts-and-features)
   - [Workflow Class](#workflow-class)
   - [StatefulWorkflow Class](#statefulworkflow-class)
5. [Detailed Feature Documentation](#detailed-feature-documentation)
   - [Workflow Class Features](#workflow-class-features)
   - [StatefulWorkflow Class Features](#statefulworkflow-class-features)
6. [Decorators Overview](#decorators-overview)
   - [List of Decorators](#list-of-decorators)
   - [Detailed Documentation and Examples for `@ChronoFlow`](#detailed-documentation-and-examples-for-chronoflow)
7. [Advanced Topics](#advanced-topics)
   - [Handling Circular Workflow Relationships](#handling-circular-workflow-relationships)
   - [Security and API Token Management](#security-and-api-token-management)
8. [API Reference and Technical Specifications](#api-reference-and-technical-specifications)
9. [Testing and Validation](#testing-and-validation)
10. [Contributing](#contributing)
11. [License](#license)

## Introduction to ChronoForge

ChronoForge enhances Temporal's workflow engine by providing developers with a set of tools and abstractions to manage complex workflows in a declarative and flexible way. Whether you're building a system that handles hierarchical task management, real-time data synchronization, or a robust microservice orchestration platform, ChronoForge provides the building blocks necessary to manage stateful workflows effectively.

ChronoForge consists of two primary classes:

- **Workflow Class**: The foundational class that provides core features for handling signals, queries, error management, and lifecycle hooks.
- **StatefulWorkflow Class**: An extension of the `Workflow` class, adding powerful state management capabilities, automatic child workflow orchestration, dynamic subscription handling, and more.

For a quick introduction, see the [Overview](./docs/Workflow/overview.md) documentation, which provides a high-level overview of the `Workflow` class and its role in the ChronoForge framework.

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
import { ChronoFlow, Workflow } from 'chrono-forge';

@ChronoFlow()
export class SimpleWorkflow extends Workflow {
  protected async execute() {
    this.log.info('Executing workflow...');
  }
}

export default SimpleWorkflow;
```

### Stateful Workflow Example

ChronoForge also supports stateful workflows that manage normalized state across executions:

```typescript
import { StatefulWorkflow, Property, Signal, Query, Before, Hook, ContinueAsNew } from 'chrono-forge';
import schemas, { MyEntity } from "@schemas"

@ChronoFlow({
  schema: MyEntity,
  schemas,
})
class MyStatefulWorkflow extends StatefulWorkflow {
  protected async execute() {
    this.log.info('Executing stateful workflow...');
  }
}

export default MyStatefulWorkflow;
```

`src/schema/index.ts`

```typescript
import { SchemaManager } from '../SchemaManager';

const schemaManager = SchemaManager.getInstance();

schemaManager.setSchemas({
  MyEntity: {
    idAttribute: 'id',
    myOtherEntity: ['MyOtherEntity']
  },
  MyOtherEntity: {
    idAttribute: 'id',
    myEntity: 'MyEntity'
  }
});

const schemas = schemaManager.getSchemas();
const { MyEntity, MyOtherEntity } = schemas;
export { MyEntity, MyOtherEntity };
export default schemas;
```

In this example, `MyStatefulWorkflow` handles normalized state using the `normalizr` library, allowing for complex state management across multiple executions.

## Core Concepts and Features

### Workflow Class

The `Workflow` class serves as the base class for defining Temporal workflows in ChronoForge. It provides essential features such as signal and query handling, error management with decorators, and lifecycle hooks for executing custom logic at different stages of workflow execution. The `Workflow` class is designed to be extended, allowing developers to define workflows that leverage Temporal's capabilities while integrating ChronoForge's advanced features.

- **Signal Handling**: Real-time communication with running workflows using the `@Signal` decorator. For details, see [Signal Handling](./docs/Workflow/signal_handling.md).
- **Query Handling**: Retrieve workflow state or computed values using the `@Query` decorator. Learn more in [Query Handling](./docs/Workflow/query_handling.md).
- **Update Handling**: Update workflow state using the `@Action` decorator. Learn more in [Update Handling](./docs/Workflow/update_handling.md).

- **Error Handling**: Robust error management using the `@OnError` decorator to define custom error handlers. Detailed examples are provided in [Error Handling with `@OnError`](./docs/Workflow/error_handling.md).
- **Lifecycle Hooks**: Inject custom logic before or after specific methods using the `@Hook` decorator. See [Lifecycle Management Hooks](./docs/Workflow/lifecycle_hooks.md) for more information.
- **Execution Control**: Manage the workflow execution lifecycle with methods like `execute`, which allow workflows to be paused, resumed, or terminated. For insights into managing long-running workflows, see [Execution Control and Flow Management](./docs/Workflow/execution_control.md).

The comprehensive breakdown of the `Workflow` class features can be found in the [Workflow Class Features](./docs/Workflow/features.md) section.

### StatefulWorkflow Class

The `StatefulWorkflow` class extends the `Workflow` class by introducing advanced state management capabilities and automatic orchestration of child workflows. This class is ideal for workflows that require managing complex states, such as nested workflows, dynamic data loading, and API integration.

- **State Management**: Manage and normalize workflow state using schemas. For an in-depth guide, see [State Management and Data Normalization](./docs/StatefulWorkflow/state_management_and_data_normalization.md).
- **Child Workflow Management**: Automatically manage child workflows' lifecycles. Details can be found in [Child Workflow Lifecycle Management](./docs/StatefulWorkflow/child_workflow_lifecycle_management.md).
- **Dynamic Subscription Handling**: Dynamically handle subscriptions to state changes within workflows. For more information, refer to [Dynamic Subscription Handling](./docs/StatefulWorkflow/subscriptions_and_signal_based_communication.md).
- **Error Handling and Recovery**: Error management strategies for complex workflows are discussed in [Error Handling with `@OnError`](./docs/Workflow/error_handling.md).

A complete overview of the `StatefulWorkflow` class and its features is available in the [StatefulWorkflow Class Features](./docs/StatefulWorkflow/getting_started.md) section.

## Detailed Feature Documentation

### Workflow Class Features

The `Workflow` class offers various features to streamline the development of Temporal workflows. Each feature is designed to address common workflow development challenges such as error handling, state management, and inter-workflow communication.

- [Signal Handling](./docs/Workflow/signal_handling.md)
- [Query Handling](./docs/Workflow/query_handling.md)
- [Execution Control and Flow Management](./docs/Workflow/execution_control.md)
- [Error Handling with `@OnError`](./docs/Workflow/error_handling.md)
- [Lifecycle Management Hooks](./docs/Workflow/lifecycle_hooks.md)
- [Decorators Overview](./docs/Workflow/decorators.md)

For a complete list of decorators provided by the `Workflow` class and their usage, see the [Decorators Provided by Workflow.ts](./docs/Workflow/decorators.md).

### StatefulWorkflow Class Features

The `StatefulWorkflow` class extends the functionality provided by the `Workflow` class by adding advanced state management, automatic child workflow orchestration, and dynamic subscription handling capabilities. This class is particularly useful for building complex, stateful workflows that require a high degree of flexibility and scalability.

- [State Management and Data Normalization](./docs/StatefulWorkflow/state_management_and_data_normalization.md)
- [Child Workflow Lifecycle Management](./docs/StatefulWorkflow/child_workflow_lifecycle_management.md)
- [Dynamic Data Loading and API Integration](./docs/StatefulWorkflow/dynamic_data_loading_and_api_integration.md)
- [Handling Circular Workflow Relationships](./docs/StatefulWorkflow/handling_circular_relationships_and_workflow_ancestry.md)
- [Security and API Token Management](./docs/StatefulWorkflow/security_and_api_token_management.md)

## Decorators Overview

ChronoForge uses a series of decorators to define and manage various aspects of workflows, such as signals, queries, hooks, and error handling. These decorators simplify the process of extending workflows and ensure consistency across different parts of the workflow system.

### List of Decorators

1. **`@ChronoFlow` Decorator**:  
   Used to register a class as a Temporal workflow within ChronoForge. This decorator manages setup tasks, ensures correct initialization, and binds signals, queries, and hooks.  
   - [Read more about `@ChronoFlow`](./docs/Workflow/chronoflow_decorator.md#chrono-flow-decorator)

2. **`@Signal` Decorator**:  
   Defines signal handlers for real-time communication with running workflows.  
   - [Read more about `@Signal`](./docs/Workflow/signal_decorator.md#signal-decorator)

3. **`@Query` Decorator**:  
   Specifies query handlers for retrieving workflow state or computed values.  
   - [Read more about `@Query`](./docs/Workflow/query_decorator.md#query-decorator)

4. **`@Hook` Decorator**:  
   (Speculative) Used for method interception to inject custom logic before and after methods in a workflow.  
   - [Read more about `@Hook`](./docs/Workflow/hook_decorator.md#hook-decorator)

5. **`@OnError` Decorator**:  
   Enables custom error handling logic for specific methods or globally across the workflow.  
   - [Read more about `@OnError`](./docs/Workflow/error_handling.md#error-handling-with-onerror)

6. **`@On` Decorator**:  
   Binds methods to specific events, optionally filtered by workflow type or child workflow events, allowing for fine-grained event handling within workflows.  
   - [Read more about `@On`](./docs/StatefulWorkflow/exposed_queries_and_signals.md#on-decorator)

### Detailed Documentation and Examples for `@ChronoFlow`

- **Introduction to ChronoForge and Decorators**: To understand the overall role of decorators in ChronoForge and how `@ChronoFlow` fits into the workflow development process, refer to the [Introduction to StatefulWorkflow](./docs/StatefulWorkflow/introduction.md) documentation.

- **Creating a Workflow with `@ChronoFlow`**: The [Getting Started Guide](./docs/StatefulWorkflow/getting_started.md#creating-a-stateful-workflow) provides step-by-step instructions on how to create a basic workflow using the `@ChronoFlow` decorator. It covers how to define a class as a workflow and set up initial signals and queries.

- **Advanced Usage and Complete Example**: For an advanced example that demonstrates the `@ChronoFlow` decorator's full capabilities, see the [Complete Usage Example](./docs/Workflow/complete_example.md). This example shows how to combine signals, queries, error handling, and hooks to build a robust workflow that handles complex interactions and state management.

## Advanced Topics

### Handling Circular Workflow Relationships

ChronoForge offers advanced features for managing circular relationships between workflows, ensuring that circular dependencies do not cause infinite loops or state conflicts. This is particularly important when dealing with parent-child workflow relationships and bidirectional subscriptions.

- To learn more, see [Handling Circular Workflow Relationships](./docs/StatefulWorkflow/handling_circular_relationships_and_workflow_ancestry.md).

### Security and API Token Management

Security is a critical aspect of workflow management, especially when dealing with dynamic data loading and external API integrations. ChronoForge provides built-in support for managing API tokens and securing workflows.

- For a detailed overview, see [Security and API Token Management](./docs/StatefulWorkflow/security_and_api_token_management.md).

## API Reference and Technical Specifications

ChronoForge's API is built around decorators and workflow classes that provide a rich set of features for managing workflows. Developers can extend these classes and utilize decorators to customize workflows for their specific use cases.

- The [API Reference and Technical Specifications](./docs/Workflow/features.md) section contains links to all relevant technical documentation files, including:
  - [Workflow Class Overview](./docs/Workflow/overview.md)
  - [StatefulWorkflow Class Overview](./docs/StatefulWorkflow/introduction.md)
  - [All Decorators and Their Usage](./docs/Workflow/decorators.md)
  - [Complete Usage Example](./docs/Workflow/complete_example.md) demonstrating a comprehensive workflow setup using all features.

## Testing and Validation

ChronoForge includes a suite of test cases to validate the behavior of workflows and ensure that features like bi-directional subscriptions, error handling, and state synchronization work as expected.

- For detailed test cases and examples, refer to:
  - [Workflow Class Tests](./src/tests/Workflow.test.ts)
  - [StatefulWorkflow Class Tests](./src/tests/StatefulWorkflow.test.ts)

These test files demonstrate how to use the ChronoForge framework in various scenarios, including setting up workflows, handling signals, managing errors, and more.

## Contributing

We welcome contributions from the community! Whether you’re fixing bugs, adding new features, or improving documentation, your contributions are valued. Please refer to our [Contributing Guidelines](./CONTRIBUTING.md) for more details.

## License

ChronoForge is licensed under the MIT License. See the [LICENSE](./LICENSE) file for more details.
