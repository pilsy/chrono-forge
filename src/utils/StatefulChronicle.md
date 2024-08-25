### **ChronoForge Stateful Chronicle Framework Specification**

This specification provides a comprehensive overview of the **ChronoForge Framework** and introduces you to the Chronicle. It details the `StatefulChronicleClass` and the `@StatefulChronicle` decorator, both of which enable advanced state management, dynamic child workflow orchestration, and subscription handling within the Temporal workflow system.

---

### **1. Overview**

The **ChronoForge Stateful Chronicle Framework** extends the capabilities of the standard ChronoForge workflow system by introducing stateful workflows that manage persistent state across workflow executions. This framework is particularly useful for complex workflows that involve dynamic state management, child workflows, and real-time subscription handling.

### **2. Stateful Chronicle Decorator**

#### **`@StatefulChronicle` Decorator**

- **Purpose**: The `@StatefulChronicle` decorator is used to mark a class as a stateful workflow within the ChronoForge framework. It ensures that the class extends the `StatefulChronicleClass` and handles advanced state management features.
  
- **Parameters**:
  - **`name?: string`**: An optional custom name for the workflow. If not provided, the class name is used.
  - **`schema?: Schema`**: An optional schema for data normalization. If provided, it is used to manage and normalize the workflow's state.

- **Behavior**:
  - Automatically extends the base `StatefulChronicleClass` if the decorated class does not already extend it.
  - Handles the instantiation of the workflow class and invokes the `executeWorkflow` method.
  - Manages state initialization based on the provided schema and input parameters.

### **3. Stateful Chronicle Execution Engine**

#### **State Initialization**

- **Purpose**: Initializes the state of the workflow, normalizing it based on the provided schema, if applicable.

- **Behavior**:
  - If a schema is provided and the input parameters include data, the state is normalized using the schema.
  - If no schema is provided but data is present, the state is initialized directly from the input data.

#### **State Management**

- **Purpose**: Manages the persistent state of the workflow across its execution. This includes handling updates, deletions, and maintaining consistency between parent and child workflows.

- **Behavior**:
  - The state is stored in a normalized format if a schema is provided.
  - Changes to the state (updates or deletions) are tracked and processed during workflow execution.
  - Child workflows are automatically managed based on the current state, with the ability to start, update, or cancel child workflows dynamically.

#### **Child Workflow Management**

- **Purpose**: Dynamically manages child workflows based on the state and schema. This includes starting, updating, and canceling child workflows as needed.

- **Behavior**:
  - Child workflows are started when new entities are detected in the state.
  - Existing child workflows are updated when relevant entities in the state change.
  - Child workflows are canceled when corresponding entities are removed from the state.

#### **Subscription Management**

- **Purpose**: Manages subscriptions to state changes, allowing workflows to react to specific changes within their state or external events.

- **Behavior**:
  - Subscriptions can be dynamically added or removed.
  - When a subscribed entity's state changes, the subscribed workflows are notified, triggering any necessary actions.

#### **Execution Flow**

- **Purpose**: Controls the execution of the workflow, including handling the workflow’s lifecycle, pausing and resuming execution, and managing iterations.

- **Behavior**:
  - The workflow can pause its execution based on external signals and then resume when conditions are met.
  - The workflow handles its lifecycle, managing the state and conditions that dictate whether the workflow should continue, pause, or terminate.
  - Iterations are tracked to ensure the workflow does not exceed a defined maximum number, with support for `continueAsNew` to reset the workflow state while retaining context.

#### **Error Handling**

- **Purpose**: Manages errors during the workflow's execution, ensuring that errors are handled gracefully and that the workflow can recover or terminate appropriately.

- **Behavior**:
  - Errors during execution are traced and logged using OpenTelemetry.
  - The workflow can handle errors by retrying, aborting, or transitioning to a terminal state.
  - Child workflows are also monitored for errors, with appropriate error handling strategies applied.

### **4. Stateful Chronicle Class (`StatefulChronicleClass`)**

#### **Base Class for Stateful Workflows**

- **Purpose**: The `StatefulChronicleClass` serves as the foundational class for stateful workflows in ChronoForge. It extends the `ChronicleClass` and provides additional functionality for managing state, subscriptions, and child workflows.

