# DSL Interpreter Documentation

ChronoForge provides two Domain-Specific Language (DSL) interpreters for defining and executing workflows:

1. **Basic DSLInterpreter**: A simple interpreter for activity-based workflows
2. **DSLRuntimeGraphInterpreter**: An advanced interpreter with rich control flow capabilities

## Basic DSL Interpreter

### DSL Structure Rules

1. **Root Element**:
   - The workflow begins with a `root` object, which is always of type `Statement`.
   - The DSL document also contains a `variables` object for storing state.

2. **Statement Types**:
   - A `Statement` can be one of the following:
     - `{ activity: ActivityInvocation }`: Represents a single executable activity.
     - `{ sequence: Sequence }`: Represents a sequence of statements that are executed in order.
     - `{ parallel: Parallel }`: Represents a set of branches that should be executed in parallel.

3. **Activity Invocation**:

   ```typescript
   type ActivityInvocation = {
     name: string;
     arguments?: string[];
     result?: string;
     group?: number; // Optional group indicating the spacing of this activity in a level
   };
   ```

   - `name`: String representing the function or activity to execute.
   - `arguments`: Array of strings representing the inputs to the activity. These can be literal values or bindings to results of previous activities.
   - `result`: Optional string used to store the output of the activity for use in subsequent activities.
   - `group`: Optional group indicating the spacing of this activity in a level.

4. **Sequence**:

   ```typescript
   type Sequence = {
     elements: Statement[];
     level?: number; // Optional level indicating the height of execution
   };
   ```

   - A `sequence` contains an `elements` array, which holds a list of `Statement` objects to be executed in a specific order.
   - `level`: Optional level indicating the height of execution.

5. **Parallel**:

   ```typescript
   type Parallel = {
     branches: Statement[];
     level?: number; // Optional level indicating the height of execution
   };
   ```

   - A `parallel` contains a `branches` array, where each entry is a `Statement` representing a branch of execution that should occur concurrently with other branches.
   - `level`: Optional level indicating the height of execution.

### Execution Model

The basic DSL interpreter uses a dependency graph to manage execution:

1. **Dependency Graph Construction**:
   - Each activity is represented as a node in the graph.
   - Dependencies between activities are determined by argument references.
   - The graph ensures that activities are executed in the correct order.

2. **Execution Flow**:
   - Activities with no dependencies are executed first.
   - As activities complete, their results are stored in the bindings.
   - Dependent activities are executed once all their dependencies are satisfied.

## Advanced DSL Runtime Graph Interpreter

The `DSLRuntimeGraphInterpreter` provides a much richer set of control flow constructs for complex workflows.

### DSL Document Structure

```typescript
type DSLDocument = {
  state: Record<string, any>;
  plan: DSLStatement;
};
```

- `state`: Initial state/variables for the workflow
- `plan`: The root statement that defines the workflow

### Statement Types

The `DSLStatement` type supports a wide range of control flow constructs:

```typescript
type DSLStatement = {
  if?: Conditions;
  elseif?: { condition: Conditions; then: DSLStatement | DSLStatement[] }[];
  else?: DSLStatement | DSLStatement[];
  execute?: Execute;
  sequence?: Sequence;
  parallel?: Parallel;
  loop?: Loop;
  wait?: Wait;
  goTo?: GoTo;
  label?: string;
  switch?: Switch;
  retry?: Retry;
  mapReduce?: MapReduce;
  forkJoin?: ForkJoin;
  circuitBreaker?: CircuitBreaker;
  subWorkflow?: SubWorkflow;
  group?: Group;
  while?: While;
  doWhile?: DoWhile;
  break?: Break;
  continue?: Continue;
  timeout?: Timeout;
  catch?: DSLStatement | DSLStatement[];
  finally?: DSLStatement | DSLStatement[];
};
```

### Key Control Flow Constructs

1. **Execute**:

   ```typescript
   type Execute = { 
     name: string; 
     needs?: string[]; 
     provides?: string[]; 
     handler?: string; 
     retries?: number 
   };
   ```

   - Executes a named activity with specified dependencies and outputs.

2. **Conditional Logic**:
   - `if`, `elseif`, `else`: Standard conditional branching
   - `switch`: Multi-way branching based on an expression

3. **Loops**:
   - `while`: Pre-condition loop
   - `doWhile`: Post-condition loop
   - `loop`: Generalized loop with condition
   - `break`, `continue`: Loop control

4. **Parallel Execution**:
   - `parallel`: Execute multiple branches concurrently
   - `forkJoin`: Fork multiple tasks and join their results
   - `mapReduce`: Parallel map operation followed by a reduce

5. **Error Handling**:
   - `retry`: Retry a failed operation
   - `circuitBreaker`: Prevent cascading failures
   - `catch`, `finally`: Exception handling

6. **Workflow Control**:
   - `wait`: Pause execution until a condition is met
   - `timeout`: Set a time limit for an operation
   - `goTo`, `label`: Flow control with labeled jumps
   - `subWorkflow`: Nest a workflow within another

### Conditions System

The interpreter supports a rich conditions system:

```typescript
type Conditions = {
  all?: Condition[];
  any?: Condition[];
  not?: Condition;
  custom?: (bindings: Record<string, any>) => boolean;
};
```

Condition types include:

- Comparison conditions (equals, greater than, etc.)
- Logical conditions (and, or, not)
- State-based conditions
- Time-based conditions
- Error conditions
- Custom conditions

### Usage Example

```typescript
const workflowDSL: DSLDocument = {
  state: {
    counter: 0,
    items: []
  },
  plan: {
    sequence: {
      elements: [
        {
          execute: {
            name: "initializeWorkflow",
            provides: ["workflowId"]
          }
        },
        {
          while: {
            condition: {
              all: [
                { type: "LessThan", left: "${counter}", right: 5 }
              ]
            },
            body: [
              {
                execute: {
                  name: "processItem",
                  needs: ["counter"],
                  provides: ["item"]
                }
              },
              {
                execute: {
                  name: "updateCounter",
                  needs: ["counter"],
                  provides: ["counter"]
                }
              }
            ]
          }
        },
        {
          if: {
            all: [
              { type: "StateEquals", path: "items.length", value: 5 }
            ]
          },
          then: {
            execute: {
              name: "completeWorkflow",
              needs: ["items"]
            }
          },
          else: {
            execute: {
              name: "handleIncompleteWorkflow"
            }
          }
        }
      ]
    }
  }
};
```

### Best Practices

1. **Structured Workflow Design**:
   - Use sequences for linear flows
   - Use parallel for concurrent operations
   - Use conditions for branching logic

2. **Error Handling**:
   - Implement proper retry mechanisms for transient failures
   - Use circuit breakers for dependent services
   - Always include catch/finally blocks for critical operations

3. **State Management**:
   - Keep the state object clean and well-structured
   - Use meaningful variable names
   - Document the expected state shape

4. **Modularity**:
   - Break complex workflows into subworkflows
   - Group related operations using the group construct
   - Use labels sparingly and only when necessary

5. **Testing**:
   - Test each activity in isolation
   - Test the workflow with different initial states
   - Test error paths and recovery mechanisms
