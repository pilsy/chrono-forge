### **`@Action` Decorator**

#### **Introduction to the `@Action` Decorator**

The `@Action` decorator is a core feature in the ChronoForge framework that allows developers to define typed, executable actions within a workflow. Actions represent discrete units of business logic that can be executed as part of the workflow's operation, with optional type safety and execution control.

#### **Purpose of the `@Action` Decorator**

- **Defines Executable Actions**: The primary purpose of the `@Action` decorator is to register a method as an executable action within a workflow, making it available for orchestration and execution.
- **Enables Type Safety**: Actions can be configured with input and output types, providing compile-time type checking and better IDE support.
- **Controls Execution Flow**: Actions can be configured as blocking or non-blocking, affecting how they impact workflow execution.
- **Integrates with State Management**: Actions are designed to work seamlessly with the workflow's state management system, enabling predictable state updates.
- **Supports Traceability**: Actions provide a clear record of operations performed within the workflow, enhancing visibility and debugging.

#### **How the `@Action` Decorator Works**

When the `@Action` decorator is applied to a method in a workflow class, it performs the following:

1. **Registers the Method as an Action**: The method is registered in the workflow's metadata as an executable action.
2. **Configures Execution Behavior**: Sets up whether the action blocks workflow execution.
3. **Establishes Type Definitions**: When provided, associates input and output type definitions with the action.
4. **Enables State Tracking**: Prepares the action for integration with the state management system.

#### **Configuration Options**

The `@Action` decorator accepts an optional configuration object with the following properties:

```typescript
export interface ActionOptions<TInput = any, TOutput = any> {
  blocking?: boolean;
  inputType?: TInput;
  outputType?: TOutput;
}
```

- **`blocking`**: Boolean flag indicating whether the action blocks workflow execution
- **`inputType`**: Type definition for the action's input parameters
- **`outputType`**: Type definition for the action's return value

#### **Usage Examples**

##### **Basic Action Definition**

```typescript
import { StatefulWorkflow, Action } from 'chrono-forge';

interface CreateOrderInput {
  customerId: string;
  items: { productId: string; quantity: number }[];
}

interface Order {
  id: string;
  customerId: string;
  items: { productId: string; quantity: number }[];
  status: string;
  createdAt: string;
}

class OrderWorkflow extends StatefulWorkflow {
  @Action<CreateOrderInput, Order>()
  protected async createOrder(input: CreateOrderInput): Promise<Order> {
    const order: Order = {
      id: `order-${Date.now()}`,
      customerId: input.customerId,
      items: input.items,
      status: 'created',
      createdAt: new Date().toISOString()
    };
    
    // Update workflow state
    await this.stateManager.dispatch(
      updateEntity(order, 'Order'),
      false,
      workflow.workflowInfo().workflowId
    );
    
    return order;
  }
}
```

##### **Using Blocking Actions**

Blocking actions prevent other actions from executing until they complete:

```typescript
class PaymentWorkflow extends StatefulWorkflow {
  @Action<ProcessPaymentInput, PaymentResult>({
    blocking: true // This action will prevent other actions from running concurrently
  })
  protected async processPayment(input: ProcessPaymentInput): Promise<PaymentResult> {
    // Critical payment processing logic that shouldn't run concurrently with other actions
    // ...
    
    return paymentResult;
  }
}
```

##### **Action with Complex State Updates**

Actions can perform complex state updates, including multiple dispatch operations:

```typescript
@Action<ShipOrderInput, ShipmentResult>()
protected async shipOrder(input: ShipOrderInput): Promise<ShipmentResult> {
  // First verify order exists and is ready to ship
  const order = this.getEntity('Order', input.orderId);
  if (!order) {
    throw new Error(`Order ${input.orderId} not found`);
  }
  
  if (order.status !== 'paid') {
    throw new Error(`Order ${input.orderId} is not ready for shipment`);
  }
  
  // Create shipment record
  const shipment = {
    id: `shipment-${Date.now()}`,
    orderId: input.orderId,
    carrier: input.carrier,
    trackingNumber: input.trackingNumber,
    status: 'created',
    createdAt: new Date().toISOString()
  };
  
  // Update both the shipment and the order in a coordinated way
  await this.stateManager.dispatch(
    updateEntity(shipment, 'Shipment'),
    false,
    workflow.workflowInfo().workflowId
  );
  
  await this.stateManager.dispatch(
    updateEntityPartial(
      { id: input.orderId, status: 'shipped', shipmentId: shipment.id },
      'Order'
    ),
    false,
    workflow.workflowInfo().workflowId
  );
  
  return { shipment, success: true };
}
```

#### **Validating Actions with `@Validator`**

The `@Validator` decorator complements `@Action` by providing a way to validate action inputs before execution:

```typescript
import { StatefulWorkflow, Action, Validator } from 'chrono-forge';

class OrderWorkflow extends StatefulWorkflow {
  @Action<CreateOrderInput, Order>()
  protected async createOrder(input: CreateOrderInput): Promise<Order> {
    // Implementation...
  }
  
  @Validator<CreateOrderInput>('createOrder')
  protected validateCreateOrder(input: CreateOrderInput) {
    if (!input.customerId) {
      throw new Error('Customer ID is required');
    }
    
    if (!input.items || input.items.length === 0) {
      throw new Error('Order must contain at least one item');
    }
    
    for (const item of input.items) {
      if (!item.productId) {
        throw new Error('Product ID is required for all items');
      }
      if (item.quantity <= 0) {
        throw new Error('Item quantity must be greater than zero');
      }
    }
  }
}
```

The validator runs automatically before the action is executed. If the validator throws an error, the action won't execute and the error will be propagated to the caller.

#### **Action Execution Flow**

When an action is executed, the following occurs:

1. The `actionRunning` flag is set to prevent concurrent execution of blocking actions.
2. If a validator exists for the action, it runs to validate the input.
3. The action method is called with the provided input.
4. Any errors during execution are caught and logged.
5. The `pendingIteration` flag is set to trigger a state update cycle.
6. The system waits for any pending state operations to complete.
7. The result is returned to the caller, or any error is propagated.

#### **Best Practices for Using Actions**

1. **Keep Actions Focused**: Each action should perform a single logical operation. Break complex operations into multiple actions.
2. **Use Descriptive Names**: Action names should clearly indicate their purpose (e.g., `createOrder`, `processPayment`, `updateCustomerProfile`).
3. **Leverage Type Safety**: Always specify input and output types for your actions to take advantage of TypeScript's type checking.
4. **Validate Inputs**: Use the `@Validator` decorator to validate action inputs, especially for user-generated data.
5. **Handle Errors Gracefully**: Implement proper error handling within actions, and design actions to be resilient to failures.
6. **Design for Idempotency**: Where possible, make actions idempotent so they can be safely retried if needed.
7. **Document Complex Actions**: Add detailed documentation for actions with complex business logic or state modifications.

#### **Integration with StatefulWorkflow**

The `@Action` decorator is primarily designed for use in `StatefulWorkflow` classes, where it integrates with the state management system. This integration provides several benefits:

- **State Consistency**: Actions ensure state updates are performed in a controlled and traceable manner.
- **Event Generation**: State changes made by actions trigger appropriate events for subscribers.
- **Concurrency Control**: The action system prevents race conditions when multiple actions attempt to modify the same state.
- **State Persistence**: Actions work with the memo persistence system to ensure state durability.

For more advanced usage of the action system, including complex state transformations and integration with external systems, see the [StatefulWorkflow Action System](../StatefulWorkflow/action_system.md) documentation.
