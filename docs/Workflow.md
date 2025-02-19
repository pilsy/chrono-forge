# Workflow Class Documentation

The `Workflow` class in ChronoForge is the foundational component for defining Temporal workflows using TypeScript. It provides a powerful framework for managing workflow execution, handling signals and queries, applying lifecycle hooks, and processing complex step sequences. This documentation offers an in-depth exploration of the `Workflow` class, its features, and how to use it effectively.

## Table of Contents

1. [Overview](#overview)
2. [Workflow Decorators](#workflow-decorators)
   - [@Temporal(options: { name?: string })](#temporaloptions--name-string-)
   - [@Signal(name?: string)](#signalname-string)
   - [@Query(name?: string)](#queryname-string)
   - [@Hook(options: { before?: string; after?: string })](#hookoptions--before-string-after-string-)
   - [@Before(targetMethod: string)](#beforetargetmethod-string)
   - [@After(targetMethod: string)](#aftertargetmethod-string)
   - [@Property(options?: { get?: boolean | string; set?: boolean | string })](#propertyoptions--get-boolean--string-set-boolean--string-)
   - [@Condition(timeout?: string)](#conditiontimeout-string)
   - [@Step(options?: { name?: string; on?: () => boolean; before?: string | string[]; after?: string | string[] })](#stepoptions--name-string-on---boolean-before-string--string-after-string--string-)
3. [Workflow Execution Engine](#workflow-execution-engine)
   - [Step Management](#step-management)
     - [getSteps()](#getsteps)
     - [getCurrentSteps()](#getcurrentsteps)
     - [isComplete Boolean](#iscomplete-boolean)
   - [Execution Flow](#execution-flow)
     - [Step Resolution](#step-resolution)
     - [Dynamic Branching](#dynamic-branching)
   - [Completion Handling](#completion-handling)
     - [Workflow Completion](#workflow-completion)
4. [Error Handling and Tracing](#error-handling-and-tracing)
   - [Error Management](#error-management)
   - [Tracing](#tracing)
5. [Workflow Class (`Workflow`)](#workflow-class-workflow)
   - [Base Class for Workflows](#base-class-for-workflows)
   - [Properties](#properties)
   - [Methods](#methods)
6. [Dynamic Workflow Creation](#dynamic-workflow-creation)
   - [Named Function for Workflow](#named-function-for-workflow)
     - [Dynamic Class Creation](#dynamic-class-creation)
     - [Workflow Function](#workflow-function)
7. [Additional Features](#additional-features)
   - [Pathway Management](#pathway-management)
     - [Branching Based on Step Return Values](#branching-based-on-step-return-values)
   - [Completion Pathways](#completion-pathways)
     - [Entry and Exit Steps](#entry-and-exit-steps)
     - [Pathway Calculation](#pathway-calculation)
8. [Complete Usage Example](#complete-usage-example)
9. [Conclusion](#conclusion)

---

## Overview

The `Workflow` class is a crucial component of the ChronoForge framework, serving as the base for defining Temporal workflows in TypeScript. It provides developers with the tools needed to create robust workflows that can handle complex state management, dynamic branching, error handling, and more.

For an introduction to the `Workflow` class and its role within ChronoForge, please refer to the [Overview](./docs/Workflow/overview.md) section.

---

## Workflow Decorators

ChronoForge uses decorators to simplify the process of defining and managing workflows. Decorators allow developers to easily add functionality such as signal handling, query management, hooks, and more.

### **`@Temporal(options: { name?: string })`**

- **Purpose**: Marks a class as a Temporal workflow within the ChronoForge system.
- **Parameters**:
  - **`name?: string`**: An optional custom name for the workflow. If not provided, the class name is used.
- **Behavior**:
  - Ensures that the class extends `Workflow`. If it doesn't, a dynamic class is created that does.
  - Manages initialization, binding of queries and signals, and wrapping the workflow logic within an OpenTelemetry span for tracing.
- **Documentation**: For a detailed explanation and examples, see the [Temporal Decorator Documentation](./docs/Workflow/temporal_decorator.md).

### **`@Signal(name?: string)`**

- **Purpose**: Defines a method as a signal handler within the workflow.
- **Parameters**:
  - **`name?: string`**: An optional name for the signal. If not provided, the method name is used.
- **Behavior**: Binds the method to the specified signal name, allowing the workflow to react to incoming signals.
- **Documentation**: For more details, see the [Signal Decorator Documentation](./docs/Workflow/signal_decorator.md).

### **`@Query(name?: string)`**

- **Purpose**: Defines a method as a query handler within the workflow.
- **Parameters**:
  - **`name?: string`**: An optional name for the query. If not provided, the method name is used.
- **Behavior**: Binds the method to the specified query name, enabling external querying of the workflow state.
- **Documentation**: For more details, see the [Query Decorator Documentation](./docs/Workflow/query_decorator.md).

### **`@Hook(options: { before?: string; after?: string })`**

- **Purpose**: Defines hooks that should be executed before or after a specific method in the workflow.
- **Parameters**:
  - **`before?: string`**: The name of the method that this hook should run before.
  - **`after?: string`**: The name of the method that this hook should run after.
- **Behavior**: Wraps the target method with logic to execute the specified hooks in the correct order.
- **Documentation**: For more details, see the [Hook Decorator Documentation](./docs/Workflow/hook_decorator.md).

### **`@Before(targetMethod: string)`**

- **Purpose**: Simplifies the creation of a hook that runs before a specific method.
- **Parameters**:
  - **`targetMethod: string`**: The name of the method that this hook should run before.
- **Behavior**: Acts as a shorthand for `@Hook({ before: targetMethod })`.

### **`@After(targetMethod: string)`**

- **Purpose**: Simplifies the creation of a hook that runs after a specific method.
- **Parameters**:
  - **`targetMethod: string`**: The name of the method that this hook should run after.
- **Behavior**: Acts as a shorthand for `@Hook({ after: targetMethod })`.

### **`@Property(options?: { get?: boolean | string; set?: boolean | string })`**

- **Purpose**: Simplifies the creation of properties with associated query and signal handlers.
- **Parameters**:
  - **`get?: boolean | string`**: Controls query generation. If `true`, a query handler is created with the property name. If a string is provided, the query handler is named accordingly. If `false`, no query handler is created.
  - **`set?: boolean | string`**: Controls signal generation. If `true`, a signal handler is created with the property name. If a string is provided, the signal handler is named accordingly. If `false`, no signal handler is created.

### **`@Condition(timeout?: string)`**

- **Purpose**: Ensures that a method is only executed after a specified condition is met.
- **Parameters**:
  - **`timeout?: string`**: An optional timeout string specifying how long to wait for the condition to be met before timing out.
- **Behavior**: Wraps the target method to first await the result of `condition(() => <method logic>, { timeout })`. The method is executed only if the condition returns `true` within the specified timeout.

### **`@Step(options?: { name?: string; on?: () => boolean; before?: string | string[]; after?: string | string[] })`**

- **Purpose**: Defines a method as a step within a workflow, allowing for complex execution flows based on dependencies and conditions.
- **Parameters**:
  - **`name?: string`**: An optional name for the step. If not provided, the method name is used.
  - **`on?: () => boolean`**: An optional condition function that must return `true` for the step to execute.
  - **`before?: string | string[]`**: Specifies one or more steps that should be executed before this step.
  - **`after?: string | string[]`**: Specifies one or more steps that should be executed after this step.

---

## Workflow Execution Engine

The Workflow Execution Engine in ChronoForge ensures that all steps are executed in the correct order based on defined dependencies and conditions. It manages the workflow's lifecycle, including step management, execution flow, and completion handling.

### **Step Management**

- **`getSteps()`**: Retrieves all registered steps within the workflow, including their dependencies, conditions, and execution status.
- **`getCurrentSteps()`**: Returns an array of steps that should currently be running based on their dependencies and conditions.
- **`isComplete` Boolean**: Indicates whether all required steps have been executed.

### **Execution Flow**

- **Step Resolution**: The engine resolves the execution order of steps based on the registered dependencies (`before` and `after`) and conditions.
- **Dynamic Branching**: The return value of each step can determine subsequent steps, allowing for dynamic pathways within the workflow.

### **Completion Handling**

- **Workflow Completion**: A workflow is deemed complete when all steps that lead to an "end" condition have been successfully executed.

---

## Error Handling and Tracing

ChronoForge integrates robust error handling and tracing mechanisms to provide insights into workflow execution and to handle failures gracefully.

### **Error Management**

- **Error Handling**: Integrated mechanisms capture and manage errors during step execution, involving retries, skips, or workflow abortion based on error-handling strategies.

### **Tracing**

- **OpenTelemetry Integration**: The system integrates with OpenTelemetry, tracing each step’s execution to provide detailed monitoring and logging.

For more information on handling errors and tracing, refer to [Error Handling with `@OnError`](./docs/Workflow/error_handling.md) and [Tracing](./docs/Workflow/error_usage.md).

---

## Workflow Class (`Workflow`)

The `Workflow` class is the foundational abstract class that all workflows in the ChronoForge system must extend. It provides essential methods and properties for managing the core functionality of Temporal workflows.

### **Base Class for Workflows**

The `Workflow` class provides the necessary infrastructure for defining and executing Temporal workflows. See the [Workflow Class Overview](./docs/Workflow/overview.md) for more details.

### **Properties and Methods**

A comprehensive breakdown of properties and methods is available in the [Workflow Class Features](./docs/Workflow/features.md) section.

---

## Dynamic Workflow Creation

ChronoForge supports the dynamic creation of workflows at runtime, allowing for flexible workflow designs that adapt to varying conditions.

### **Named Function for Workflow**

- **Dynamic Class Creation**: If a class does not extend `Workflow`, the decorator dynamically creates a new class that does.
- **Workflow Function**: The workflow function is dynamically created, allowing it to be named based on the class or provided name.

---

## Additional Features

ChronoForge also offers advanced features like pathway management, branching based on step return values, and completion pathways.

For more information on these topics, refer to the [Additional Features](./docs/Workflow/feature_usage.md) section.

---

## Complete Usage Example

For a comprehensive example that demonstrates how to create a complete workflow using all the features of the `Workflow` class, see the [Complete Usage Example](./docs/Workflow/complete_example.md).

---

## Conclusion

The `Workflow` class in ChronoForge is a powerful tool for building advanced, stateful workflows with Temporal. It provides a flexible and extensible foundation that developers can use to build robust workflows with enhanced state management, error handling, and dynamic execution capabilities.

For a final overview, see the [Conclusion](./docs/Workflow/conclusion.md).
