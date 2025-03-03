# Step Decorator

The `@Step` decorator is a powerful tool for defining workflow steps with dependencies, conditions, retry logic, and error handling. It allows you to create complex workflows with clear execution paths and robust error handling.

## Overview

The `@Step` decorator transforms methods in a workflow class into managed steps that can be executed in a specific order based on dependencies and conditions. It provides features like:

- **Dependency Management**: Define which steps should run before or after others
- **Conditional Execution**: Only execute steps when specific conditions are met
- **Retry Logic**: Automatically retry failed steps a configurable number of times
- **Timeout Handling**: Set timeouts for long-running steps
- **Error Handling**: Define custom error handlers for specific steps
- **Step Status Tracking**: Track which steps have been executed and their results

## Usage

### Basic Usage

```typescript
import { Workflow, Step, Temporal } from 'chrono-forge';

@Temporal()
class MyWorkflow extends Workflow {
  @Step()
  async step1() {
    // This step will run first
  }

  @Step({ after: 'step1' })
  async step2() {
    // This step will run after step1
  }

  protected async execute() {
    // Execute all steps in the correct order
    return await this.executeSteps();
  }
}
```

### Advanced Usage

```typescript
@Temporal()
class AdvancedWorkflow extends Workflow {
  private condition = false;

  @Step({
    name: 'customStepName',
    retries: 3,
    timeout: 5000, // 5 seconds
    on: function() { return this.condition; },
    onError: (error) => console.error('Step failed:', error)
  })
  async myStep() {
    // This step will:
    // - Be named 'customStepName' instead of 'myStep'
    // - Only run if this.condition is true
    // - Retry up to 3 times if it fails
    // - Timeout after 5 seconds
    // - Log errors with the custom error handler
  }

  @Step({
    after: ['step1', 'step2'], // Run after both step1 and step2
    before: 'finalStep',       // Run before finalStep
    required: false            // Workflow can complete even if this step fails
  })
  async optionalStep() {
    // This is an optional step with multiple dependencies
  }
}
```

## API Reference

### StepOptions

The `@Step` decorator accepts an options object with the following properties:

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | Custom name for the step. If not provided, the method name will be used. |
| `on` | `() => boolean` | Condition function that determines if this step should be executed. The step will only run if this function returns true. |
| `before` | `string \| string[]` | Steps that should be executed before this step. Can be a single step name or an array of step names. |
| `after` | `string \| string[]` | Steps that should be executed after this step. Can be a single step name or an array of step names. |
| `retries` | `number` | Maximum number of retry attempts if the step fails. Default is 0 (no retries). |
| `timeout` | `number` | Timeout in milliseconds after which the step execution will be aborted. Default is undefined (no timeout). |
| `required` | `boolean` | Whether this step is required for workflow completion. If false, workflow can complete even if this step fails or is skipped. Default is true. |
| `onError` | `(error: Error) => any` | Custom error handler for this specific step. |

### StepMetadata

The `StepMetadata` interface represents the metadata for a step, including:

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | The name of the step. |
| `method` | `string` | The name of the method that implements the step. |
| `on` | `() => boolean` | Optional condition function for the step. |
| `before` | `string \| string[]` | Steps that should be executed before this step. |
| `after` | `string \| string[]` | Steps that should be executed after this step. |
| `retries` | `number` | Maximum number of retry attempts. |
| `timeout` | `number` | Timeout in milliseconds. |
| `required` | `boolean` | Whether this step is required for workflow completion. |
| `onError` | `(error: Error) => any` | Custom error handler for this step. |
| `executed` | `boolean` | Whether the step has been executed. |
| `result` | `any` | The result of the step execution. |

### Workflow Methods

The `Workflow` class provides several methods for working with steps:

