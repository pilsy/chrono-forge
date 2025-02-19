[< Previous](./introduction.md) | [Table of Contents](./table_of_contents.md#table-of-contents) | [Next >](./defining_workflow_relationships.md)

---

### 2: Getting Started with `StatefulWorkflow`

To effectively use `StatefulWorkflow` in your project, it’s essential to understand the initial setup, how to extend the class for custom workflows, and familiarize yourself with the key concepts and terminology associated with it. This section provides a comprehensive guide to help you get started with `StatefulWorkflow`, from installation to creating your custom workflows.

#### Initial Setup and Requirements

Before diving into building custom workflows with `StatefulWorkflow`, you need to ensure that your environment is properly set up. The minimum Node.js version required is 18 or newer.

##### Step 1: Install `temporal-forge`

To begin, you need to install the `temporal-forge` package, which provides the `StatefulWorkflow` class and related utilities.

Using `npm`:

```bash
npm install temporal-forge
```

Or, if you prefer `yarn`:

```bash
yarn add temporal-forge
```

Once the package is installed, you are ready to start creating workflows by extending `StatefulWorkflow`.

#### Extending `StatefulWorkflow` for Custom Workflows

`StatefulWorkflow` is designed to be extended, allowing developers to define their workflows tailored to specific use cases. When extending `StatefulWorkflow`, you must use the `@ChronoForge` decorator to configure the workflow properly, including setting any `normalizr` schemas that will be used for data normalization.

##### Step 2: Define and Import Normalizr Schemas

When creating a custom workflow that manages complex entities, you often need to normalize the data. For this, you use the `SchemaManager` to define and manage `normalizr` schemas. Schemas are usually defined in a dedicated file, such as `schema/index.ts`, where you set up recursive schemas to manage nested relationships without worrying about circular dependencies.

**Example of Defining Normalizr Schemas:**

Create a file named `schema/index.ts` and define your schemas as follows:

```typescript
import { SchemaManager } from 'temporal-forge';  // Import SchemaManager from temporal-forge

const schemaManager = SchemaManager.getInstance();  // Get an instance of SchemaManager

// Define the schemas for User and Listing entities
schemaManager.setSchemas({
  User: {
    idAttribute: 'id',
    listings: ['Listing']  // A User has a list of Listings
  },
  Listing: {
    idAttribute: 'id',
    user: 'User'  // A Listing belongs to a User
  }
});

const schemas = schemaManager.getSchemas();
const { User, Listing } = schemas;
export { User, Listing };
export default schemas;
```

In this example:

- We define two schemas, `User` and `Listing`, with their respective attributes and relationships.
- `User` has a `listings` array that contains `Listing` entities.
- `Listing` has a `user` reference that points back to a `User` entity.
- By defining schemas in this way, you can easily manage recursive relationships without encountering issues.

##### Step 3: Extend `StatefulWorkflow` with `@ChronoForge` Decorator

Once the schemas are defined, you can extend `StatefulWorkflow` to create custom workflows. The `@ChronoForge` decorator is essential when defining a new workflow, as it initializes the workflow with the provided schema for normalization.

**Example of Extending `StatefulWorkflow`:**

```typescript
import { StatefulWorkflow } from 'temporal-forge';
import { User } from '../schema';  // Import the User schema

@ChronoForge({ schema: User })  // Use the @ChronoForge decorator and pass the schema
export class UserWorkflow extends StatefulWorkflow {
  // Workflow-specific logic and configuration

  // Example: Override the initialize method
  async initialize(): Promise<void> {
    this.log.info('Initializing UserWorkflow...');
    // Custom initialization logic here
  }

  // Define custom signals, queries, or other methods as needed
}
```

In this example:

- We extend the `StatefulWorkflow` class to create a `UserWorkflow` that handles operations related to `User` entities.
- The `@ChronoForge` decorator is applied with the `User` schema to ensure that the workflow uses the correct schema for normalization.
- You can override or add custom methods to define specific behavior for the workflow.

#### Overview of Key Concepts and Terminology

Understanding the core concepts and terminology of `StatefulWorkflow` is crucial for effectively using this powerful tool. Below is an overview of some key terms and their meanings:

- **`@ChronoForge` Decorator**: A decorator used to define a workflow and its configuration, including the schema for data normalization. It is required when extending `StatefulWorkflow`.
  
- **`SchemaManager`**: A singleton class responsible for managing `normalizr` schemas. It allows defining, retrieving, and setting schemas dynamically, making it easy to handle recursive relationships in complex data structures.

- **`managedPaths`**: A configuration object that defines relationships between entities and how child workflows are managed. It specifies which child workflows should be started automatically, the type of entities they manage, and how they interact with external APIs.

- **`Exposed Queries` and `Signals`**: Queries and signals are essential for interacting with workflows dynamically. Queries allow retrieving workflow data (e.g., `id`, `state`), while signals modify workflow behavior (e.g., `update`, `delete`, `apiToken`).

- **`State Management`**: `StatefulWorkflow` provides robust state management capabilities, allowing workflows to manage their internal states dynamically, normalize data, and synchronize with other workflows or external systems.

- **`Temporal Activities`**: Activities in Temporal.io are functions executed outside the workflow code. They are often used for I/O operations, such as API calls, to ensure workflows remain deterministic and resilient.

By familiarizing yourself with these concepts and the foundational setup required, you can effectively extend `StatefulWorkflow` for your custom use cases, ensuring robust and scalable workflow management in your applications.

---

[< Previous](./introduction.md) | [Table of Contents](./table_of_contents.md#table-of-contents) | [Next >](./defining_workflow_relationships.md)
