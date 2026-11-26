## `StatefulWorkflow` Docs

## Overview

`StatefulWorkflow` is a core class built on top of Temporal.io designed to simplify the creation of dynamic, hierarchical workflows with strong state management. It provides abstractions for data normalization, synchronization, and workflow orchestration, reducing boilerplate and enabling developers to focus on application logic.

## What It Solves

- **Managing complex entity graphs** where nested or related entities require coordinated workflow behavior.
- **Maintaining consistency in long-running processes** that depend on external data sources or frequently changing inputs.
- **Reducing maintenance overhead** caused by custom orchestration logic, manual normalization, or fragmented update flows.

## Key Features

### Automatic Child Workflow Management

Parent workflows automatically start, update, or stop child workflows whenever relevant parts of their state change.

### Data Normalization and Denormalization

Nested structures are normalized for efficient storage and update handling, while denormalized views are provided for easier consumption.

### Subscription-Based State Synchronization

Workflows can subscribe to specific parts of the state. Only relevant subscribers are notified when changes occur, avoiding redundant updates.

### External Data Loading Support

A `loadData` mechanism allows workflows to synchronize with external systems or APIs and integrate updates safely.

### Support for Hierarchical and Circular Relations

Handles complex relationships across entity trees, including parent-child chains, sibling relationships, and circular references.

### Credential Propagation

Token or credential updates propagate automatically across all dependent workflows.

## Developer Benefits

- Less boilerplate and orchestration logic.
- Improved maintainability as data structures and relationships evolve.
- More reliable state handling with built-in normalization and synchronization.
- Easier integration with external APIs and services.
- Scalable architecture for entity-heavy or long-running workflows.

## When to Use `StatefulWorkflow`

Use it when your workflows:

- Manage nested or relational data.
- Need to track long-running state with external synchronization.
- Should automatically orchestrate child workflows.
- Require strong consistency guarantees across workflow hierarchies.

## Example Usage

```ts
import {
  Temporal,
  StatefulWorkflow,
  StatefulWorkflowParams,
  StatefulWorkflowOptions,
  Property,
  SchemaManager
} from 'temporal-forge';

type User = {
  id: string;
  likes: Like[];
};

type Like = {
  id: string;
  user: User;
};

@Temporal({
  schemaName: "User",
  schemas: SchemaManager.schemas
})
class UserWorkflow extends StatefulWorkflow<
  StatefulWorkflowParams<User>,
  StatefulWorkflowOptions
> {
  @Property({ path: 'likes' })
  protected likes!: Like[];

  async execute() {
    this.log.info('Executing workflow – child workflows for `likes` have been automatically prepared.');
  }
}

export default UserWorkflow;

SchemaManager.parseYAML(`
  User:
    idAttribute: id
    likes: [Like]
  Like:
    idAttribute: id
    user: User
`);
```

## Summary

`StatefulWorkflow` enables scalable, maintainable orchestration for entity-driven workflows. With normalization, subscription-based updates, automatic child workflow management, and strong integration support, it’s an ideal building block for complex Temporal workflows needing consistency and automation.

---

# [Table of Contents](./StatefulWorkflow/table_of_contents.md)