| Method | Return Type | Description |
|--------|-------------|-------------|
| `executeSteps()` | `Promise<Record<string, any>>` | Execute all steps in the correct order based on dependencies and conditions. Returns an object with the results of each step. |
| `getCurrentSteps()` | `string[]` | Get the names of steps that are ready to be executed (all dependencies satisfied and conditions met). |
| `isStepsComplete` | `boolean` | Check if all required steps have been executed. |
| `getSteps()` | `StepMetadata[]` | Get all steps defined for this workflow with their metadata. |

## Step Execution Engine

The `StepExecutor` class is responsible for executing steps in the correct order based on their dependencies and conditions. It provides the following functionality:

### Dependency Resolution

The `StepExecutor` uses a topological sort algorithm to resolve step dependencies and determine the execution order. This ensures that steps are executed in the correct order based on their `before` and `after` dependencies.

### Conditional Execution

Steps can be conditionally executed based on the `on` function. If the `on` function returns `false`, the step will be skipped.

### Error Handling

If a step fails and has a custom error handler defined with the `onError` option, the error handler will be called. If the step is marked as `required: false`, the workflow can continue even if the step fails.

### Retry Logic

If a step fails and has a `retries` value greater than 0, it will be retried up to the specified number of times. This is useful for handling transient errors.

### Timeout Handling

If a step has a `timeout` value, it will be aborted if it takes longer than the specified timeout. This prevents steps from hanging indefinitely.

## StepExecutor Class

The `StepExecutor` class is a utility class that handles the execution of workflow steps. It is used internally by the `Workflow` class to manage step execution.

### Static Methods

#### `executeSteps(instance: any, steps: StepMetadata[]): Promise<Record<string, any>>`

Executes all steps in the correct order based on dependencies and conditions.

- **Parameters**:
  - `instance`: The workflow instance containing the step methods
  - `steps`: Array of step metadata
- **Returns**: Object containing the results of each step execution

#### `getCurrentSteps(instance: any, steps: StepMetadata[]): string[]`

Gets the names of steps that are ready to be executed (all dependencies satisfied and conditions met).

- **Parameters**:
  - `instance`: The workflow instance
  - `steps`: Array of step metadata
- **Returns**: Array of step names that are ready to be executed

#### `isComplete(steps: StepMetadata[]): boolean`

Checks if all required steps have been executed.

- **Parameters**:
  - `steps`: Array of step metadata
- **Returns**: True if all required steps have been executed

### Implementation Details

The `StepExecutor` uses a topological sort algorithm to resolve step dependencies:

```typescript
private static resolveStepDependencies(steps: StepMetadata[]): string[] {
  const graph = new Map<string, { dependencies: string[]; dependents: string[] }>();

  // Initialize graph
  for (const step of steps) {
    graph.set(step.name, { dependencies: [], dependents: [] });
  }

  // Build dependency graph
  for (const step of steps) {
    if (step.before) {
      const beforeSteps = Array.isArray(step.before) ? step.before : [step.before];
      for (const beforeStep of beforeSteps) {
        if (graph.has(beforeStep)) {
          graph.get(beforeStep)!.dependencies.push(step.name);
          graph.get(step.name)!.dependents.push(beforeStep);
        }
      }
    }

    if (step.after) {
      const afterSteps = Array.isArray(step.after) ? step.after : [step.after];
      for (const afterStep of afterSteps) {
        if (graph.has(afterStep)) {
          graph.get(step.name)!.dependencies.push(afterStep);
          graph.get(afterStep)!.dependents.push(step.name);
        }
      }
    }
  }

  // Topological sort
  const visited = new Set<string>();
  const temp = new Set<string>();
  const order: string[] = [];

  function visit(stepName: string) {
    if (temp.has(stepName)) {
      throw new Error(`Circular dependency detected in workflow steps involving '${stepName}'`);
    }

    if (!visited.has(stepName)) {
      temp.add(stepName);

      const node = graph.get(stepName);
      if (node) {
        for (const dep of node.dependencies) {
          visit(dep);
        }
      }

      temp.delete(stepName);
      visited.add(stepName);
      order.push(stepName);
    }
  }

  // Visit all nodes
  for (const stepName of graph.keys()) {
    if (!visited.has(stepName)) {
      visit(stepName);
    }
  }

  return order;
}
```

