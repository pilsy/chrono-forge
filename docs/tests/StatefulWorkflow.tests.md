### Comprehensive Test Cases for `StatefulWorkflow`

#### **1. State Management**

- **State Initialization**
  - Initialize state with default values.
  - Initialize state with provided data.
  - Initialize state using schema normalization.

- **State Querying**
  - Query entire state.
  - Query nested state by path.
  - Query state with non-existing path (should return undefined or default).

- **State Updates**
  - Update state with `$merge` strategy.
  - Update state with `$set` strategy.
  - Update nested state values.
  - Attempt invalid state update (invalid path or type).

- **State Preservation Across Workflow Executions**
  - State consistency after workflow completion.
  - State consistency after `continueAsNew`.

- **State Differences and Notification**
  - Detect differences between previous and current states.
  - Notify subscribers on state change.
  - Ensure no notification when state is unchanged.

---

#### **2. Child Workflow Management**

- **Child Workflow Initialization and Management**
  - Automatically start child workflows based on state changes.
  - Update existing child workflows when parent state changes.
  - Cancel child workflows when their corresponding state is removed.

- **Child Workflow Synchronization**
  - Bi-directional state synchronization between parent and child workflows.
  - Ensure parent updates are reflected in child workflows.
  - Ensure child updates are propagated back to the parent workflow.

- **Managed Path Configuration**
  - Properly configure managed paths based on schema.
  - Handle incorrect or missing path configurations gracefully.

- **Child Workflow Lifecycle Management**
  - Proper start and termination of child workflows.
  - Retry logic for starting or signaling child workflows.
  - Handle errors during child workflow management.

---

#### **3. Dynamic Subscription Handling**

- **Dynamic Subscription Setup and Teardown**
  - Dynamically subscribe to a new state path.
  - Unsubscribe from an existing state path.
  - Handle multiple subscriptions for the same path.

- **Subscription with Wildcards**
  - Support wildcard subscriptions (e.g., subscribing to all paths under a given root).
  - Handle overlapping subscriptions (e.g., specific path and wildcard subscription).

- **Notification to Subscribers**
  - Notify all subscribers when the subscribed path is updated.
  - Ensure notifications are accurate and contain the correct data.
  - Handle subscriber errors during notifications.

- **Wildcard and Path Matching Logic**
  - Match paths correctly using wildcard patterns.
  - Handle edge cases in path matching (e.g., special characters, empty paths).

---

#### **4. Hooks for Method Interception**

- **Before Hook Execution**
  - Execute `before` hook for a specific method.
  - Prevent main method execution if `before` hook fails or returns early.
  - Ensure `before` hook receives the correct arguments.

- **After Hook Execution**
  - Execute `after` hook for a specific method.
  - Ensure `after` hook runs even if the main method fails.
  - Validate the `after` hook's ability to modify the result or state.

- **Combined Hooks Execution**
  - Execute both `before` and `after` hooks around a method.
  - Validate order of execution for `before`, main method, and `after`.
  - Test multiple hooks on the same method.

---

#### **5. Event Emission and Handling**

- **Event Emission**
  - Emit a custom event within the workflow.
  - Emit an event with payload data and ensure handlers receive it.

- **Event Handling**
  - Bind methods to specific events using the `@On` decorator.
  - Handle events conditionally based on workflow type or event type.
  - Ensure event handlers run in the correct order and context.

- **Event Propagation and Filtering**
  - Test event propagation to child workflows.
  - Handle events selectively based on filters (e.g., specific workflow type).

---

#### **6. Error Handling with @OnError**

- **Custom Error Handling for Methods**
  - Register a custom error handler for a specific method.
  - Ensure the error handler receives the correct error object.
  - Verify that the error handler can prevent workflow termination.

- **Global Error Handling**
  - Define a global error handler for the entire workflow.
  - Ensure uncaught errors trigger the global handler.
  - Validate that the global error handler can take corrective actions.

- **Error Recovery and Resumption**
  - Test the workflow's ability to resume after an error.
  - Ensure error handlers can trigger recovery mechanisms (e.g., retry logic).

---

#### **7. Support for continueAsNew**

- **Continuation Conditions**
  - Automatically continue as a new workflow after a specific number of iterations.
  - Continue as new based on custom conditions (e.g., state size or specific flag).

- **State and Subscription Preservation**
  - Ensure state is preserved correctly across new workflow instances.
  - Validate that subscriptions are maintained after `continueAsNew`.

- **Continuation Error Handling**
  - Handle errors during the `continueAsNew` process.
  - Ensure workflow does not lose data if `continueAsNew` fails.

---

#### **8. Signal Forwarding to Child Workflows**

- **Automatic Signal Forwarding**
  - Automatically forward specific signals from the parent to child workflows.
  - Validate child workflows receive signals and react accordingly.

- **Selective Signal Forwarding**
  - Use decorators to control which signals are forwarded.
  - Handle conflicting signal forwarding rules (e.g., parent-child circular signals).

- **Signal Forwarding with Dynamic Subscriptions**
  - Combine signal forwarding with dynamic subscription handling.
  - Test wildcard signal forwarding to multiple child workflows.

---

#### **9. General Workflow Tests**

- **Workflow Initialization**
  - Initialize a workflow with minimal parameters.
  - Initialize a workflow with comprehensive parameters (e.g., state, subscriptions, managed paths).

- **Workflow Execution Logic**
  - Execute the core logic of the workflow (`execute` method).
  - Handle exceptions during workflow execution.

- **Pause and Resume Workflow**
  - Signal the workflow to pause and ensure all operations halt.
  - Signal the workflow to resume and verify it continues from the paused state.

- **Workflow Termination Scenarios**
  - Test graceful workflow termination.
  - Handle forced termination or cancellation scenarios.

- **Concurrency and Synchronization**
  - Ensure multiple signals and events are processed without race conditions.
  - Validate thread-safety and synchronization when managing child workflows and state updates.

<!-- @import "[TOC]" {cmd="toc" depthFrom=1 depthTo=6 orderedList=false} -->
