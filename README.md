# ChronoForge

ChronoForge is an opensource framework for Temporal.io Workflows which integrates a wide array of features through a comprehensive set of decorators and a robust workflow execution engine. The system is designed to be flexible, allowing for easy definition of workflows with dynamic execution paths, detailed error handling, and integrated tracing. The use of decorators simplifies the management of steps, conditions, signals, queries, and hooks, while the workflow engine ensures that all steps are executed in the correct order, based on defined dependencies and conditions. This system is powerful enough to handle complex workflows while remaining easy to define, manage, and debug.

***Those who say it cannot be done should stop interrupting the people doing it.***

## Table of Contents

- [1. Workflow Decorators](#1-workflow-decorators)
  - [@ChronoFlow(options: { name?: string })](#chronoflowoptions--name-string-)
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
- [4. Workflow Class (`Workflow`)](#4-workflow-class-workflow)
  - [Base Class for Workflows](#base-class-for-workflows)
  - [Properties](#properties)
  - [Methods](#methods)
    - [constructor(params: any, options: { [key: string]: any })](#constructorparams-any-options--key-string-any-)
    - [condition(): boolean | Promise<boolean>](#condition-boolean--promiseboolean)
    - [execute(...args: unknown[]): Promise<unknown>](#executeargs-unknown-promiseunknown)
    - [bindQueriesAndSignals()](#bindqueriesandsignals)
    - [applyHooks(hooks: { before: { [name: string]: string[] }, after: { [name: string]: string[] } })](#applyhookshooks-before--name-string-string-after--name-string-string-)
    - [signal(signalName: string, ...args: unknown[]): Promise<void>](#signalsignalname-string-args-unknown-promisevoid)
    - [query(queryName: string, ...args: unknown[]): Promise<any>](#queryqueryname-string-args-unknown-promiseany)
    - [forwardSignalToChildren(signalName: string, ...args: unknown[]): Promise<void>](#forwardsignaltochildrensignalname-string-args-unknown-promisevoid)
    - [executeWorkflow(params: any): Promise<any>](#executeworkflowparams-any-promiseany)
    - [awaitCondition(): Promise<void>](#awaitcondition-promisevoid)
    - [isInTerminalState(): boolean](#isinterminalstate-boolean)
    - [handleMaxIterations(): Promise<void>](#handlemaxiterations-promisevoid)
    - [handlePause(): Promise<void>](#handlepause-promisevoid)
    - [handleExecutionError(err: any, span: any): Promise<void>](#handleexecutionerrorerr-any-span-any-promisevoid)
    - [executeSteps(): Promise<void>](#executesteps-promisevoid)
    - [executeStep(step: { name: string; method: string }): Promise<void>](#executestepstep--name-string-method-string-promisevoid)
    - [processDependentSteps(stepName: string): Promise<void>](#processdependentstepsstepname-string-promisevoid)
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

---
### 1. **Workflow Decorators**
---

#### **`@ChronoFlow(options: { name?: string })`**
- **Purpose**: Marks a class as a Temporal workflow within the ChronoForge system.
- **Parameters**:
  - **`name?: string`**: An optional custom name for the workflow. If not provided, the class name is used.
- **Behavior**:
  - Ensures that the class extends `Workflow`. If it doesn't, a dynamic class is created that does.
  - Serves as the entry point for the workflow, managing initialization, binding of queries and signals, and wrapping the workflow logic within an OpenTelemetry span for tracing.
- **Example**:

```typescript
@ChronoFlow()
class MyWorkflow extends Workflow {
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
  - Registers

 the method as a step within the workflow, managing dependencies and conditions to determine the order of execution.
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

### 4. **Workflow Class (`Workflow`)**

The `Workflow` class is the foundational abstract class that all workflows in the ChronoForge system must extend. It provides essential methods and properties that handle the core functionality of Temporal workflows, including signals, queries, hooks, step execution, and more. This section details all the methods and properties of the `Workflow` class.

#### **Base Class for Workflows**

The `Workflow` class provides the necessary infrastructure for defining and executing Temporal workflows. Below are the core methods and properties available in the `Workflow` class:

---

### **Properties**

- **`params: any`**
  - **Description**: Stores the parameters passed to the workflow upon instantiation. These parameters are typically used to configure the workflow's behavior.
  - **Type**: `any`

- **`options: { [key: string]: any }`**
  - **Description**: Stores optional configuration options that can influence the workflow's behavior, such as tracing settings or custom execution rules.
  - **Type**: `object`

- **`signalHandlers: { [key: string]: (args: any) => Promise<void> }`**
  - **Description**: Maps signal names to their corresponding handler methods. These handlers are dynamically bound based on the decorators used in the workflow class.
  - **Type**: `object`

- **`queryHandlers: { [key: string]: (...args: any) => any }`**
  - **Description**: Maps query names to their corresponding handler methods. These handlers are dynamically bound based on the decorators used in the workflow class.
  - **Type**: `object`

- **`handles: { [workflowId: string]: ReturnType<typeof workflow.getExternalWorkflowHandle> | workflow.ChildWorkflowHandle<any> }`**
  - **Description**: A collection of handles for child workflows or external workflows that the current workflow interacts with. These handles allow the workflow to send signals, make queries, or manage child workflows.
  - **Type**: `object`

- **`continueAsNew: boolean`**
  - **Description**: A flag indicating whether the workflow should continue as new after reaching certain conditions (e.g., max iterations).
  - **Type**: `boolean`
  - **Default**: `false`

- **`log: typeof log`**
  - **Description**: A reference to the Temporal logging system, allowing the workflow to log messages for debugging or monitoring purposes.
  - **Type**: `typeof log`

- **`steps: { name: string; method: string; on?: () => boolean; before?: string | string[]; after?: string | string[] }[]`**
  - **Description**: An array of step definitions within the workflow. Each step includes its name, the method it corresponds to, and optional conditions for execution and dependencies.
  - **Type**: `array`

- **`tracer: typeof trace.getTracer`**
  - **Description**: A reference to the OpenTelemetry tracer used for tracing workflow execution. This allows detailed monitoring and logging of workflow operations.
  - **Type**: `typeof trace.getTracer`

- **`iteration: number`**
  - **Description**: Tracks the current iteration count for the workflow loop, used in conjunction with `MAX_ITERATIONS` to manage workflow lifecycle.
  - **Type**: `number`
  - **Default**: `0`

- **`MAX_ITERATIONS: number`**
  - **Description**: The maximum number of iterations the workflow can execute before continuing as new. This helps manage long-running workflows.
  - **Type**: `number`
  - **Default**: `10000`

- **`status: string`**
  - **Description**: Tracks the current status of the workflow (e.g., `running`, `paused`, `complete`, `cancelled`, `errored`).
  - **Type**: `string`
  - **Default**: `running`

---

### **Methods**

- **`constructor(params: any, options: { [key: string]: any })`**
  - **Description**: Initializes a new instance of the `Workflow` class, setting up the parameters and options, and initializing properties like signal handlers, query handlers, and workflow handles.
  - **Parameters**:
    - `params`: Workflow-specific parameters passed during instantiation.
    - `options`: Optional configuration options for the workflow.

- **`condition(): boolean | Promise<boolean>`**
  - **Description**: An abstract method that must be implemented by subclasses. It defines a condition that determines whether the workflow should continue execution. This method is often used in loops or to await certain conditions before proceeding.
  - **Returns**: `boolean` or `Promise<boolean>`

- **`execute(...args: unknown[]): Promise<unknown>`**
  - **Description**: An abstract method that must be implemented by subclasses. It defines the main execution logic of the workflow. This method is invoked in each iteration of the workflow loop.
  - **Returns**: `Promise<unknown>`

- **`bindQueriesAndSignals()`**
  - **Description**: Binds the decorated signal and query handlers to their respective methods within the workflow. This method iterates over the `signalHandlers` and `queryHandlers` properties, setting up the necessary bindings with Temporal.
  - **Returns**: `void`

- **`applyHooks(hooks: { before: { [name: string]: string[] }, after: { [name: string]: string[] } })`**
  - **Description**: Applies before and after hooks to methods within the workflow. This method wraps the original methods with logic to ensure that hooks are executed in the correct order, providing a way to insert custom behavior around workflow steps.
  - **Parameters**:
    - `hooks`: An object defining the methods that should have hooks applied, with arrays of hook method names for `before` and `after` the target method.
  - **Returns**: `void`

- **`signal(signalName: string, ...args: unknown[]): Promise<void>`**
  - **Description**: Sends a signal to the workflow, triggering the corresponding signal handler. This method allows external entities to interact with the workflow by sending signals.
  - **Parameters**:
    - `signalName`: The name of the signal to be sent.
    - `args`: The arguments to be passed to the signal handler.
  - **Returns**: `Promise<void>`

- **`query(queryName: string, ...args: unknown[]): Promise<any>`**
  - **Description**: Executes a query against the workflow, returning the result from the corresponding query handler. This method allows external entities to retrieve information about the workflow's state.
  - **Parameters**:
    - `queryName`: The name of the query to be executed.
    - `args`: The arguments to be passed to the query handler.
  - **Returns**: `Promise<any>`

- **`forwardSignalToChildren(signalName: string, ...args: unknown[]): Promise<void>`**
  - **Description**: Forwards a signal to all child workflows managed by the current workflow. This method allows cascading signal handling, where a signal sent to a parent workflow is propagated to its children.
  - **Parameters**:
    - `signalName`: The name of the signal to be forwarded.
    - `args`: The arguments to be passed to the child workflows.
  - **Returns**: `Promise<void>`

- **`executeWorkflow(params: any): Promise<any>`**
  - **Description**: The main execution loop of the workflow. This method manages the lifecycle of the workflow, including conditionally continuing as new, executing steps, and handling workflow status changes.
  - **Parameters**:
    - `params`: The parameters passed to the workflow upon initialization.
  - **Returns**: `Promise<any>`

- **`awaitCondition(): Promise<void>`**
  - **Description**: Waits for a condition to be met before proceeding. This method uses the `condition()` method defined in the subclass or the workflow's internal state to determine when to continue.
  - **Returns**: `Promise<void>`

- **`isInTerminalState(): boolean`**
  - **Description**: Checks if the workflow is in a terminal state (i.e., `complete`, `cancelled`, `errored`). This method is used to determine if the workflow should stop execution.
  - **Returns**: `boolean`

- **`handleMaxIterations(): Promise<void>`**
  - **Description**: Handles the scenario where the workflow reaches its maximum iteration count. This method triggers a `continueAsNew` operation, allowing the workflow to restart with a clean state while retaining its parameters and status.
  - **Returns**: `Promise<void>`

- **`handlePause(): Promise<void>`**
  - **Description**: Manages the pause state of the workflow. This method sends a pause signal to all child workflows and awaits a change in status before resuming execution.
  - **Returns**: `Promise<void>`

- **`handleExecutionError(err: any, span: any): Promise<void>`**
  - **Description**: Handles errors that occur during workflow execution. This method manages cancellation, error logging, and retry logic based on the type of error encountered.
  - **Parameters**:
    - `err`: The error that occurred during execution.
    - `span`: The OpenTelemetry span associated with the current execution step.
  - **Returns**: `Promise<void>`

- **`executeSteps(): Promise<void>`**
  - **Description**: Executes the workflow's steps in the correct order based on their dependencies and conditions. This method manages the resolution of steps, ensuring they are executed in sequence.
  - **Returns**: `Promise<void>`

- **

`executeStep(step: { name: string; method: string }): Promise<void>`**
  - **Description**: Executes an individual step within the workflow. This method calls the corresponding method for the step and processes its result.
  - **Parameters**:
    - `step`: The step object containing the name and method to be executed.
  - **Returns**: `Promise<void>`

- **`processDependentSteps(stepName: string): Promise<void>`**
  - **Description**: Processes the steps that are dependent on a given step. This method ensures that after a step is executed, any steps that depend on it are also executed if their conditions are met.
  - **Parameters**:
    - `stepName`: The name of the step that has just been executed.
  - **Returns**: `Promise<void>`

---

#### Summary

The `Workflow` class in ChronoForge is a powerful and flexible foundation for building Temporal workflows in TypeScript. It provides the necessary tools for managing workflow execution, handling signals and queries, applying hooks, and processing complex step sequences. By extending this class, developers can create robust and maintainable workflows that integrate seamlessly with the Temporal.io platform and OpenTelemetry for tracing and monitoring.


---

### 5. **Dynamic Workflow Creation**

#### **Named Function for Workflow**
- **Dynamic Class Creation**:
  - If the class does not extend `Workflow`, the decorator dynamically creates a new class that does. This ensures all workflows inherit the necessary functionality, even if the original class was not explicitly designed to extend `Workflow`.
  
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
  - The workflow engine calculates the pathway to completion by ensuring all necessary steps are executed in sequence, considering dependencies, conditions, and branching paths.

---