This algorithm ensures that steps are executed in the correct order, respecting all dependencies and detecting circular dependencies.

## Example Workflow

Here's a complete example of a workflow that processes an order through multiple steps:

```typescript
import { Workflow, Step, Temporal } from 'chrono-forge';
import { workflow } from '@temporalio/workflow';

interface OrderParams {
  orderId: string;
  items: string[];
  total: number;
}

interface OrderResult {
  orderId: string;
  success: boolean;
  steps: {
    validation: boolean;
    payment: boolean;
    shipment: boolean;
  };
}

@Temporal({ name: 'OrderProcessingWorkflow' })
export class OrderProcessingWorkflow extends Workflow<OrderParams, {}> {
  private orderValid = false;
  private paymentSuccessful = false;
  private shipmentPrepared = false;

  protected async execute(): Promise<OrderResult> {
    this.log.info(`Starting order processing for order ${this.args.orderId}`);
    
    // Execute all steps in the correct order
    const results = await this.executeSteps();
    
    return {
      orderId: this.args.orderId,
      success: this.paymentSuccessful && this.shipmentPrepared,
      steps: {
        validation: this.orderValid,
        payment: this.paymentSuccessful,
        shipment: this.shipmentPrepared
      }
    };
  }

  @Step({
    name: 'validateOrder',
    retries: 2
  })
  private async validateOrder(): Promise<boolean> {
    this.log.info(`Validating order ${this.args.orderId}`);
    
    // Simulate validation logic
    await workflow.sleep('1s');
    
    this.orderValid = this.args.items.length > 0 && this.args.total > 0;
    return this.orderValid;
  }

  @Step({
    name: 'processPayment',
    after: 'validateOrder',
    on: function() { return this.orderValid; },
    retries: 3
  })
  private async processPayment(): Promise<boolean> {
    this.log.info(`Processing payment for order ${this.args.orderId}`);
    
    // Simulate payment processing
    await workflow.sleep('2s');
    
    this.paymentSuccessful = true;
    return true;
  }

  @Step({
    name: 'prepareShipment',
    after: 'processPayment',
    on: function() { return this.paymentSuccessful; }
  })
  private async prepareShipment(): Promise<boolean> {
    this.log.info(`Preparing shipment for order ${this.args.orderId}`);
    
    // Simulate shipment preparation
    await workflow.sleep('3s');
    
    this.shipmentPrepared = true;
    return true;
  }
}
```

## Best Practices

1. **Name Your Steps**: Always provide meaningful names for your steps to make dependencies and logs easier to understand.

2. **Use Conditions Wisely**: The `on` condition is powerful for creating branching workflows. Use it to skip steps that don't need to run based on the current state.

3. **Set Appropriate Retries**: For steps that might fail due to transient issues (like network calls), set a reasonable number of retries.

4. **Mark Non-Critical Steps**: Use `required: false` for steps that aren't critical to the workflow's success.

5. **Handle Errors Gracefully**: Provide custom error handlers for steps that might fail in expected ways.

6. **Avoid Circular Dependencies**: Ensure that your step dependencies don't create circular references, as this will cause the workflow to fail.

7. **Keep Steps Focused**: Each step should perform a single, well-defined task. This makes workflows easier to understand and maintain.

8. **Document Step Dependencies**: Clearly document the dependencies between steps, especially for complex workflows with many steps.

9. **Use Timeouts for Long-Running Steps**: Set timeouts for steps that might take a long time to complete to prevent workflows from hanging.

10. **Test Step Execution Order**: Verify that steps are executed in the expected order, especially when using complex dependency configurations.

## Conclusion

The `@Step` decorator provides a powerful way to define complex workflows with clear execution paths, robust error handling, and flexible dependency management. By using steps, you can create workflows that are easier to understand, maintain, and debug.

For more examples and advanced usage patterns, refer to the [Complete Usage Example](./Workflow/complete_example.md) section.
