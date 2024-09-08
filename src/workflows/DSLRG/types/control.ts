/*
Complete List of Control Flow Constructs
If/Then/Else: Standard conditional branching.
ElseIf: Additional conditional branches.
Wait: Pauses the execution for a given duration or until a condition is met.
GoTo: Jumps to another labeled DSL statement.
While: Repeatedly executes a block as long as a condition is true.
DoWhile: Executes a block once and then repeats as long as a condition is true.
Break: Exits a loop or switch statement.
Continue: Skips to the next iteration of a loop.
Timeout: Limits the execution time for a task or block of tasks.
Catch/Finally: Error handling with optional finalization logic.
Label: Marks a point in the DSL where the flow can jump back to using GoTo.
*/

type IfThenElse = {
  type: 'IfThenElse';
  condition: (bindings: Record<string, any>) => boolean; // Condition to evaluate
  then: DSLStatement[]; // Statements to execute if the condition is true
  else?: DSLStatement[]; // Optional statements to execute if the condition is false
  elseif?: {
    // Optional elseif branches
    condition: (bindings: Record<string, any>) => boolean;
    then: DSLStatement[];
  }[];
};

type Wait = {
  type: 'Wait';
  duration?: string; // Duration to wait (e.g., "5s" for 5 seconds)
  condition?: (bindings: Record<string, any>) => boolean; // Condition to wait until
};

type GoTo = {
  type: 'GoTo';
  label: string; // Label to jump to
};

type While = {
  type: 'While';
  condition: (bindings: Record<string, any>) => boolean; // Condition to evaluate for looping
  body: DSLStatement[]; // The set of statements to execute within the loop
};

type DoWhile = {
  type: 'DoWhile';
  condition: (bindings: Record<string, any>) => boolean; // Condition to evaluate after each iteration
  body: DSLStatement[]; // The set of statements to execute within the loop
};

type Break = {
  type: 'Break'; // Exits from the current loop or switch
};

type Continue = {
  type: 'Continue'; // Skips the rest of the current iteration and starts the next
};

type Timeout = {
  type: 'Timeout';
  duration: string; // Maximum time allowed for the task or block to execute
  task: DSLStatement; // The task or block to apply the timeout to
};

type CatchFinally = {
  type: 'CatchFinally';
  try: DSLStatement[]; // The set of statements to try
  catch?: DSLStatement[]; // Optional statements to execute if an error occurs
  finally?: DSLStatement[]; // Optional finalization statements to execute after try or catch
};

type Label = {
  type: 'Label';
  name: string; // The name of the label
  statement: DSLStatement; // The statement associated with this label
};
