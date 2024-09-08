/*
Dynamic Execution Types
Execute: A basic task or activity execution.
Sequence: A series of tasks executed in order, one after another.
Parallel: A set of tasks executed concurrently.
Loop: A block of statements executed repeatedly until a condition is met.
MapReduce: Executes a set of tasks in parallel (map phase) and then reduces the results using a defined reduction function.
Retry: A block that retries executing a task or group of tasks based on specified retry logic.
ForkJoin: Similar to Parallel, but allows merging back results with a synchronization point.
CircuitBreaker: Executes a task but stops execution if it fails a certain number of times, providing a fallback mechanism.
SubWorkflow: Executes another workflow as a sub-task within the current workflow.
Group: A logical grouping of tasks that can be paused, resumed, or cancelled as a whole.
Switch: A dynamic control structure that selects one of many possible execution paths based on a value.
*/

type Execute = {
  type: 'Execute';
  name: string; // Name of the task or activity to execute
  taskQueue?: string; // Optional task queue to route the task to
  needs?: string[]; // State paths required as inputs
  provides?: string[]; // State paths to be updated with outputs
  result?: string; // Optional state path to store the task's result
  maxRetries?: number; // Maximum number of retries allowed
};

type Sequence = {
  type: 'Sequence';
  elements: DSLStatement[]; // An array of DSL statements to execute sequentially
};

type Parallel = {
  type: 'Parallel';
  branches: DSLStatement[]; // An array of DSL statements to execute concurrently
};

type Loop = {
  type: 'Loop';
  condition: (bindings: Record<string, any>) => boolean; // Condition to evaluate for looping
  body: DSLStatement[]; // The set of statements to execute in the loop
};

type MapReduce = {
  type: 'MapReduce';
  map: DSLStatement; // Task to execute in parallel on each element
  reduce: DSLStatement; // Task to reduce results into a single output
  elements: any[]; // Array of elements to process in the map phase
};

type Retry = {
  type: 'Retry';
  attempts: number; // Number of retry attempts
  delay: string; // Delay between retry attempts (e.g., "5s" for 5 seconds)
  task: DSLStatement; // Task to retry upon failure
};

type ForkJoin = {
  type: 'ForkJoin';
  branches: DSLStatement[]; // Branches to execute concurrently
  join: DSLStatement; // Statement to execute once all branches complete
};

type CircuitBreaker = {
  type: 'CircuitBreaker';
  task: DSLStatement; // Task to execute with circuit breaker protection
  failureThreshold: number; // Number of allowed failures before opening the circuit
  resetTimeout: string; // Timeout duration to reset the circuit
  fallback?: DSLStatement; // Optional fallback task if the circuit is open
};

type SubWorkflow = {
  type: 'SubWorkflow';
  workflowName: string; // Name of the sub-workflow to execute
  inputs: Record<string, any>; // Inputs to pass to the sub-workflow
};

type Group = {
  type: 'Group';
  name: string; // Name of the group
  tasks: DSLStatement[]; // Tasks within the group
};

type Switch = {
  type: 'Switch';
  expression: (bindings: Record<string, any>) => any; // Function that returns a value to switch on
  cases: { value: any; statements: DSLStatement[] }[]; // List of cases with matching values
  default?: DSLStatement[]; // Default statements if no cases match
};
