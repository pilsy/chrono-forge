# Step Decorator

The `@Step` decorator is a powerful tool for defining workflow steps with dependencies, conditions, retry logic, and error handling. It allows you to create complex workflows with clear execution paths and robust error handling.

## Overview

The `@Step` decorator transforms methods in a workflow class into managed steps that are converted into a Domain-Specific Language (DSL) representation for execution. This approach provides advanced features like:

- **Dependency Management**: Define which steps should run before or after others
- **Conditional Execution**: Only execute steps when specific conditions are met
- **Retry Logic**: Automatically retry failed steps a configurable number of times
- **Timeout Handling**: Set timeouts for long-running steps
- **Error Handling**: Define custom error handlers for specific steps
- **Step Status Tracking**: Track which steps have been executed and their results
- **DSL Conversion**: Steps are automatically converted to a DSL representation for execution

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
    // The workflow will automatically convert @Step methods to DSL
    // and execute them in the correct order
    return await this.executeWorkflow();
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
    condition: function() { return this.condition; },
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
| `condition` | `() => boolean` | Condition function that determines if this step should be executed. The step will only run if this function returns true. |
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
| `condition` | `() => boolean` | Optional condition function for the step. |
| `before` | `string \| string[]` | Steps that should be executed before this step. |
| `after` | `string \| string[]` | Steps that should be executed after this step. |
| `retries` | `number` | Maximum number of retry attempts. |
| `timeout` | `number` | Timeout in milliseconds. |
| `required` | `boolean` | Whether this step is required for workflow completion. |
| `onError` | `(error: Error) => any` | Custom error handler for this step. |
| `executed` | `boolean` | Whether the step has been executed. |
| `result` | `any` | The result of the step execution. |
| `error` | `Error` | Error that occurred during step execution, if any. |

## DSL Conversion and Execution

When you use the `@Step` decorator in your workflow class, the following happens:

1. **Step Registration**: During workflow initialization, the `bindSteps()` method collects all steps defined with the `@Step` decorator.

2. **DSL Conversion**: The steps are converted to a DSL representation using the `convertStepsToDSL()` function, which:
   - Creates a directed graph to represent step dependencies
   - Resolves dependencies with topological sorting
   - Detects and prevents circular dependencies
   - Groups steps that can run in parallel
   - Preserves all step properties like conditions, retries, timeouts, etc.

3. **DSL Interpreter Creation**: The workflow creates a DSL interpreter to execute the converted steps.

4. **Execution**: When `executeWorkflow()` is called, the DSL interpreter executes the steps in the correct order, respecting all dependencies and conditions.

### How Step Execution Works

The workflow execution process now follows these steps:

1. The DSL interpreter determines which steps are ready to execute (all dependencies satisfied and conditions met)
2. It executes these steps in parallel when possible
3. Results from each step are stored and made available to subsequent steps
4. Steps with dependencies wait until their dependencies are complete
5. Conditional steps are only executed when their conditions evaluate to true
6. If a required step fails, the workflow fails (unless error handling is provided)
7. If a non-required step fails, the workflow continues

## StepExecutor vs DSL Interpreter

In previous versions, steps were executed by the `StepExecutor` class. Now, steps are converted to a DSL representation and executed by the `DSLInterpreter`. This provides several advantages:

- More flexible execution patterns
- Better parallel execution support
- Improved error handling
- Consistent execution model with other DSL-based workflows
- Support for complex workflow patterns like branches and loops

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
    
    // Execute the workflow, which will use the DSL created from step definitions
    await this.executeWorkflow();
    
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
    condition: function() { return this.orderValid; },
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
    condition: function() { return this.paymentSuccessful; }
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

2. **Use Conditions Wisely**: The `condition` function is powerful for creating branching workflows. Use it to skip steps that don't need to run based on the current state.

3. **Set Appropriate Retries**: For steps that might fail due to transient issues (like network calls), set a reasonable number of retries.

4. **Mark Non-Critical Steps**: Use `required: false` for steps that aren't critical to the workflow's success.

5. **Handle Errors Gracefully**: Provide custom error handlers for steps that might fail in expected ways.

6. **Avoid Circular Dependencies**: Ensure that your step dependencies don't create circular references, as this will cause the workflow to fail.

7. **Keep Steps Focused**: Each step should perform a single, well-defined task. This makes workflows easier to understand and maintain.

8. **Document Step Dependencies**: Clearly document the dependencies between steps, especially for complex workflows with many steps.

9. **Use Timeouts for Long-Running Steps**: Set timeouts for steps that might take a long time to complete to prevent workflows from hanging.

10. **Test Step Execution Order**: Verify that steps are executed in the expected order, especially when using complex dependency configurations.

## Conclusion

The `@Step` decorator provides a powerful way to define complex workflows that are automatically converted to a DSL representation for execution. This approach combines the simplicity of decorator-based step definitions with the flexibility and power of a domain-specific language for workflow execution.

For more information on the DSL execution model, see the [DSL Interpreter documentation](../DSLInterpreter.md).
