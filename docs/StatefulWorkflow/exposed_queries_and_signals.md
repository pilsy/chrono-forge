[< Previous](./state_management_and_data_normalization.md) | [Table of Contents](./table_of_contents.md#table-of-contents) | [Next >](./dynamic_data_loading_and_api_integration.md)

---

### 5: Exposed Queries and Signals in `StatefulWorkflow`

`StatefulWorkflow` provides a set of built-in queries and signals that allow developers to interact with and control workflows dynamically. These queries and signals are crucial for retrieving information about the workflow’s state, managing API credentials, and modifying the workflow’s behavior based on real-time changes. This section details each exposed query and signal, explaining its purpose and how it can be used to enhance workflow management.

#### Exposed Queries

Queries in `StatefulWorkflow` allow you to retrieve information about the current state and configuration of a workflow. These queries are read-only and are essential for monitoring and managing workflows without making any changes to their state.

1. **`id`**
   - **Description**: Returns the unique identifier (`id`) for the workflow instance. This is useful for identifying and managing individual workflow instances, especially when dealing with multiple workflows in a distributed system.

2. **`entityName`**
   - **Description**: Retrieves the `entityName` managed by the workflow, such as `User` or `Post`. This helps to identify the type of entities the workflow is responsible for, which is crucial for understanding the scope and focus of the workflow's operations.

3. **`state`**
   - **Description**: Provides the current state of all entities managed by the workflow. This query is crucial for understanding the workflow's data context and monitoring how the workflow evolves over time.

4. **`pendingChanges`**
   - **Description**: Returns the list of pending changes that have not yet been processed. This query is useful for monitoring the state management flow, debugging issues, and understanding the current state of updates within the workflow.

5. **`subscriptions`**
   - **Description**: Retrieves the current list of active subscriptions to state changes from other workflows. This helps to see which workflows are being listened to for state changes, providing insight into the workflow's dependencies and interactions.

6. **`managedPaths`**
   - **Description**: Provides the configuration of `managedPaths`, showing which child workflows and relationships are managed by this workflow. This query is helpful for debugging and understanding how the workflow is set up to handle various entities and relationships.

7. **`apiUrl`**
   - **Description**: Returns the current API URL used for making external data requests. This is useful for debugging or confirming which data source the workflow is configured to use, ensuring that it is pointing to the correct endpoint.

8. **`params`**
   - **Description**: Returns the parameters the workflow was started with, **without `apiToken`** (since 2.0; 1.x returned the token too).

Since 2.0 there is no `apiToken` query, and the token is no longer written to the memo: both are readable by anyone with read access to the namespace. The token still reaches child workflows through their arguments, and the `apiToken` signal below still rotates it.

#### Exposed Signals

Signals in `StatefulWorkflow` allow external systems or other workflows to interact with a workflow dynamically, modifying its state or behavior. These signals provide the flexibility needed to handle various scenarios in real-time, such as changing API credentials, updating the workflow state, or managing subscriptions.

1. **`apiToken`**
   - **Description**: Sets the `apiToken` for the workflow and propagates it to all direct children. This signal is essential for synchronizing API tokens across all workflows interacting with external APIs, ensuring secure and consistent access.

Since 2.0 there is no `apiUrl` signal. A signal could point the workflow at another server while it kept sending the real token, so `apiUrl` is set only at start, from the workflow's start parameters or its `@Temporal` options. (Children take theirs the same way; a parent does not pass its `apiUrl` down.)

2. **`update`**
   - **Description**: Updates the workflow's state with new data or changes. This signal is crucial for dynamic state management and ensuring the workflow remains in sync with new information from external sources or other workflows.

3. **`delete`**
   - **Description**: Removes specified entities from the workflow's state. This is important for cleaning up and optimizing the workflow state by removing unneeded data, thereby maintaining an efficient and accurate state representation.

4. **`subscribe`** (opt-in since 2.0)
   - **Description**: Subscribes the workflow to state changes from another workflow. This signal allows the workflow to dynamically listen and react to changes in related workflows, ensuring that it remains responsive to the broader context of the system.

5. **`unsubscribe`** (opt-in since 2.0)
   - **Description**: Unsubscribes the workflow from listening to another workflow's state changes. This signal is useful for managing and cleaning up unnecessary subscriptions, reducing overhead, and preventing potential data synchronization issues.

Since 2.0, `subscribe` and `unsubscribe` are registered only with `@Temporal({ subscribeSignals: true })`. Signals don't say who sent them, so otherwise anyone who can signal the workflow could make it send its state to any workflow ID. Subscriptions passed in the start parameters, which is how parents and children subscribe to each other, work either way.

The base `Workflow`'s `pause`, `resume` and `cancel` signals are likewise registered only with `@Temporal({ controlSignals: true })`; see the [migration guide](../../MIGRATION-2.0.md).

#### Summary

`StatefulWorkflow` provides a comprehensive set of exposed queries and signals that facilitate robust interaction and management of workflows in a distributed system. By leveraging these queries and signals, developers can effectively monitor workflows, manage state changes, handle API credentials, and dynamically adjust workflow behavior, ensuring efficient and secure workflow orchestration.

---

[< Previous](./state_management_and_data_normalization.md) | [Table of Contents](./table_of_contents.md#table-of-contents) | [Next >](./dynamic_data_loading_and_api_integration.md)
