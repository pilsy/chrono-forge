# Event Handling with @On Decorator

## Overview of Event-Driven Workflows

Event-driven architecture is a fundamental design pattern in `StatefulWorkflow` that enables responsive, decoupled systems. By using the event-driven approach, workflows can react to changes and signals without tightly coupling components, making the system more maintainable, extensible, and resilient.

In `StatefulWorkflow`, the event system allows:

- **Loose Coupling**: Components can communicate without direct dependencies.
- **Reactive Design**: Workflows respond to changes as they occur.
- **Concurrency Management**: Events are processed in a controlled manner.
- **State Change Isolation**: Components only need to know about events, not the implementation details of other parts of the system.

The event system in `StatefulWorkflow` builds on the `EventEmitter` foundation from the base `Workflow` class, adding specialized handling for state-related events and workflow lifecycle events.

## Registering Event Handlers with @On

The `@On` decorator is used to register methods as event handlers, specifying which events they should respond to:

```typescript
import { StatefulWorkflow, On } from 'chrono-forge';

class OrderWorkflow extends StatefulWorkflow {
  @On('orderCreated')
  protected async handleOrderCreated(orderData: any) {
    this.log.info(`New order created: ${orderData.id}`);
    // Perform processing for new orders
  }
  
  @On('state:Order.*')
  protected async handleOrderStateChanges(changes: any) {
    this.log.info(`Order state changes detected`);
    // React to any changes in Order entities
  }
}
```

The `@On` decorator takes an event name as its parameter, which can be:

1. **Workflow Event**: A standard event emitted within the workflow using `emitAsync()`.
2. **State Event**: An event related to state changes, prefixed with `state:`.
3. **Lifecycle Event**: A predefined workflow lifecycle event such as `setup`, `idle`, or `complete`.

### Event Handler Registration

When decorated methods are registered as event handlers, they are automatically bound to the appropriate event emitter (either the workflow instance or the state manager) during the workflow's initialization phase.

```typescript
@On('setup')
protected async onSetup() {
  // This method will be called during workflow setup
  // Useful for initialization tasks
}

@On('state:Customer.*.address')
protected async onCustomerAddressChanged(changes: any) {
  // This handler will be called when any customer's address changes
  // The wildcard (*) means "any customer ID"
}
```

## Workflow and State Events

### Workflow Events

Workflow events are general-purpose events emitted directly by the workflow or its components. These can include lifecycle events, business process events, or integration events.

Common workflow events include:

- **`setup`**: Emitted when the workflow is being initialized.
- **`idle`**: Emitted when the workflow has completed processing but remains active.
- **`complete`**: Emitted when the workflow has completed its execution.
- **`error`**: Emitted when an error occurs during workflow execution.

```typescript
@On('setup')
protected async onWorkflowSetup() {
  // Initialization code
  if (this.params?.subscriptions) {
    for (const subscription of this.params.subscriptions) {
      await this.subscribe(subscription);
    }
  }
}

@On('idle')
protected async onWorkflowIdle() {
  // Check for pending work or external triggers
  if (this.pendingUpdate) {
    await this.loadData();
    this.pendingUpdate = false;
  }
}
```

### State Events

State events are triggered by changes to the workflow's state, specifically to entities managed by the state manager. These events are prefixed with `state:` and can include wildcards for flexible pattern matching.

The format for state events is:

```
state:<EntityType>.<EntityID>.<Property>
```

Examples:

- `state:Order.*`: Any change to any Order entity
- `state:Order.123`: Any change to Order with ID 123
- `state:Order.*.status`: Changes to the status property of any Order
- `state:Order.123.items`: Changes to the items property of Order 123

```typescript
@On('state:Order.*.status')
protected async onOrderStatusChanged(changes: any) {
  const { entityId, path, newValue, oldValue } = changes;
  this.log.info(`Order ${entityId} status changed from ${oldValue} to ${newValue}`);
  
  if (newValue === 'shipped') {
    // Trigger shipping notification
    await this.notifyCustomer(entityId, 'Your order has shipped!');
  }
}
```

## Advanced Event Patterns

### State Selectors with Wildcards

State events support flexible pattern matching with wildcards, allowing for powerful event selection:

```typescript
// Match any change to any Product entity
@On('state:Product.*')
protected async onProductChanged(changes: any) { /*...*/ }

// Match changes to the price of any Product
@On('state:Product.*.price')
protected async onProductPriceChanged(changes: any) { /*...*/ }

// Match changes to any field in a specific Product
@On('state:Product.abc123')
protected async onSpecificProductChanged(changes: any) { /*...*/ }

// Match nested property changes
@On('state:Customer.*.address.city')
protected async onCustomerCityChanged(changes: any) { /*...*/ }
```

