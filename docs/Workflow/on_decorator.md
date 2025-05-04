# `@On` Decorator

## Introduction to the `@On` Decorator

The `@On` decorator is a key feature in the ChronoForge framework that enables event-driven workflow development. It allows methods within workflow classes to respond to various types of events, including state changes, child workflow events, and lifecycle events. This event-driven approach enables workflows to be more reactive, maintainable, and decoupled.

## Purpose of the `@On` Decorator

The primary purposes of the `@On` decorator are:

- **Event Listening**: Register methods to be called when specific events occur within the workflow system
- **Declarative Programming**: Define event handlers using a clean, declarative syntax
- **Domain Separation**: Separate business logic by event type, improving code organization
- **Loose Coupling**: Create workflows that respond to changes without direct dependencies

## How the `@On` Decorator Works

When the `@On` decorator is applied to a method in a workflow class, it performs the following:

1. **Registers the Method as an Event Handler**: The method is registered in the workflow's metadata as a handler for the specified event
2. **Configures Event Binding**: During workflow initialization, the method is automatically bound to the appropriate event emitter
3. **Sets Up Event Processing**: When the specified event occurs, the decorated method is called with the event data

## Event Types and Patterns

The `@On` decorator supports several categories of events:

### State Events

State events are triggered when the workflow's state changes. These events are prefixed with `state:` and can include wildcards for flexible pattern matching.

Examples:

- `state:updated` - Triggered when an entity is updated
- `state:created` - Triggered when a new entity is created
- `state:deleted` - Triggered when an entity is deleted
- `state:*` - Wildcard to catch all state events
- `state:EntityType.*` - Events for any entity of a specific type
- `state:EntityType.*.propertyName` - Events for a specific property on any entity of a type
- `state:EntityType.specificId` - Events for a specific entity

### Child Workflow Events

Child workflow events relate to the lifecycle of child workflows managed by a parent workflow.

Examples:

- `child:${entityName}:started` - When a child workflow starts
- `child:${entityName}:updated` - When a child workflow receives updates
- `child:${entityName}:deleted` - When a child workflow is terminated
- `child:*` - Wildcard to catch all child workflow events

### Lifecycle Events

Lifecycle events mark important stages in a workflow's execution.

Examples:

- `init` - Workflow initialization
- `setup` - Initial workflow setup
- `beforeExecute` - Before main execution
- `afterExecute` - After main execution
- `idle` - When the workflow is idle
- `error` - Error handling

### Custom Events

Workflows can also emit and listen for custom events specific to the business domain.

Examples:

- `orderApproved`
- `paymentProcessed`
- `shipmentCreated`

## Usage Examples

### Basic Event Handling

```typescript
import { Workflow, On } from 'chrono-forge';

class OrderWorkflow extends Workflow {
  @On('setup')
  protected async onSetup() {
    this.log.info('Workflow is being set up');
    // Perform initialization tasks
  }

  @On('idle')
  protected async onIdle() {
    this.log.info('Workflow is idle');
    // Check for any pending work
  }

  @On('error')
  protected async onError(error: Error) {
    this.log.error(`Workflow encountered an error: ${error.message}`);
    // Implement error recovery logic
  }
}
```

### State Change Handling

```typescript
class InventoryWorkflow extends Workflow {
  @On('state:Product.*')
  protected async onProductChanged(changes: any) {
    const { entityId, path, newValue, oldValue } = changes;
    this.log.info(`Product ${entityId} changed at path ${path}`);
    // React to any product entity changes
  }

  @On('state:Product.*.stock')
  protected async onProductStockChanged(changes: any) {
    const { entityId, newValue, oldValue } = changes;
    
    if (newValue < 10 && oldValue >= 10) {
      this.log.warn(`Product ${entityId} is low on stock: ${newValue} remaining`);
      await this.emitAsync('lowStockAlert', { productId: entityId, stock: newValue });
    }
  }
}
```

### Child Workflow Events

```typescript
class OrderOrchestrationWorkflow extends Workflow {
  @On('child:Payment:started')
  protected async onPaymentStarted(paymentData: any) {
    this.log.info(`Payment workflow started for order ${paymentData.orderId}`);
    // Update order status
  }

  @On('child:Shipment:completed')
  protected async onShipmentCompleted(shipmentData: any) {
    this.log.info(`Shipment completed for order ${shipmentData.orderId}`);
    // Update order status and notify customer
  }
}
```

