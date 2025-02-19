### **`@Action` Decorator**

#### **Introduction to the `@Action` Decorator**

The `@Action` decorator is a core feature in the ChronoForge framework that allows developers to define typed, executable actions within a workflow. Actions represent discrete units of business logic that can be executed as part of the workflow's operation, with optional type safety and execution control.

#### **Purpose of the `@Action` Decorator**

- **Defines Executable Actions**: The primary purpose of the `@Action` decorator is to register a method as an executable action within a workflow, making it available for orchestration and execution.
- **Enables Type Safety**: Actions can be configured with input and output types, providing compile-time type checking and better IDE support.
- **Controls Execution Flow**: Actions can be configured as blocking or non-blocking, affecting how they impact workflow execution.

#### **How the `@Action` Decorator Works**

When the `@Action` decorator is applied to a method in a workflow class, it performs the following:

1. **Registers the Method as an Action**: The method is registered in the workflow's metadata as an executable action.
2. **Configures Execution Behavior**: Sets up whether the action blocks workflow execution.
3. **Establishes Type Definitions**: When provided, associates input and output type definitions with the action.

#### **Configuration Options**

The `@Action` decorator accepts an optional configuration object with the following properties:

- **`blocking`**: Boolean flag indicating whether the action blocks workflow execution
- **`inputType`**: Type definition for the action's input parameters
- **`outputType`**: Type definition for the action's return value

#### **Usage Examples**

##### **Basic Action Definition**