### Event Handler with Multiple Events

A common pattern is to handle multiple related events with a single handler method:

```typescript
class OrderProcessingWorkflow extends StatefulWorkflow {
  // Register the same method for multiple events
  @On('orderCreated')
  @On('orderUpdated')
  @On('orderCancelled')
  protected async handleOrderEvent(eventData: any, eventName: string) {
    this.log.info(`Received ${eventName} event for order ${eventData.id}`);
    // Common processing for order events
    await this.syncOrderWithExternalSystem(eventData);
  }
}
```

### Event Propagation Control

You can control whether events should propagate to child workflows or not:

```typescript
// Emit an event that will also propagate to child workflows
await this.emitAsync('statusUpdate', { status: 'active' }, true);
```

## Best Practices for Event-Driven Design

### 1. Keep Event Handlers Focused

Each event handler should perform a single responsibility. If an event triggers multiple actions, consider splitting it into multiple handlers or emitting additional events.

### 2. Use Descriptive Event Names

Choose meaningful event names that clearly communicate what happened:

- `orderCreated` instead of `newOrder`
- `paymentProcessed` instead of `paid`
- `customerAddressUpdated` instead of `addressChange`

### 3. Be Careful with Wildcards

While wildcards are powerful, overly broad patterns can lead to performance issues or unintended side effects. Be as specific as reasonably possible.

### 4. Handle Event Errors Gracefully

Event handlers should include error handling to prevent a single handler failure from disrupting the entire workflow:

```typescript
@On('customerCreated')
protected async handleNewCustomer(customer: any) {
  try {
    await this.sendWelcomeEmail(customer);
  } catch (error) {
    this.log.error(`Failed to send welcome email: ${error.message}`);
    // Continue execution despite this non-critical error
  }
}
```

### 5. Avoid Infinite Event Loops

Be careful not to create circular event dependencies where events trigger changes that emit more events in an infinite loop:

```typescript
// Dangerous pattern that could cause infinite loops
@On('state:Order.*.status')
protected async onOrderStatusChanged(changes: any) {
  // This might trigger another 'state:Order.*.status' event!
  await this.stateManager.dispatch(
    updateEntityPartial({ id: changes.entityId, lastUpdated: new Date().toISOString() }, 'Order')
  );
}
```

### 6. Consider Event Payload Size

Keep event payloads reasonably sized, especially for events that may be emitted frequently. Large payloads can impact performance.

## Common Use Cases

### 1. Workflow Initialization

```typescript
@On('setup')
protected async initialize() {
  // Set up initial state
  if (this.params?.state) {
    await this.stateManager.dispatch(setState(this.params.state));
  }
  
  // Register subscriptions
  if (this.params?.subscriptions) {
    for (const subscription of this.params.subscriptions) {
      await this.subscribe(subscription);
    }
  }
  
  // Initial data loading
  if (this.pendingUpdate) {
    await this.loadData();
  }
}
```

### 2. Reacting to State Changes

```typescript
@On('state:Order.*.items')
protected async recalculateOrderTotal(changes: any) {
  const { entityId } = changes;
  const order = this.getEntity('Order', entityId);
  
  if (order && order.items) {
    const total = order.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    
    await this.stateManager.dispatch(
      updateEntityPartial({ id: entityId, total }, 'Order')
    );
  }
}
```

### 3. Synchronizing with External Systems

```typescript
@On('state:Customer.*')
protected async syncCustomerToExternalCRM(changes: any) {
  const { entityId } = changes;
  const customer = this.getEntity('Customer', entityId);
  
  if (customer) {
    try {
      // Use an activity to call an external API
      await workflow.executeActivity('syncCustomerToCRM', {
        taskQueue: 'api-activities',
        args: [customer],
        retry: { maximumAttempts: 3 }
      });
      
      this.log.info(`Successfully synced customer ${entityId} to CRM`);
    } catch (error) {
      this.log.error(`Failed to sync customer to CRM: ${error.message}`);
    }
  }
}
```

## Conclusion

The event system in `StatefulWorkflow`, powered by the `@On` decorator, provides a flexible, powerful way to build reactive, event-driven workflows. By leveraging this system, developers can create loosely coupled, maintainable workflows that respond effectively to both internal state changes and external events.

Whether you're building complex multi-entity workflows or simple state machines, the event-driven approach helps separate concerns and improve code organization. The combination of workflow events, state events, and lifecycle events gives you a comprehensive toolkit for handling all aspects of workflow behavior in a consistent, predictable way.