1. [Introduction to `StatefulWorkflow`](./StatefulWorkflow/introduction.md)
   - [Overview and Purpose](./StatefulWorkflow/introduction.md#overview-and-purpose)
   - [Key Features](./StatefulWorkflow/introduction.md#key-features)
   - [Use Cases and Applications](./StatefulWorkflow/introduction.md#use-cases-and-applications)

2. [Getting Started with `StatefulWorkflow`](./StatefulWorkflow/getting_started.md)
   - [Initial Setup and Requirements](./StatefulWorkflow/getting_started.md#initial-setup-and-requirements)
   - [Extending `StatefulWorkflow` for Custom Workflows](./StatefulWorkflow/getting_started.md#extending-statefulworkflow-for-custom-workflows)
   - [Overview of Key Concepts and Terminology](./StatefulWorkflow/getting_started.md#overview-of-key-concepts-and-terminology)

3. [Defining Workflow Relationships with `managedPaths`](./StatefulWorkflow/defining_workflow_relationships.md)
   - [Introduction to `managedPaths`](./StatefulWorkflow/defining_workflow_relationships.md#introduction-to-managedpaths)
   - [Configuration and Examples](./StatefulWorkflow/defining_workflow_relationships.md#configuration-and-examples)
   - [Managing Relationships and Dependencies](./StatefulWorkflow/defining_workflow_relationships.md#managing-relationships-and-dependencies)
   - [Auto-Starting Child Workflows](./StatefulWorkflow/defining_workflow_relationships.md#auto-starting-child-workflows)

4. [State Management and Data Normalization](./StatefulWorkflow/state_management_and_data_normalization.md)
   - [Overview of State Management in `StatefulWorkflow`](./StatefulWorkflow/state_management_and_data_normalization.md#overview-of-state-management-in-statefulworkflow)
     - [Dynamic State Updates](./StatefulWorkflow/state_management_and_data_normalization.md#dynamic-state-updates)
     - [Data Consistency](./StatefulWorkflow/state_management_and_data_normalization.md#data-consistency)
     - [Efficient Querying and Modification](./StatefulWorkflow/state_management_and_data_normalization.md#efficient-querying-and-modification)
   - [Automatic Data Normalization with `SchemaManager`](./StatefulWorkflow/state_management_and_data_normalization.md#automatic-data-normalization-with-schemamanager)
     - [Simplified Data Management](./StatefulWorkflow/state_management_and_data_normalization.md#simplified-data-management)
     - [Automatic Handling](./StatefulWorkflow/state_management_and_data_normalization.md#automatic-handling)
     - [Consistency Across Workflows](./StatefulWorkflow/state_management_and_data_normalization.md#consistency-across-workflows)
   - [Handling Complex Nested Data Structures](./StatefulWorkflow/state_management_and_data_normalization.md#handling-complex-nested-data-structures)
     - [Schema-Based Normalization](./StatefulWorkflow/state_management_and_data_normalization.md#schema-based-normalization)
     - [Automatic Relationship Management](./StatefulWorkflow/state_management_and_data_normalization.md#automatic-relationship-management)
     - [Efficient Data Access](./StatefulWorkflow/state_management_and_data_normalization.md#efficient-data-access)
   - [Updating, Merging, and Deleting Entities](./StatefulWorkflow/state_management_and_data_normalization.md#updating-merging-and-deleting-entities)
     - [Updating Entities](./StatefulWorkflow/state_management_and_data_normalization.md#updating-entities)
     - [Merging Entities](./StatefulWorkflow/state_management_and_data_normalization.md#merging-entities)
     - [Deleting Entities](./StatefulWorkflow/state_management_and_data_normalization.md#deleting-entities)
     - [Automatic Synchronization](./StatefulWorkflow/state_management_and_data_normalization.md#automatic-synchronization)

5. [Exposed Queries and Signals in `StatefulWorkflow`](./StatefulWorkflow/exposed_queries_and_signals.md)
   - [Exposed Queries](./StatefulWorkflow/exposed_queries_and_signals.md#exposed-queries)
     - [`id`](./StatefulWorkflow/exposed_queries_and_signals.md#id)
     - [`entityName`](./StatefulWorkflow/exposed_queries_and_signals.md#entityname)
     - [`state`](./StatefulWorkflow/exposed_queries_and_signals.md#state)
     - [`pendingChanges`](./StatefulWorkflow/exposed_queries_and_signals.md#pendingchanges)
     - [`subscriptions`](./StatefulWorkflow/exposed_queries_and_signals.md#subscriptions)
     - [`managedPaths`](./StatefulWorkflow/exposed_queries_and_signals.md#managedpaths)
     - [`apiUrl`](./StatefulWorkflow/exposed_queries_and_signals.md#apiurl)
     - [`params`](./StatefulWorkflow/exposed_queries_and_signals.md#params)
   - [Exposed Signals](./StatefulWorkflow/exposed_queries_and_signals.md#exposed-signals)
     - [`apiToken`](./StatefulWorkflow/exposed_queries_and_signals.md#apitoken-signal)
     - [`update`](./StatefulWorkflow/exposed_queries_and_signals.md#update)
     - [`delete`](./StatefulWorkflow/exposed_queries_and_signals.md#delete)
     - [`subscribe`](./StatefulWorkflow/exposed_queries_and_signals.md#subscribe-opt-in-since-20) (opt-in)
     - [`unsubscribe`](./StatefulWorkflow/exposed_queries_and_signals.md#unsubscribe-opt-in-since-20) (opt-in)

6. [Dynamic Data Loading and API Integration](./StatefulWorkflow/dynamic_data_loading_and_api_integration.md)
   - [Loading Data Dynamically with `loadData`](./StatefulWorkflow/dynamic_data_loading_and_api_integration.md#loading-data-dynamically-with-loaddata)
   - [Integrating with External APIs Using Temporal Activities](./StatefulWorkflow/dynamic_data_loading_and_api_integration.md#integrating-with-external-apis-using-temporal-activities)
   - [Managing API Tokens and Secure API Access](./StatefulWorkflow/dynamic_data_loading_and_api_integration.md#managing-api-tokens-and-secure-api-access)
   - [Propagating Configuration and Credentials to Child Workflows](./StatefulWorkflow/dynamic_data_loading_and_api_integration.md#propagating-configuration-and-credentials-to-child-workflows)

7. [Child Workflow Lifecycle Management](./StatefulWorkflow/child_workflow_lifecycle_management.md)
   - [Automatic Instantiation, Update, and Cancellation of Child Workflows](./StatefulWorkflow/child_workflow_lifecycle_management.md#automatic-instantiation-update-and-cancellation-of-child-workflows)
   - [Handling State Changes and Synchronizing Child Workflows](./StatefulWorkflow/child_workflow_lifecycle_management.md#handling-state-changes-and-synchronizing-child-workflows)
   - [Detecting and Preventing Redundant Workflows](./StatefulWorkflow/child_workflow_lifecycle_management.md#detecting-and-preventing-redundant-workflows)
   - [Propagation of Responsibilities in Hierarchical Workflows](./StatefulWorkflow/child_workflow_lifecycle_management.md#propagation-of-responsibilities-in-hierarchical-workflows)

8. [Subscriptions and Signal-Based Communication](./StatefulWorkflow/subscriptions_and_signal_based_communication.md)
   - [Introduction to Subscriptions in `StatefulWorkflow`](./StatefulWorkflow/subscriptions_and_signal_based_communication.md#introduction-to-subscriptions-in-statefulworkflow)
   - [Defining Selectors and Handling Wildcards](./StatefulWorkflow/subscriptions_and_signal_based_communication.md#defining-selectors-and-handling-wildcards)
   - [Managing State Propagation with Signals](./StatefulWorkflow/subscriptions_and_signal_based_communication.md#managing-state-propagation-with-signals)
   - [Preventing Recursive Loops and Redundant Updates](./StatefulWorkflow/subscriptions_and_signal_based_communication.md#preventing-recursive-loops-and-redundant-updates)

9. [Handling Circular Relationships and Workflow Ancestry](./StatefulWorkflow/handling_circular_relationships_and_workflow_ancestry.md)
   - [Overview of Circular Relationship Challenges](./StatefulWorkflow/handling_circular_relationships_and_workflow_ancestry.md#overview-of-circular-relationship-challenges)
   - [Workflow Metadata and Ancestry Tracking](./StatefulWorkflow/handling_circular_relationships_and_workflow_ancestry.md#workflow-metadata-and-ancestry-tracking)
   - [Detecting Circular Dependencies and Delegating Management](./StatefulWorkflow/handling_circular_relationships_and_workflow_ancestry.md#detecting-circular-dependencies-and-delegating-management)
   - [Best Practices for Preventing Redundant Workflows](./StatefulWorkflow/handling_circular_relationships_and_workflow_ancestry.md#best-practices-for-preventing-redundant-workflows)

10. [Security and API Token Management](./StatefulWorkflow/security_and_api_token_management.md)
    - [Centralized Management of API Tokens](./StatefulWorkflow/security_and_api_token_management.md#centralized-management-of-api-tokens)
    - [Signal-Based Propagation Across Workflow Hierarchies](./StatefulWorkflow/security_and_api_token_management.md#signal-based-propagation-across-workflow-hierarchies)
    - [Dynamic and Controlled Propagation of Credentials](./StatefulWorkflow/security_and_api_token_management.md#dynamic-and-controlled-propagation-of-credentials)
    - [Best Practices for Secure Workflow Communication](./StatefulWorkflow/security_and_api_token_management.md#best-practices-for-secure-workflow-communication)

11. [Type-Safe Action System](./StatefulWorkflow/action_system.md)
    - [Introduction to the Action Pattern](./StatefulWorkflow/action_system.md#introduction-to-the-action-pattern)
    - [Defining and Using Actions with @Action Decorator](./StatefulWorkflow/action_system.md#defining-and-using-actions-with-action-decorator)
    - [Typed Input and Output for Actions](./StatefulWorkflow/action_system.md#typed-input-and-output-for-actions)
    - [Executing Actions and Handling Results](./StatefulWorkflow/action_system.md#executing-actions-and-handling-results)

12. [Event Handling with @On Decorator](./StatefulWorkflow/event_handling.md)
    - [Overview of Event-Driven Workflows](./StatefulWorkflow/event_handling.md#overview-of-event-driven-workflows)
    - [Registering Event Handlers with @On](./StatefulWorkflow/event_handling.md#registering-event-handlers-with-on)
    - [Workflow and State Events](./StatefulWorkflow/event_handling.md#workflow-and-state-events)
    - [Best Practices for Event-Driven Design](./StatefulWorkflow/event_handling.md#best-practices-for-event-driven-design)

13. [Best Practices and Advanced Usage](./StatefulWorkflow/best_practices_and_advanced_usage.md)
    - [Customizing `StatefulWorkflow` for Specific Use Cases](./StatefulWorkflow/best_practices_and_advanced_usage.md#customizing-statefulworkflow-for-specific-use-cases)
    - [Performance Optimization Tips](./StatefulWorkflow/best_practices_and_advanced_usage.md#performance-optimization-tips)
    - [Error Handling and Retry Strategies](./StatefulWorkflow/best_practices_and_advanced_usage.md#error-handling-and-retry-strategies)
    - [Integrating with Other Workflow Management Systems](./StatefulWorkflow/best_practices_and_advanced_usage.md#integrating-with-other-workflow-management-systems)

14. [Conclusion and Further Reading](./StatefulWorkflow/conclusion_and_further_reading.md)
    - [Summary of Key Concepts](./StatefulWorkflow/conclusion_and_further_reading.md#summary-of-key-concepts)
    - [Future Enhancements and Roadmap](./StatefulWorkflow/conclusion_and_further_reading.md#future-enhancements-and-roadmap)
    - [Additional Resources and Documentation](./StatefulWorkflow/conclusion_and_further_reading.md#additional-resources-and-documentation)

---
