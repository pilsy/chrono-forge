### ChronoForge Temporal Workflow System with Decorators

This spec provides a comprehensive overview of a Temporal workflow system in TypeScript, integrating various decorators and features to simplify and extend the workflow functionality. It covers everything from basic workflow definitions to advanced step management, conditional execution, and dynamic branching.

# Table of Contents

- [1. Workflow Decorators](#1-workflow-decorators)
  - [@Workflow(options: { name?: string })](#workflowoptions--name-string-)
  - [@Signal(name?: string)](#signalname-string)
  - [@Query(name?: string)](#queryname-string)
  - [@Hook(options: { before?: string; after?: string })](#hookoptions--before-string-after-string-)
  - [@Before(targetMethod: string)](#beforetargetmethod-string)
  - [@After(targetMethod: string)](#aftertargetmethod-string)
  - [@Property(options?: { get?: boolean | string; set?: boolean | string })](#propertyoptions--get-boolean--string-set-boolean--string-)
  - [@Condition(timeout?: string)](#conditiontimeout-string)
  - [@Step(options?: { name?: string; on?: () => boolean; before?: string | string[]; after?: string | string[] })](#stepoptions--name-string-on---boolean-before-string--string-after-string--string-)
- [2. Workflow Execution Engine](#2-workflow-execution-engine)
  - [Step Management](#step-management)
    - [getSteps()](#getsteps)
    - [getCurrentSteps()](#getcurrentsteps)
    - [isComplete Boolean](#iscomplete-boolean)
  - [Execution Flow](#execution-flow)
    - [Step Resolution](#step-resolution)
    - [Dynamic Branching](#dynamic-branching)
  - [Completion Handling](#completion-handling)
    - [Workflow Completion](#workflow-completion)
- [3. Error Handling and Tracing](#3-error-handling-and-tracing)
  - [Error Management](#error-management)
  - [Tracing](#tracing)
- [4. Workflow Class (WorkflowClass)](#4-workflow-class-workflowclass)
  - [Base Class for Workflows](#base-class-for-workflows)
    - [signalHandlers and queryHandlers](#signalhandlers-and-queryhandlers)
    - [bindQueriesAndSignals()](#bindqueriesandsignals)
    - [applyHooks(hooks)](#applyhookshooks)
    - [forwardSignalToChildren(signalName, ...args)](#forwardsignaltochildrensignalname-args)
    - [execute(...args: unknown[])](#executeargs-unknown)
    - [Event Handling](#event-handling)
    - [Tracing and Logging](#tracing-and-logging)
- [5. Dynamic Workflow Creation](#5-dynamic-workflow-creation)
  - [Named Function for Workflow](#named-function-for-workflow)
    - [Dynamic Class Creation](#dynamic-class-creation)
    - [Workflow Function](#workflow-function)
- [6. Additional Features](#6-additional-features)
  - [Pathway Management](#pathway-management)
    - [Branching Based on Step Return Values](#branching-based-on-step-return-values)
  - [Completion Pathways](#completion-pathways)
    - [Entry and Exit Steps](#entry-and-exit-steps)
    - [Pathway Calculation](#pathway-calculation)
- [Summary](#summary)

---
### 1. **Workflow Decorators**
---

#### **`@Workflow(options: { name?: string })`**
- **Purpose**: Marks a class as a Temporal workflow.
- **Parameters**:
  - **`name?: string`**: An optional custom name for the workflow. If not provided, the class name is used.
- **Behavior**:
  - Ensures that the class extends `WorkflowClass`. If it doesn't, a dynamic class is created that does.
  - Serves as the entry point for the workflow, managing initialization, binding of queries and signals, and wrapping the workflow logic within an OpenTelemetry span for tracing.
- **Example**:

```typescript
@Workflow()
class MyWorkflow extends WorkflowClass {
  async execute() {
    // Workflow logic here
  }
}
```
---
#### **`@Signal(name?: string)`**
- **Purpose**: Defines a method as a signal handler within the workflow.
- **Parameters**:
  - **`name?: string`**: An optional name for the signal. If not provided, the method name is used.
- **Behavior**:
  - Binds the method to the specified signal name, allowing the workflow to react to incoming signals.
- **Example**:

```typescript
@Signal()
resume() {
  this.status = 'resume';
}
```
---
#### **`@Query(name?: string)`**
- **Purpose**: Defines a method as a query handler within the workflow.
- **Parameters**:
  - **`name?: string`**: An optional name for the query. If not provided, the method name is used.
- **Behavior**:
  - Binds the method to the specified query name, enabling external querying of the workflow state.
- **Example**:

```typescript
@Query("status")
getStatus() {
  return this.status;
}
```
---
#### **`@Hook(options: { before?: string; after?: string })`**
- **Purpose**: Defines hooks that should be executed before or after a specific method in the workflow.
- **Parameters**:
  - **`before?: string`**: The name of the method that this hook should run before.
  - **`after?: string`**: The name of the method that this hook should run after.
- **Behavior**:
  - Wraps the target method with logic to execute the specified hooks in the correct order.
- **Example**:

```typescript
@Hook({ before: "executeStep" })
beforeExecuteStep() {
  console.log('Before executing step');
}

@Hook({ after: "executeStep" })
afterExecuteStep() {
  console.log('After executing step');
}
```

---

#### **`@Before(targetMethod: string)`**
- **Purpose**: Simplifies the creation of a hook that runs before a specific method.
- **Parameters**:
  - **`targetMethod: string`**: The name of the method that this hook should run before.
- **Behavior**:
  - Acts as a shorthand for `@Hook({ before: targetMethod })`.
- **Example**:

```typescript
@Before("processData")
logBeforeProcessing() {
  console.log('Processing data...');
}
```

---

#### **`@After(targetMethod: string)`**
- **Purpose**: Simplifies the creation of a hook that runs after a specific method.
- **Parameters**:
  - **`targetMethod: string`**: The name of the method that this hook should run after.
- **Behavior**:
  - Acts as a shorthand for `@Hook({ after: targetMethod })`.
- **Example**:

```typescript
@After("processData")
logAfterProcessing() {
  console.log('Data processed.');
}
```
---

#### **`@Property(options?: { get?: boolean | string; set?: boolean | string })`**
- **Purpose**: Simplifies the creation of properties with associated query and signal handlers.
- **Parameters**:
  - **`get?: boolean | string`**: Controls query generation. If `true`, a query handler is created with the property name. If a string is provided, the query handler is named accordingly. If `false`, no query handler is created.
  - **`set?: boolean | string`**: Controls signal generation. If `true`, a signal handler is created with the property name. If a string is provided, the signal handler is named accordingly. If `false`, no signal handler is created.
- **Behavior**:
  - Automatically generates query and signal handlers for the property, based on the provided options.
- **Example**:

```typescript
@Property()
status: string;
```
---
#### **`@Condition(timeout?: string)`**
- **Purpose**: Ensures that a method is only executed after a specified condition is met.
- **Parameters**:
  - **`timeout?: string`**: An optional timeout string specifying how long to wait for the condition to be met before timing out.
- **Behavior**:
  - Wraps the target method to first await the result of `condition(() => <method logic>, { timeout })`. The method is executed only if the condition returns `true` within the specified timeout.
- **Example**:

```typescript
@Condition("1h")
async checkIfReady() {
  return this.ready;
}
```

#### **`@Step(options?: { name?: string; on?: () => boolean; before?: string | string[]; after?: string | string[] })`**
- **Purpose**: Defines a method as a step within a workflow, allowing for complex execution flows based on dependencies and conditions.
- **Parameters**:
  - **`name?: string`**: An optional name for the step. If not provided, the method name is used.
  - **`on?: () => boolean`**: An optional condition function that must return `true` for the step to execute.
  - **`before?: string | string[]`**: Specifies one or more steps that should be executed before this step.
  - **`after?: string | string[]`**: Specifies one or more steps that should be executed after this step.
- **Behavior**:
  - Registers the method as a step within the workflow, managing dependencies and conditions to determine the order of execution.
- **Example**:

```typescript
@Step({ name: "initialize", before: "executeTask" })
async initialize() {
  // Initialization logic
}

@Step({ name: "executeTask", after: "initialize", on: () => this.ready })
async executeTask() {
  // Task execution logic
}
```
---

### 2. **Workflow Execution Engine**

#### **Step Management**
- **`getSteps()`**: 
  - Retrieves all registered steps within the workflow, including their dependencies, conditions, and execution status.
  
- **`getCurrentSteps()`**:
  - Returns an array of steps that should currently be running based on their dependencies and conditions.
  
- **`isComplete` Boolean**:
  - Indicates whether all required steps have been executed. The workflow is considered complete when all entry steps (those without any `after` steps) and their dependent steps have been executed.

#### **Execution Flow**
- **Step Resolution**:
  - The engine resolves the execution order of steps based on the registered dependencies (`before` and `after`) and conditions.
  
- **Dynamic Branching**:
  - The return value of each step can determine subsequent steps, allowing for dynamic pathways within the workflow. Steps can branch into different execution paths based on the outcome of previous steps.

#### **Completion Handling**
- **Workflow Completion**:
  - A workflow is deemed complete when all steps that lead to an "end" condition (i.e., no further `after` steps) have been successfully executed.

---

### 3. **Error Handling and Tracing**

#### **Error Management**
- **Error Handling**:
  - Integrated mechanisms capture and manage errors during step execution. This can involve retrying steps, skipping steps, or aborting the workflow based on the workflow’s error-handling strategy.

#### **Tracing**
- **OpenTelemetry Integration**:
  - The system integrates with OpenTelemetry, tracing each step’s execution to provide detailed monitoring and logging. This allows for in-depth analysis and debugging of the workflow execution.

---

### 4. **Workflow Class (`WorkflowClass`)**

#### **Base Class for Workflows**
- **`WorkflowClass`**:
  - An abstract class that all workflows must extend. It provides foundational functionality for handling signals, queries, hooks, and step execution.
  - **`signalHandlers` and `queryHandlers`**:
    - These objects map signal and query names to their respective handler methods, allowing dynamic binding within the class.
  
  - **`bindQueriesAndSignals()`**:
    - This method sets up the signal and query handlers by iterating over the decorated methods in the class, binding them to Temporal.io handlers.
  
  - **`applyHooks(hooks)`**:
    - Sets up before and after hooks for specified methods, wrapping the original methods to ensure hooks are executed in the correct order.
  
  - **`forwardSignalToChildren(signalName, ...args)`**:
    - Forwards a signal to all child workflows, allowing for cascading signal handling.
  
  - **`execute(...args: unknown[])`**:
    - An abstract method that subclasses must implement to define the main workflow logic.
  
  - **Event Handling**:
    - The class extends `EventEmitter`, allowing workflows to emit and listen for events internally.

  - **Tracing and Logging**:
    - The `tracer` from OpenTelemetry is used for tracing workflow execution, wrapping the lifecycle in spans for detailed monitoring and logging.

---

### 5. **Dynamic Workflow Creation**

#### **Named Function for Workflow**
- **Dynamic Class Creation**:
  - If the class does not extend `WorkflowClass`, the decorator dynamically creates a new class that does. This ensures all workflows inherit the necessary functionality, even if the original class was not explicitly designed to extend `WorkflowClass`.
  
- **Workflow Function**:
  - The workflow function is dynamically created using `new Function()`, allowing it to be named dynamically based on the class or provided name. This function starts the workflow, binds queries and signals, and wraps the execution in an OpenTelemetry span, managing the workflow’s lifecycle.

---

### 6. **Additional Features**

#### **Pathway Management**
- **Branching Based on Step Return Values**:
  - The workflow allows for branching paths based on the return values of individual steps. This feature enables complex, dynamic workflows where the execution path can change based on conditions or results at each step.

#### **Completion Pathways**
- **Entry and Exit Steps**:
  - Entry steps are those without any `before` steps and are the initial points of execution in the workflow. Exit steps are those without any `after` steps, representing the final stages of the workflow.
  
- **Pathway Calculation**:
  - The workflow engine calculates the pathway to completion by ensuring all necessary steps are executed in sequence, considering dependencies,

 conditions, and branching paths.

---

### Summary

This Temporal workflow system in TypeScript integrates a wide array of features through a comprehensive set of decorators and a robust workflow execution engine. The system is designed to be flexible, allowing for easy definition of workflows with dynamic execution paths, detailed error handling, and integrated tracing. The use of decorators simplifies the management of steps, conditions, signals, queries, and hooks, while the workflow engine ensures that all steps are executed in the correct order, based on defined dependencies and conditions. This system is powerful enough to handle complex workflows while remaining easy to define, manage, and debug.

***Those who say it cannot be done, should stop interupting the people doing it.***
