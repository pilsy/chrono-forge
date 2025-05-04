# Type-Safe Action System in StatefulWorkflow

## Introduction to the Action Pattern

The Action pattern in `StatefulWorkflow` provides a structured approach to implementing business logic operations that modify workflow state. Actions represent discrete, purposeful operations that can be executed within a workflow to perform specific tasks, such as creating entities, updating records, or performing state transitions.

The Action system offers several key advantages:

- **Type Safety**: Actions are fully typed, with explicit input and output types for improved developer experience.
- **Encapsulation**: Business logic is encapsulated within dedicated action handlers.
- **Traceability**: Actions provide a clear record of operations performed on workflow state.
- **Controlled Execution**: Actions are executed within a controlled context that ensures proper state handling.
- **Concurrency Management**: The action system prevents overlapping executions of actions that could lead to race conditions.

## Defining and Using Actions with @Action Decorator

Actions in `StatefulWorkflow` are defined using the `@Action` decorator, which marks a class method as an action handler:

```typescript
import { StatefulWorkflow, Action } from 'chrono-forge';

interface AddItemPayload {
  name: string;
  quantity: number;
}

interface Item {
  id: string;
  name: string;
  quantity: number;
  createdAt: string;
}

class InventoryWorkflow extends StatefulWorkflow {
  @Action<AddItemPayload, Item>()
  protected async addItem(payload: AddItemPayload): Promise<Item> {
    const newItem: Item = {
      id: nanoid(),
      name: payload.name,
      quantity: payload.quantity,
      createdAt: new Date().toISOString()
    };
    
    // Update workflow state with the new item
    await this.stateManager.dispatch(
      updateEntity(newItem, 'Item'),
      false,
      workflow.workflowInfo().workflowId
    );
    
    return newItem;
  }
}
```

### Action Decorator Options

The `@Action` decorator accepts an optional configuration object with the following properties:

```typescript
export interface ActionOptions<TInput = any, TOutput = any> {
  blocking?: boolean;
  inputType?: TInput;
  outputType?: TOutput;
}
```

- **`blocking`**: When set to `true`, the action will block other actions from executing until it completes. Default is `false`.
- **`inputType`**: Type definition for the action's input parameters (used for advanced type validation scenarios).
- **`outputType`**: Type definition for the action's return value (used for advanced type validation scenarios).

## Typed Input and Output for Actions

One of the key benefits of the Action system is its support for type safety through generics. When defining an action, you can specify the exact input and output types that the action will work with:

```typescript
@Action<UpdateOrderStatusInput, OrderStatus>()
protected async updateOrderStatus(input: UpdateOrderStatusInput): Promise<OrderStatus> {
  // Implementation with full type safety
}
```

This provides several advantages:

1. **Compile-Time Type Checking**: The TypeScript compiler will verify that the input parameters and return values match the expected types.
2. **IDE Support**: Your IDE can provide intelligent autocomplete and documentation for input and output types.
3. **Self-Documenting Code**: The types explicitly define what data the action expects and produces.
4. **Refactoring Safety**: Changes to types will highlight all places where updates are needed.

## Executing Actions and Handling Results

Actions in `StatefulWorkflow` are typically executed in response to external signals or workflow events. The `runAction` method is used internally to execute actions in a controlled manner:

```typescript
// Example of how actions are executed internally
const result = await this.runAction('addItem', { name: 'Widget', quantity: 10 });
```

### Action Execution Flow

When an action is executed through the `runAction` method, the following occurs:

1. The `actionRunning` flag is set to prevent concurrent execution of actions.
2. The specified action method is called with the provided input.
3. Any errors during execution are caught and logged.
4. The `pendingIteration` flag is set to trigger a state update cycle.
5. The system waits for any pending state operations to complete.
6. The result is returned to the caller, or any error is propagated.

### Error Handling

Actions include built-in error handling. When an action throws an error:

1. The error is caught and logged.
2. The action running state is properly reset.
3. The error is propagated to the caller for additional handling.

### State Integration

Actions are deeply integrated with the state management system in `StatefulWorkflow`:

1. Actions can dispatch state updates through the `stateManager`.
2. State changes made by actions trigger related events and subscriptions.
3. Actions can query current state through the normalized state store.
4. After action execution, the workflow iteration cycle ensures state consistency.

