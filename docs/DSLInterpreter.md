# DSL Interpreter Documentation

ChronoForge provides a Domain-Specific Language (DSL) interpreter for defining and executing workflows.

## Basic DSL Structure

### DSL Definition

A workflow consists of a `DSLDefinition` with two main components:

- `variables`: Object storing workflow state
- `plan`: The root `Statement` that defines the workflow

### Statement Types

A `Statement` can include conditional execution properties:

- `when?: (variables: Record<string, unknown>, plan: Statement) => boolean`: Optional condition for execution
- `wait?: ((variables, plan) => boolean) | [(variables, plan) => boolean, number]`: Optional wait condition with optional timeout
- `retries?: number`: Optional retry count
- `timeout?: number`: Optional timeout duration
- `required?: boolean`: Whether the statement is required

A statement must contain one of:

- `{ execute: Execute }`: Represents an executable activity, step, workflow, or code block
- `{ sequence: Sequence }`: Represents statements executed in order
- `{ parallel: Parallel }`: Represents statements executed concurrently
- `{ foreach: ForEach }`: Iterates over an array of items
- `{ while: While }`: Executes while condition is true
- `{ doWhile: DoWhile }`: Executes at least once, then while condition is true

### Execute Types

```typescript
type Execute = {
  // Optional name, defaults to the name of the step, activity or workflow
  name?: string;

  code?: string;
  step?: string;
  activity?: string;
  workflow?: string;

  with?: string[];
  store?: string;
} & StatementConditions;
```

### Control Flow Types

```typescript
type ForEach = {
  in: string;
  as: string;
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
   - Each activity/step/code block is represented as a node in the graph
   - Dependencies are determined by argument references
   - Each node stores:
     - Type (activity/step/workflow/code/sequence/foreach/while/doWhile)
     - Name
     - Arguments
     - Result binding
     - Execution function
     - Condition (if any)
     - Wait condition (if any)

2. **Execution Flow**:
   - The interpreter yields generations of nodes that can be executed in parallel
   - Each generation contains:
     - `nodeId`: Unique identifier for the current node
     - `nodeIds`: Array of all node IDs in the current generation
     - `execute`: Function to execute the node's activity/step/code
   - Conditions are evaluated before node execution
   - Wait conditions are checked before execution
   - Results are stored in the DSL variables object

3. **Dependency Resolution**:
   - Arguments can reference:
     - Variables from the DSL state
     - Results from previous activities/steps
   - The graph ensures proper execution order based on dependencies

4. **Control Flow Structures**:
   - `sequence`: Executes child statements in order
   - `parallel`: Executes child statements concurrently
   - `foreach`: Iterates over an array, binding each item to a variable
   - `while`: Repeats a statement while a condition is true
   - `doWhile`: Executes a statement at least once, then repeats while a condition is true

5. **Visualization**:
   - Workflows can be visualized in list or tree format
   - Color-coded by node type
   - Shows dependencies between nodes

## Feature Details

### Code Execution

The DSL supports direct code execution with the `code` property:

```typescript
{
  execute: {
    code: "const result = x + y; return result;",
    with: ["x", "y"],
    store: "sum"
  }
}
```

The code is executed in a context where:

- Variables listed in `with` are available directly
- Other workflow variables are accessible through the context
- Results can be returned and stored in the specified variable

### Wait Conditions

Wait conditions can be applied to any statement, pausing execution until:

1. The condition becomes true, or
2. An optional timeout is reached

```typescript
{
  execute: {
    activity: "processData",
    store: "result"
  },
  wait: [(variables) => variables.ready === true, 5] // 5 second timeout
}
```

### Conditional Execution

The `when` property determines if a statement should execute:

```typescript
{
  when: (variables) => variables.shouldProcess === true,
  execute: {
    activity: "processData",
    with: ["input"],
    store: "result"
  }
}
```

### Control Flow

#### ForEach Loop

```typescript
{
  foreach: {
    in: "items",
    as: "currentItem",
    body: {
      execute: {
        activity: "processItem",
        with: ["currentItem"],
        store: "results"
      }
    }
  }
}
```

#### While Loop

```typescript
{
  while: {
    condition: (variables) => variables.count < 5,
    body: {
      execute: {
        activity: "increment",
        with: ["count"],
        store: "count"
      }
    }
  }
}
```

#### DoWhile Loop

```typescript
{
  doWhile: {
    body: {
      execute: {
        activity: "process",
        with: ["data"],
        store: "result"
      }
    },
    condition: (variables) => variables.shouldContinue === true
  }
}
```

## Example Usage

```typescript
const dsl: DSLDefinition = {
  variables: { 
    input: 'test_data',
    ready: false
  },
  plan: {
    sequence: {
      elements: [
        // Execute code directly
        {
          execute: {
            code: "console.log('Starting workflow'); return true;",
            store: "started"
          }
        },
        // Wait for a condition with timeout
        {
          execute: {
            activity: 'processData',
            with: ['input'],
            store: 'processedResult'
          },
          wait: [
            (variables) => variables.ready === true,
            5 // 5 second timeout
          ]
        },
        // Conditional execution
        {
          when: (variables) => variables.processedResult === 'success',
          execute: {
            step: 'validateData',
            with: ['processedResult'],
            store: 'validationResult'
          }
        },
        // Parallel execution
        {
          parallel: {
            branches: [
              {
                execute: {
                  activity: 'notifyUser',
                  with: ['processedResult']
                }
              },
              {
                execute: {
                  activity: 'logResult',
                  with: ['validationResult']
                }
              }
            ]
          }
        },
        // ForEach loop
        {
          foreach: {
            in: "items",
            as: "item",
            body: {
              execute: {
                activity: "processItem",
                with: ["item"],
                store: "itemResults"
              }
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

## Step Integration

The DSL interpreter integrates with ChronoForge step decorators:

```typescript
// Convert workflow steps to DSL
const steps: StepMetadata[] = [
  { name: 'step1', method: 'processData' },
  { name: 'step2', method: 'validateData', after: 'step1' },
  { name: 'step3', method: 'transformResult', after: 'step2' }
];

const dsl = convertStepsToDSL(steps, { initialData: 'value' });
const interpreter = DSLInterpreter(dsl, activities, stepFunctions);
```

## Best Practices

1. **Dependency Management**:
   - Use meaningful result names
   - Keep dependencies clear and explicit
   - Avoid circular dependencies

2. **Conditional Execution**:
   - Use `when` for dynamic workflow paths
   - Use `wait` for synchronization points
   - Keep conditions simple and focused
   - Handle both success and failure paths

3. **Error Handling**:
   - Implement proper error handling in activities/steps
   - Use retries for transient failures
   - Consider timeouts for long-running operations
   - Handle condition evaluation errors gracefully

4. **Code Execution**:
   - Keep code blocks focused on a single task
   - Use proper error handling in code blocks
   - Prefer activity/step functions for complex logic
   - Use code blocks for simple transformations

5. **Testing**:
   - Test individual activities/steps
   - Verify dependency chains
   - Test conditional paths
   - Validate error scenarios
   - Test timeout conditions
