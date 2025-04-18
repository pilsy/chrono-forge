# DSL Interpreter Documentation

ChronoForge provides a Domain-Specific Language (DSL) interpreter for defining and executing workflows.

## Basic DSL Structure

### DSL Definition

A workflow consists of a `DSLDefinition` with two main components:

- `variables`: Object storing workflow state
- `plan`: The root `Statement` that defines the workflow

### Statement Types

A `Statement` can include:

- `when?: (variables: Record<string, unknown>, plan: Statement) => boolean`: Optional condition for execution
- `retries?: number`: Optional retry count
- `timeout?: number`: Optional timeout duration
- `required?: boolean`: Whether the statement is required
- `waitFor?: ((variables, plan) => boolean) | [(variables, plan) => boolean, number]`: Optional wait condition with optional timeout

And must contain one of:

- `{ execute: Execute }`: Represents an executable activity, step, or workflow
- `{ sequence: Sequence }`: Represents statements executed in order
- `{ parallel: Parallel }`: Represents statements executed concurrently
- `{ foreach: ForEach }`: Iterates over an array of items
- `{ while: While }`: Executes while condition is true
- `{ doWhile: DoWhile }`: Executes at least once, then while condition is true
- `{ condition: DSLCondition }`: Represents a conditional statement

### Execute Types

```typescript
type Execute = {
  code?: string;
  activity?: ActivityInvocation;
  step?: StepInvocation;
  workflow?: WorkflowInvocation;
};

type ActivityInvocation = {
  name: string;
  arguments?: string[];
  result?: string;
};

type StepInvocation = {
  name: string;
  arguments?: string[];
  result?: string;
};

type WorkflowInvocation = {
  name: string;
  arguments?: string[];
  result?: string;
};
```

### Control Flow Types

```typescript
type ForEach = {
  items: string;
  item: string;
  body: Statement;
};

type While = {
  condition: (variables: Record<string, unknown>, plan: Statement) => boolean;
  body: Statement;
};

type DoWhile = {
  body: Statement;
  condition: (variables: Record<string, unknown>, plan: Statement) => boolean;
};
```

## Execution Model

The DSL interpreter uses a dependency graph to manage execution:

1. **Graph Construction**:
   - Each activity/step is represented as a node in the graph
   - Dependencies are determined by argument references
   - Each node stores:
     - Type (activity/step/workflow)
     - Name
     - Arguments
     - Result binding
     - Execution function
     - Condition (if any)
     - WaitFor condition (if any)

2. **Execution Flow**:
   - The interpreter yields generations of nodes that can be executed in parallel
   - Each generation contains:
     - `nodeId`: Unique identifier for the current node
     - `nodeIds`: Array of all node IDs in the current generation
     - `execute`: Function to execute the node's activity/step
   - Conditions are evaluated before node execution
   - WaitFor conditions are checked before execution
   - Results are stored in the DSL variables object

3. **Dependency Resolution**:
   - Arguments can reference:
     - Variables from the DSL state
     - Results from previous activities/steps
   - The graph ensures proper execution order based on dependencies

## Example Usage

```typescript
const dsl: DSLDefinition = {
  variables: { input: 'test_data' },
  plan: {
    sequence: {
      elements: [
        {
          execute: {
            activity: {
              name: 'processData',
              arguments: ['input'],
              result: 'processedResult'
            }
          },
          waitFor: [
            (variables) => variables.ready === true,
            5 // 5 second timeout
          ]
        },
        {
          when: async (dsl) => dsl.variables['processedResult'] === 'success',
          execute: {
            step: {
              name: 'validateData',
              arguments: ['processedResult'],
              result: 'validationResult'
            }
          }
        }
      ]
    }
  }
};

const interpreter = DSLInterpreter(dsl, activities, steps);

for await (const generation of interpreter) {
  const result = await generation.execute();
  // Handle result
}
```

## Best Practices

1. **Dependency Management**:
   - Use meaningful result names
   - Keep dependencies clear and explicit
   - Avoid circular dependencies
   - Use array access notation for complex data structures (e.g., `items[0].url`)

2. **Conditional Execution**:
   - Use `when` for dynamic workflow paths
   - Use `waitFor` for synchronization points
   - Keep conditions simple and focused
   - Handle both success and failure paths

3. **Error Handling**:
   - Implement proper error handling in activities/steps
   - Use retries for transient failures
   - Consider timeouts for long-running operations
   - Handle condition evaluation errors gracefully

4. **Testing**:
   - Test individual activities/steps
   - Verify dependency chains
   - Test conditional paths
   - Validate error scenarios
   - Test timeout conditions