## Best Practices for Using Actions

### 1. Keep Actions Focused

Design actions to perform a single logical operation or state transition. Rather than creating a large action that does many things, break it down into multiple targeted actions.

### 2. Use Descriptive Names

Name your actions clearly to indicate what operation they perform:

- `createCustomer`
- `updateOrderStatus`
- `processPayment`
- `cancelSubscription`

### 3. Leverage Type Safety

Always specify explicit input and output types for your actions to take full advantage of TypeScript's type system.

### 4. Handle Errors Properly

Include proper error handling within your actions. Consider using try-catch blocks for specific error cases that require special handling.

### 5. Maintain Idempotency

Where possible, design actions to be idempotent (can be executed multiple times with the same result). This improves resilience in distributed systems.

### 6. Document Complex Actions

For actions with complex business logic, add documentation that explains the purpose, inputs, outputs, and any side effects.

## Example Use Cases

### 1. Order Processing

```typescript
interface ProcessPaymentInput {
  orderId: string;
  paymentMethod: string;
  amount: number;
}

interface PaymentResult {
  transactionId: string;
  status: 'success' | 'failed';
  processedAt: string;
}

@Action<ProcessPaymentInput, PaymentResult>()
protected async processPayment(input: ProcessPaymentInput): Promise<PaymentResult> {
  // Process payment logic
  const result: PaymentResult = {
    transactionId: `txn-${nanoid()}`,
    status: 'success',
    processedAt: new Date().toISOString()
  };
  
  // Update order with payment information
  await this.stateManager.dispatch(
    updateEntityPartial({ id: input.orderId, paymentStatus: 'paid', paymentId: result.transactionId }, 'Order'),
    false,
    workflow.workflowInfo().workflowId
  );
  
  return result;
}
```

### 2. User Management

```typescript
interface CreateUserInput {
  email: string;
  name: string;
  role: string;
}

@Action<CreateUserInput, User>()
protected async createUser(input: CreateUserInput): Promise<User> {
  const user: User = {
    id: `user-${nanoid()}`,
    email: input.email,
    name: input.name,
    role: input.role,
    createdAt: new Date().toISOString(),
    status: 'active'
  };
  
  await this.stateManager.dispatch(
    updateEntity(user, 'User'),
    false,
    workflow.workflowInfo().workflowId
  );
  
  return user;
}
```

### 3. Multi-Step Operations

```typescript
interface ShipmentInput {
  orderId: string;
  carrier: string;
  trackingCode?: string;
}

@Action<ShipmentInput, Shipment>()
protected async createShipment(input: ShipmentInput): Promise<Shipment> {
  // First check if order exists and is ready to ship
  const order = this.getEntity('Order', input.orderId);
  if (!order) {
    throw new Error(`Order ${input.orderId} not found`);
  }
  
  if (order.status !== 'ready') {
    throw new Error(`Order ${input.orderId} is not ready for shipment`);
  }
  
  // Create shipment record
  const shipment: Shipment = {
    id: `shipment-${nanoid()}`,
    orderId: input.orderId,
    carrier: input.carrier,
    trackingCode: input.trackingCode || await this.generateTrackingCode(input.carrier),
    status: 'created',
    createdAt: new Date().toISOString()
  };
  
  // Update order status
  await this.stateManager.dispatch(
    updateEntityPartial({ id: input.orderId, status: 'shipped', shipmentId: shipment.id }, 'Order'),
    false,
    workflow.workflowInfo().workflowId
  );
  
  // Save shipment record
  await this.stateManager.dispatch(
    updateEntity(shipment, 'Shipment'),
    false,
    workflow.workflowInfo().workflowId
  );
  
  return shipment;
}
```

## Conclusion

The Action system in `StatefulWorkflow` provides a powerful, type-safe approach to implementing business logic operations within Temporal workflows. By leveraging the `@Action` decorator, developers can create discrete, focused operations that modify workflow state in a controlled, traceable manner, while benefiting from full TypeScript type support and integration with the workflow's state management system.

Using actions makes workflows more maintainable, easier to test, and provides better developer experience through improved type safety and error handling.