### Multiple Event Handlers for the Same Method

```typescript
class NotificationWorkflow extends Workflow {
  @On('orderPlaced')
  @On('orderShipped')
  @On('orderDelivered')
  protected async sendCustomerNotification(orderData: any, eventName: string) {
    // The second parameter contains the name of the event that triggered this handler
    this.log.info(`Sending notification for event: ${eventName}`);
    
    const notificationType = eventName === 'orderPlaced' ? 'confirmation' :
                             eventName === 'orderShipped' ? 'shipping' : 'delivery';
    
    await this.sendNotification(orderData.customerId, notificationType, orderData);
  }
}
```

## Event Handler Parameters

When an event is triggered, the handler method receives the following parameters:

1. **Event Data**: The data associated with the event (depends on the event type)
2. **Event Name**: The name of the event that triggered the handler
3. **Additional Context**: Optional additional context (depends on the event type)

## Advanced Usage

### Pattern Matching with Wildcards

The `@On` decorator supports wildcards (*) for flexible event matching:

```typescript
// Match any state change event
@On('state:*')
protected async onAnyStateChange(changes: any) {
  // Respond to any state change
}

// Match any event for Customer entities
@On('state:Customer.*')
protected async onCustomerChange(changes: any) {
  // Respond to customer changes
}

// Match property changes at any depth
@On('state:Order.*.items.*.quantity')
protected async onOrderItemQuantityChange(changes: any) {
  // Responds when an item quantity changes within any order
}
```

### Custom Event Emission

Workflows can emit custom events using the `emitAsync` method:

```typescript
// Emitting a custom event
await this.emitAsync('orderApproved', { orderId: '123', approvedBy: 'system' });

// Handling the custom event
@On('orderApproved')
protected async onOrderApproved(orderData: any) {
  this.log.info(`Order ${orderData.orderId} approved by ${orderData.approvedBy}`);
  // Process approved order
}
```

### Propagating Events to Child Workflows

Events can be propagated to child workflows by setting the third parameter of `emitAsync` to `true`:

```typescript
// Emit event and propagate to child workflows
await this.emitAsync('statusUpdate', { status: 'active' }, true);
```

## Best Practices

### 1. Keep Event Handlers Focused

Event handlers should have a single responsibility. If an event requires multiple actions, consider splitting it into multiple handlers or emitting additional events.

### 2. Use Descriptive Event Names

Choose meaningful event names that clearly communicate what happened:

- `orderCreated` instead of `create`
- `paymentProcessed` instead of `payment`
- `customerAddressUpdated` instead of `address`

### 3. Handle Event Errors

Include error handling in event handlers to prevent a single handler failure from disrupting the entire workflow:

```typescript
@On('customerCreated')
protected async onNewCustomer(customer: any) {
  try {
    await this.sendWelcomeEmail(customer);
  } catch (error) {
    this.log.error(`Failed to send welcome email: ${error.message}`);
    // Continue execution despite this non-critical error
  }
}
```

### 4. Be Specific with Event Patterns

When using wildcards, be as specific as reasonably possible to avoid performance issues or unintended side effects.

### 5. Document Events

Document the events that your workflow emits and listens for, especially in larger systems with multiple workflows.

## Integration with Other Decorators

The `@On` decorator works well with other ChronoForge decorators:

- **`@Temporal`**: Required for all workflow classes
- **`@Action`**: Actions can emit events that `@On` handlers respond to
- **`@Property`**: Property changes can trigger state events
- **`@Step`**: Steps can emit events at different stages of execution

## Conclusion

The `@On` decorator is a powerful tool for creating event-driven workflows in ChronoForge. By leveraging this decorator, developers can create workflows that respond to state changes, lifecycle events, and custom business events in a clean, declarative manner. This approach promotes loose coupling, separation of concerns, and maintainable code.

For more advanced usage of the event system, including complex event patterns and integration with the state management system, see the [StatefulWorkflow Event Handling](../StatefulWorkflow/event_handling.md) documentation.