- **Key Properties**:
  - **`MAX_ITERATIONS`**: The maximum number of iterations the workflow is allowed to execute before it must continue as new.
  - **`state: EntitiesState`**: The current state of the workflow, typically normalized.
  - **`pendingChanges: any[]`**: A list of pending changes that need to be processed during execution.
  - **`subscriptions: Subscription[]`**: A list of subscriptions to state changes or external events.
  - **`managedPaths: ManagedPath[]`**: Paths in the state that are managed as child workflows.
  - **`status: ChronicleStatus`**: The current status of the workflow (e.g., running, paused, complete).
  - **`token?: string`**: An optional token used for authentication or data loading.
  - **`iteration: number`**: The current iteration count of the workflow.

#### **Key Methods**

- **`initializeState(params: any): void`**: Initializes the state based on the provided parameters and schema.
- **`getState(path?: string): EntitiesState`**: Retrieves the current state or a specific part of it.
- **`getStatus(): ChronicleStatus`**: Returns the current status of the workflow.
- **`getIteration(): number`**: Returns the current iteration count.
- **`getPendingChanges(): any[]`**: Returns the list of pending changes.
- **`getSubscriptions(): Subscription[]`**: Returns the list of current subscriptions.
- **`getManagedPaths(): ManagedPath[]`**: Returns the list of managed paths.
- **`getToken(): string`**: Returns the current token.
- **`setStatus({ status: ChronicleStatus }): void`**: Sets the status of the workflow.
- **`setToken({ token: string }): void`**: Sets the token for the workflow.
- **`update({ updates, entityName, strategy }: { updates: any; entityName: string; strategy?: string }): void`**: Handles updates to the state.
- **`delete({ deletions, entityName }: { deletions: any; entityName: string }): void`**: Handles deletions from the state.
- **`pause(): void`**: Pauses the workflow.
- **`resume(): void`**: Resumes the workflow.
- **`subscribe(subscription: Subscription): Promise<void>`**: Adds a new subscription.
- **`unsubscribe(subscription: Subscription): Promise<void>`**: Removes an existing subscription.
- **`processState(): Promise<void>`**: Processes the pending state changes, updating the state and managing child workflows accordingly.
- **`processChildState(newState: EntitiesState, differences: DetailedDiff): Promise<void>`**: Processes state changes related to child workflows, starting, updating, or canceling them as necessary.
- **`configureManagedPaths(parentSchema: Schema): void`**: Configures paths in the state to be managed as child workflows based on the provided schema.
- **`executeWorkflow(params: ChronicleParams): Promise<any>`**: Executes the workflow, handling the main execution loop, state management, and error handling.
- **`awaitCondition(): Promise<void>`**: Awaits a condition before proceeding with the next iteration of the workflow.
- **`handleMaxIterations(): Promise<void>`**: Handles the scenario where the workflow reaches its maximum iteration count.
- **`handlePause(): Promise<void>`**: Manages the pausing of the workflow and the resumption of execution.
- **`handleExecutionError(err: any, span: any): Promise<void>`**: Handles errors that occur during workflow execution.

### **5. Dynamic Stateful Workflow Creation**

#### **Dynamic Class Extension**

- **Purpose**: The `@StatefulChronicle` decorator automatically extends the base `StatefulChronicleClass` if the decorated class does not already extend it. This ensures that the necessary stateful features are available.

- **Behavior**:
  - The decorated class is dynamically extended to include state management features if needed.
  - The workflow is instantiated with the proper initialization logic, ensuring that state and subscriptions are correctly set up.

#### **Named Function for Workflow**

- **Purpose**: Creates a dynamically named function for the workflow, managing its lifecycle and ensuring proper integration with the stateful execution engine.

- **Behavior**:
  - The workflow function is dynamically generated and named based on the class or provided name.
  - The function manages the instantiation and execution of the workflow, ensuring that all necessary setup and teardown processes are handled.

### **6. Additional Features**

#### **Error Handling and Tracing**

- **Purpose**: Integrates with OpenTelemetry to trace the execution of the workflow and manage errors effectively.

- **Behavior**:
  - Each step of the workflow is traced using OpenTelemetry, capturing detailed logs and metrics.
  - Errors are captured, logged, and handled based on predefined strategies, ensuring that workflows can either recover or fail gracefully.

### **7. Summary**

The **ChronoForge Stateful Chronicle Framework** provides a robust foundation for managing complex, stateful workflows. It extends the capabilities of standard workflows by introducing dynamic state management, child workflow orchestration, and subscription handling. These features enable the creation of powerful, adaptable workflows that can handle intricate processes and dynamic data flows with ease. The integration with OpenTelemetry ensures that all aspects of the workflow can be monitored and traced, providing valuable insights into their operation.
