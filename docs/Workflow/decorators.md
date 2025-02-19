### **Decorators Provided by `Workflow.ts`**

#### **Introduction to Decorators in `Workflow.ts`**

Decorators are a core feature in the ChronoForge framework that provide a declarative way to define and manage workflow behaviors in Temporal. In `Workflow.ts`, several decorators are provided to simplify the development of workflows by enabling features like signal handling, query management, error handling, and lifecycle management. These decorators allow developers to add functionality to their workflow classes without requiring boilerplate code, making the code more readable, maintainable, and expressive.

This document provides an overview of all the decorators provided by `Workflow.ts`, their purposes, and links to detailed documentation for each decorator.

#### **List of Decorators**

1. [**`@Temporal` Decorator**](./temporal_decorator.md)
2. [**`@Signal` Decorator**](./signal_decorator.md)
3. [**`@Query` Decorator**](./query_decorator.md)
4. [**`@OnError` Decorator**](./error_handling.md)
5. [**`@Hook` Decorator** (Speculative)](./hook_decorator.md)

---

### **1. `@Temporal` Decorator**

- **Purpose**: The `@Temporal` decorator is used to register a class as a Temporal workflow within the ChronoForge framework. It ensures that the class is properly recognized by Temporal and is ready for execution.
- **Key Features**:
  - Registers the class as a workflow with Temporal.
  - Configures necessary metadata and setup for the workflow.
- **Usage**: This decorator must be applied to every workflow class to make it discoverable by Temporal.
- **Detailed Documentation**: See [@Temporal Decorator](./temporal_decorator.md) for more information.

### **2. `@Signal` Decorator**

- **Purpose**: The `@Signal` decorator is used to define signal handlers within a workflow. Signals are asynchronous messages that can be sent to a running workflow to trigger specific actions or state updates.
- **Key Features**:
  - Marks a method as a signal handler.
  - Allows workflows to react to external events or inputs dynamically.
- **Usage**: Place the `@Signal` decorator above a method to register it as a signal handler.
- **Detailed Documentation**: See [@Signal Decorator](./signal_decorator.md) for more information.

### **3. `@Query` Decorator**

- **Purpose**: The `@Query` decorator is used to define query handlers within a workflow. Queries are synchronous requests that allow external systems to retrieve the current state or computed values from a running workflow.
- **Key Features**:
  - Marks a method as a query handler.
  - Enables synchronous data retrieval without altering the workflow state.
- **Usage**: Place the `@Query` decorator above a method to register it as a query handler.
- **Detailed Documentation**: See [@Query Decorator](./query_decorator.md) for more information.

### **4. `@OnError` Decorator**

- **Purpose**: The `@OnError` decorator is used to define custom error handlers for specific workflow methods or for global error handling. It allows workflows to handle errors in a structured and controlled manner.
- **Key Features**:
  - Registers a method as an error handler for a specific method or globally.
  - Enables custom error handling logic, retries, and cleanup actions.
- **Usage**: Place the `@OnError` decorator above a method to register it as an error handler for another method.
- **Detailed Documentation**: See [@OnError Decorator](./error_handling.md) for more information.

### **5. `@Hook` Decorator** (Speculative)

- **Purpose**: The `@Hook` decorator is used to define lifecycle hooks that run before or after specific methods in a workflow. Hooks provide a way to inject custom logic at key points during workflow execution.
- **Key Features**:
  - Registers a method as a lifecycle hook that runs before or after another method.
  - Supports pre- and post-execution logic for cross-cutting concerns such as logging, validation, and monitoring.
- **Usage**: Place the `@Hook` decorator above a method to register it as a hook for another method.
- **Detailed Documentation**: See [@Hook Decorator](./hook_decorator.md) for more information.

### **Conclusion**

The decorators provided by `Workflow.ts` are essential tools for building robust and maintainable workflows in ChronoForge. They enable developers to define key behaviors declaratively, reducing boilerplate code and improving readability. By leveraging these decorators, developers can focus on the core business logic of their workflows while ensuring that critical concerns like error handling, signal management, and lifecycle control are handled consistently and efficiently.

To learn more about each decorator and how to use them effectively in your workflows, refer to the detailed documentation linked above.
