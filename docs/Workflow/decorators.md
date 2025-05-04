# Decorators in ChronoForge

## Introduction to Decorators in ChronoForge

Decorators are a core feature in the ChronoForge framework that provide a declarative way to define and manage workflow behaviors in Temporal. In ChronoForge, several decorators are provided to simplify the development of workflows by enabling features like signal handling, query management, error handling, and lifecycle management. These decorators allow developers to add functionality to their workflow classes without requiring boilerplate code, making the code more readable, maintainable, and expressive.

This document provides an overview of the decorators provided by ChronoForge. For a comprehensive reference with categorization and examples, see the [ChronoForge Decorators Reference](./decorators_index.md).

## List of Decorators

1. [**`@Temporal` Decorator**](./temporal_decorator.md)
2. [**`@Signal` Decorator**](./signal_decorator.md)
3. [**`@Query` Decorator**](./query_decorator.md)
4. [**`@Hook` Decorator**](./hook_decorator.md)
5. [**`@Before` and `@After` Decorators**](#before-and-after-decorators)
6. [**`@Property` Decorator**](#property-decorator)
7. [**`@Step` Decorator**](../Step.md)
8. [**`@Action` Decorator**](./action_decorator.md)
9. [**`@Validator` Decorator**](./action_decorator.md#validating-actions-with-validator)
10. [**`@On` Decorator**](./on_decorator.md)
11. [**`@Guard` Decorator**](./guard_decorator.md)
12. [**`@Mutex` Decorator**](./mutex_decorator.md)
13. [**`@Debounce` Decorator**](./debounce_decorator.md)

---

## 1. `@Temporal` Decorator

- **Purpose**: The `@Temporal` decorator is used to register a class as a Temporal workflow within the ChronoForge framework. It ensures that the class is properly recognized by Temporal and is ready for execution.
- **Key Features**:
  - Registers the class as a workflow with Temporal.
  - Configures necessary metadata and setup for the workflow.
  - Handles dynamic class creation if the class doesn't extend `Workflow`.
  - Manages workflow naming and task queue assignment.
- **Usage**: This decorator must be applied to every workflow class to make it discoverable by Temporal.
- **Detailed Documentation**: See [@Temporal Decorator](./temporal_decorator.md) for more information.

## 2. `@Signal` Decorator

- **Purpose**: The `@Signal` decorator is used to define signal handlers within a workflow. Signals are asynchronous messages that can be sent to a running workflow to trigger specific actions or state updates.
- **Key Features**:
  - Marks a method as a signal handler.
  - Allows workflows to react to external events or inputs dynamically.
  - Supports custom signal naming.
- **Usage**: Place the `@Signal` decorator above a method to register it as a signal handler.
- **Detailed Documentation**: See [@Signal Decorator](./signal_decorator.md) for more information.

## 3. `@Query` Decorator

- **Purpose**: The `@Query` decorator is used to define query handlers within a workflow. Queries are synchronous requests that allow external systems to retrieve the current state or computed values from a running workflow.
- **Key Features**:
  - Marks a method as a query handler.
  - Enables synchronous data retrieval without altering the workflow state.
  - Supports custom query naming.
- **Usage**: Place the `@Query` decorator above a method to register it as a query handler.
- **Detailed Documentation**: See [@Query Decorator](./query_decorator.md) for more information.

## 4. `@Hook` Decorator

- **Purpose**: The `@Hook` decorator is used to define lifecycle hooks that run before or after specific methods in a workflow. Hooks provide a way to inject custom logic at key points during workflow execution.
- **Key Features**:
  - Registers a method as a lifecycle hook that runs before or after another method.
  - Supports pre- and post-execution logic for cross-cutting concerns such as logging, validation, and monitoring.
- **Usage**: Place the `@Hook` decorator above a method to register it as a hook for another method.
- **Detailed Documentation**: See [@Hook Decorator](./hook_decorator.md) for more information.

## 5. `@Before` and `@After` Decorators

- **Purpose**: The `@Before` and `@After` decorators are simplified versions of the `@Hook` decorator, making it easier to define hooks that run before or after specific methods.
- **Key Features**:
  - `@Before(targetMethod)`: Registers a method to run before the specified target method.
  - `@After(targetMethod)`: Registers a method to run after the specified target method.
- **Usage**: Place the decorator above a method to register it as a hook.
- **Example**:

  ```typescript
  import { Workflow, Before, After, Temporal } from 'chrono-forge';

  @Temporal()
  class ExampleWorkflow extends Workflow {
    @Before('execute')
    protected async logBeforeExecution() {
      console.log('Before executing...');
    }

    @After('execute')
    protected async logAfterExecution() {
      console.log('After executing...');
    }

    protected async execute() {
      console.log('Executing...');
    }
  }
  ```

## 6. `@Property` Decorator

- **Purpose**: The `@Property` decorator simplifies the creation of properties with associated query and signal handlers, allowing external systems to get and set property values.
- **Key Features**:
  - Automatically creates query handlers for getting property values.
  - Automatically creates signal handlers for setting property values.
  - Supports custom naming for query and signal handlers.
- **Usage**: Place the `@Property` decorator above a class property.
- **Example**:

  ```typescript
  import { Workflow, Property, Temporal } from 'chrono-forge';

  @Temporal()
  class ExampleWorkflow extends Workflow {
    @Property()
    protected status: string = 'running';

    @Property({ get: 'getCustomStatus', set: false })
    protected internalStatus: string = 'initialized';

    protected async execute() {
      // The status property can be queried with 'status' and set with 'status'
      // The internalStatus property can be queried with 'getCustomStatus' but cannot be set
    }
  }
  ```

## 7. `@Step` Decorator

- **Purpose**: The `@Step` decorator is used to define methods as steps within a workflow, allowing for complex execution flows based on dependencies and conditions.
- **Key Features**:
  - Defines execution order with `before` and `after` dependencies.
  - Supports conditional execution with the `on` function.
  - Provides retry logic with the `retries` option.
  - Handles timeouts with the `timeout` option.
  - Supports custom error handling with the `onError` option.
- **Usage**: Place the `@Step` decorator above a method to register it as a workflow step.
- **Detailed Documentation**: See [@Step Decorator](../Step.md) for more information.

## 8. `@Action` Decorator

- **Purpose**: The `@Action` decorator defines typed, executable business logic operations within a workflow, particularly in `StatefulWorkflow` classes.
- **Key Features**:
  - Provides type safety with explicit input and output types
  - Controls execution flow with blocking/non-blocking options
  - Integrates with the state management system
  - Supports traceability for operations performed on workflow state
- **Usage**: Place the `@Action` decorator above a method to register it as an action handler.
- **Detailed Documentation**: See [@Action Decorator](./action_decorator.md) for more information.

## 9. `@Validator` Decorator

- **Purpose**: The `@Validator` decorator provides a way to validate inputs before action execution, complementing the `@Action` decorator.
- **Key Features**:
  - Type-safe validation for action inputs
  - Automatic validation before action execution
  - Clear error propagation for invalid inputs
- **Usage**: Place the `@Validator` decorator above a method to register it as a validator for a specific action.
- **Detailed Documentation**: See [Action Validator Documentation](./action_decorator.md#validating-actions-with-validator) for more information.

## 10. `@On` Decorator

- **Purpose**: The `@On` decorator registers methods as event handlers for specific events in the workflow system.
- **Key Features**:
  - Supports workflow events, state events, and lifecycle events
  - Enables event-driven, reactive workflow design
  - Supports pattern matching with wildcards
  - Facilitates loose coupling between components
- **Usage**: Place the `@On` decorator above a method to register it as an event handler.
- **Detailed Documentation**: See [@On Decorator](./on_decorator.md) for more information.

## 11. `@Guard` Decorator

- **Purpose**: The `@Guard` decorator protects method execution with conditional checks, acting as a gatekeeper for method invocation.
- **Key Features**:
  - Enforces preconditions for method execution
  - Provides runtime validation without cluttering method implementation
  - Supports both synchronous and asynchronous guard functions
  - Separates validation logic from business logic
- **Usage**: Place the `@Guard` decorator above a method to add conditional execution.
- **Detailed Documentation**: See [@Guard Decorator](./guard_decorator.md) for more information.

## 12. `@Mutex` Decorator

- **Purpose**: The `@Mutex` decorator ensures exclusive method execution, preventing concurrent access to critical sections of code.
- **Key Features**:
  - Thread safety through exclusive method execution
  - Support for named mutexes to coordinate related operations
  - Instance-level locking scope
  - Automatic lock release, even on errors
- **Usage**: Place the `@Mutex` decorator above a method to ensure exclusive execution.
- **Detailed Documentation**: See [@Mutex Decorator](./mutex_decorator.md) for more information.

## 13. `@Debounce` Decorator

- **Purpose**: The `@Debounce` decorator limits how often a method can be called, ensuring only the last invocation within a specified time period is executed.
- **Key Features**:
  - Rate limiting for method execution
  - Last-call execution pattern for rapid events
  - Resource optimization for expensive operations
  - Integration with Temporal's cancellation system
- **Usage**: Place the `@Debounce` decorator above a method to control execution frequency.
- **Detailed Documentation**: See [@Debounce Decorator](./debounce_decorator.md) for more information.

## Conclusion

The decorators provided by ChronoForge are essential tools for building robust and maintainable workflows. They enable developers to define key behaviors declaratively, reducing boilerplate code and improving readability. By leveraging these decorators, developers can focus on the core business logic of their workflows while ensuring that critical concerns like error handling, signal management, state management, and execution control are handled consistently and efficiently.

For a comprehensive reference with categorization and usage examples, see the [ChronoForge Decorators Reference](./decorators_index.md).
