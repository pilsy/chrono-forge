[< Previous](./getting_started.md) | [Table of Contents](./StatefulWorkflow.md) | [Next >](./state_management_and_data_normalization.md)

---

### 3: Defining Workflow Relationships with `managedPaths`

`managedPaths` is a central concept in `StatefulWorkflow` that defines how workflows manage relationships with other entities and child workflows. It provides a powerful way to configure and automate the creation, synchronization, and management of child workflows, ensuring that the entire workflow hierarchy operates cohesively.

#### Introduction to `managedPaths`

`managedPaths` is a configuration object that outlines the relationships a workflow manages, specifying how child workflows should be started, updated, or canceled based on changes in the parent workflow's state. Each entry in `managedPaths` represents an entity type that the parent workflow manages, along with specific rules and configurations that dictate how child workflows for that entity type are handled.

Key components of `managedPaths` include:
- **`autoStartChildren`**: A boolean flag indicating whether child workflows should be started automatically when changes are detected in the parent workflow's state.
- **`workflowType`**: The type of child workflow to instantiate. This is typically another class that extends `StatefulWorkflow`.
- **`entityName`**: The type of entity the workflow is responsible for managing (e.g., `User`, `Listing`).
- **`url`**: An optional parameter that specifies the URL for API requests associated with the entity.
- **`apiToken`**: An optional boolean flag indicating whether an API token is required for the workflow to access external APIs.

#### Configuration and Examples

To configure `managedPaths`, you define it as a protected property within your custom `StatefulWorkflow` class. This configuration determines how the workflow will handle its relationships with other entities and what actions it will take upon detecting state changes.

**Example of `managedPaths` Configuration:**

```typescript
import { StatefulWorkflow } from 'chrono-forge';
import { User } from '../schema';  // Import the User schema

@ChronoForge({ schema: User })
export class UserWorkflow extends StatefulWorkflow {
  // Define managedPaths to configure child workflows and relationships
  protected managedPaths: ManagedPaths = {
    listings: {
      autoStartChildren: true,  // Automatically start child workflows
      workflowType: 'ListingWorkflow',  // Type of child workflow to start
      entityName: 'Listing',  // Entity type managed by the child workflow
      url: '/api/v1/listing',  // URL for API requests related to this entity
      apiToken: true  // Indicates that an API token is required
    }
  };

  // Additional workflow logic and methods here
}
```

In this example:
- `managedPaths` is configured to manage `Listing` entities as child workflows.
- The `autoStartChildren` flag is set to `true`, meaning that whenever a new `Listing` entity is detected in the parent workflow's state, a child workflow of type `ListingWorkflow` will be automatically started.
- The `url` and `apiToken` parameters define how API requests are handled for this entity.

#### Managing Relationships and Dependencies

`managedPaths` is particularly powerful in scenarios where a workflow needs to manage complex relationships and dependencies between entities. It allows the workflow to dynamically create, update, or remove child workflows based on the state of the parent workflow, ensuring that all related entities are kept in sync.

**Key Aspects of Managing Relationships with `managedPaths`:**

1. **Dynamic Child Workflow Management**: By configuring `managedPaths`, workflows can dynamically manage child workflows based on the current state. This means that when a new entity is added, updated, or deleted, the parent workflow can automatically start, update, or cancel the corresponding child workflow.
   
2. **Entity Type and Schema Management**: The `entityName` defined in `managedPaths` allows the workflow to manage different types of entities. The associated schema is used to normalize incoming data and maintain a consistent internal state across all workflows.

3. **API Integration and Token Management**: The `url` and `apiToken` properties in `managedPaths` provide a seamless way to manage API integrations for child workflows. When a parent workflow starts a child workflow, it can propagate necessary configurations like API URLs and tokens, ensuring secure and consistent data access.

4. **Delegation of Responsibilities**: In hierarchical workflows, `managedPaths` can be configured to delegate responsibilities to specific child workflows. This delegation is crucial for managing complex data flows and dependencies, as it allows each workflow to focus on its specific domain while still collaborating with others in the hierarchy.

#### Auto-Starting Child Workflows

One of the most powerful features of `managedPaths` is the ability to auto-start child workflows based on changes in the parent workflow's state. This is controlled by the `autoStartChildren` flag within each `managedPaths` entry.

**How Auto-Starting Works:**

- When `autoStartChildren` is set to `true`, the parent workflow continuously monitors its internal state for changes. If a new entity is added or an existing entity is updated, it checks the `managedPaths` configuration to determine if a child workflow should be started.
- If the conditions are met, the parent workflow uses Temporal's `workflow.startChild()` API to instantiate a new child workflow of the specified `workflowType`.
- The parent workflow passes the necessary initialization parameters, such as entity data, API URLs, and tokens, to the child workflow, ensuring it is fully equipped to manage its assigned responsibilities.

**Example of Auto-Starting a Child Workflow:**

```typescript
protected async startChildWorkflow(config: ManagedPath, state: any): Promise<void> {
  this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:startChildWorkflow`);
  try {
    const { workflowType, entityName, idAttribute } = config;
    const entitySchema = SchemaManager.getInstance().getSchema(entityName as string);
    const { [idAttribute as string]: id } = state;
    const workflowId = `${entityName}-${id}`;
    const data = denormalize(state, entitySchema, this.state);  // Use SchemaManager for denormalization

    this.handles[workflowId] = await workflow.startChild(workflowType as string, {
      workflowId,
      args: [
        {
          id,
          data,
          entityName,
          subscriptions: [
            {
              workflowId: workflow.workflowInfo().workflowId,
              signalName: 'update',
              selector: '*'
            }
          ]
        }
      ]
    });
    this.emit(`childStarted:${workflowType}`, workflowId, data);
  } catch (err) {
    this.log.error(`[${this.constructor.name}] Failed to start new child workflow: ${err.message}`);
  }
}
```

In this example:
- The `startChildWorkflow` method is called when the parent workflow detects a relevant state change.
- It uses the `workflow.startChild()` API to create a new child workflow and passes in the necessary data and configuration.
- The child workflow is now active and will manage its state based on the data and rules defined in the parent workflow's `managedPaths`.

#### Summary

`managedPaths` is a powerful configuration mechanism that enables `StatefulWorkflow` to dynamically manage relationships and dependencies between entities. By defining rules for auto-starting, updating, and canceling child workflows, `managedPaths` ensures that workflows remain synchronized and operate efficiently within a hierarchical structure. This flexibility makes it easier to manage complex workflows with multiple interdependencies, ensuring robust and scalable workflow orchestration.

---

[< Previous](./getting_started.md) | [Table of Contents](./StatefulWorkflow.md) | [Next >](./state_management_and_data_normalization.md)
