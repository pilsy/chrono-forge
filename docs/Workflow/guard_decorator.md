# `@Guard` Decorator

## Introduction to the `@Guard` Decorator

The `@Guard` decorator in ChronoForge provides a way to protect method execution with conditional checks. It acts as a gatekeeper that determines whether a method should execute based on the result of a predicate function. This pattern is useful for enforcing preconditions, implementing access control, or adding runtime validation to methods within a workflow.

## Purpose of the `@Guard` Decorator

The primary purposes of the `@Guard` decorator are:

- **Precondition Enforcement**: Ensure that methods are only executed when certain conditions are met
- **Runtime Validation**: Add runtime checks to methods without cluttering the method implementation
- **Access Control**: Control when and how methods can be accessed
- **Separation of Concerns**: Separate validation logic from business logic

## How the `@Guard` Decorator Works

The `@Guard` decorator wraps the target method with additional logic that:

1. Executes a check function before the method is called
2. Passes all the original method arguments to the check function
3. Only allows the original method to execute if the check function returns `true`
4. Throws an error if the check function returns `false`

## Usage Example

### Basic Usage

```typescript
import { Workflow, Guard } from 'chrono-forge';

class OrderWorkflow extends Workflow {
  private isOrderValid = false;
  
  @Guard(function() {
    return this.isOrderValid;
  })
  protected async processOrder(orderId: string): Promise<void> {
    // This method will only execute if isOrderValid is true
    this.log.info(`Processing order: ${orderId}`);
    // Order processing logic...
  }
  
  async validateOrder(orderId: string): Promise<void> {
    // Validation logic...
    this.isOrderValid = true;
  }
}
```

### Using Method Arguments in Guards

The guard function receives the same arguments as the method it's guarding:

```typescript
class PaymentWorkflow extends Workflow {
  @Guard(function(amount: number) {
    return amount > 0 && amount <= 10000;
  })
  protected async processPayment(amount: number): Promise<void> {
    // This method will only execute if amount is positive and <= 10000
    this.log.info(`Processing payment: $${amount}`);
    // Payment processing logic...
  }
}
```

### Asynchronous Guards

The guard function can be asynchronous, allowing for more complex validation:

```typescript
class UserWorkflow extends Workflow {
  @Guard(async function(userId: string) {
    const userExists = await this.checkUserExists(userId);
    return userExists;
  })
  protected async updateUserProfile(userId: string, profile: any): Promise<void> {
    // This method will only execute if the user exists
    this.log.info(`Updating profile for user: ${userId}`);
    // Profile update logic...
  }
  
  private async checkUserExists(userId: string): Promise<boolean> {
    // Logic to check if user exists...
    return true;
  }
}
```

## Advanced Usage

### Combining with Other Decorators

The `@Guard` decorator can be combined with other decorators for more complex behaviors:

```typescript
class TaskWorkflow extends Workflow {
  @Step({ name: 'process-task' })
  @Guard(function(taskId: string) {
    return this.canProcessTask(taskId);
  })
  protected async processTask(taskId: string): Promise<void> {
    // This method will only execute if canProcessTask returns true
    // It will also be treated as a workflow step
    this.log.info(`Processing task: ${taskId}`);
    // Task processing logic...
  }
  
  private canProcessTask(taskId: string): boolean {
    // Logic to determine if task can be processed...
    return true;
  }
}
```

### Creating Reusable Guards

You can create reusable guards by defining factory functions:

```typescript
// Reusable guard factory
function requireRole(role: string) {
  return function(this: any) {
    return this.hasRole(role);
  };
}

class AdminWorkflow extends Workflow {
  @Guard(requireRole('admin'))
  protected async performAdminAction(): Promise<void> {
    // This method will only execute if the workflow has admin role
    this.log.info('Performing admin action');
    // Admin action logic...
  }
  
  private hasRole(role: string): boolean {
    // Logic to check if workflow has the required role...
    return true;
  }
}
```

### Error Customization

By default, the `@Guard` decorator throws a generic error when the guard check fails. For more informative errors, you can create custom guard factories:

```typescript
function requirePermission(permission: string) {
  return function(this: any) {
    const hasPermission = this.hasPermission(permission);
    if (!hasPermission) {
      throw new Error(`Permission denied: ${permission} is required`);
    }
    return hasPermission;
  };
}

class DocumentWorkflow extends Workflow {
  @Guard(requirePermission('document:write'))
  protected async updateDocument(docId: string): Promise<void> {
    // This method will only execute if the workflow has write permission
    this.log.info(`Updating document: ${docId}`);
    // Document update logic...
  }
  
  private hasPermission(permission: string): boolean {
    // Logic to check if workflow has the required permission...
    return false; // This will trigger a custom error
  }
}
```

## Best Practices

### 1. Keep Guard Functions Simple

Guard functions should be simple and focused on validation. Complex logic should be moved to helper methods.

### 2. Handle Guard Failures Gracefully

When a guard fails, it throws an error. Make sure to handle these errors appropriately in your workflow.

```typescript
try {
  await this.processOrder('order-123');
} catch (error) {
  this.log.error(`Order processing failed: ${error.message}`);
  // Handle the error, e.g., by updating the order status
}
```

### 3. Document Guard Conditions

Document the conditions that your guard functions check for, so other developers understand when methods can be called.

### 4. Use Descriptive Error Messages

When creating custom guard functions, use descriptive error messages that explain why the guard check failed.

### 5. Consider the Performance Impact

Guard functions are executed on every method call, so be mindful of performance-intensive operations in guards.

## Integration with Workflow Features

The `@Guard` decorator integrates well with other workflow features:

- **State Management**: Guards can check the workflow state before allowing methods to execute
- **Signals and Queries**: Guards can protect signal and query handlers from inappropriate invocation
- **Steps**: Guards can add additional conditions to step execution beyond what's provided by the `@Step` decorator

## Conclusion

The `@Guard` decorator provides a powerful way to add conditional execution to workflow methods. By separating validation logic from method implementation, guards improve code readability and help enforce business rules at runtime. This pattern enhances workflow reliability by ensuring methods only execute under appropriate conditions.
