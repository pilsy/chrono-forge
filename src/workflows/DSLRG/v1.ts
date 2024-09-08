type DSLStatement = {
  if?: Conditions; // Enhanced conditions for 'if' construct
  elseif?: { condition: Conditions; then: DSLStatement | DSLStatement[] }[]; // Enhanced 'elseif' with multiple conditions
  else?: DSLStatement | DSLStatement[]; // 'else' block to execute if conditions are not met
  execute?: Execute; // A single executable task
  sequence?: Sequence; // Sequential execution of multiple tasks
  parallel?: Parallel; // Parallel execution of multiple branches
  loop?: Loop; // Loop to execute tasks repeatedly
  wait?: Wait; // Wait for a specific time or condition
  goTo?: GoTo; // Jump to another labeled DSL statement
  label?: string; // Label to identify this statement
  switch?: Switch; // Switch statement for branching based on a value
  retry?: Retry; // Retry logic for tasks
  mapReduce?: MapReduce; // MapReduce-style processing
  forkJoin?: ForkJoin; // Fork and join execution
  circuitBreaker?: CircuitBreaker; // Circuit breaker for fault tolerance
  subWorkflow?: SubWorkflow; // Execute another workflow
  group?: Group; // Logical grouping of tasks
  while?: While; // While loop
  doWhile?: DoWhile; // Do-while loop
  break?: Break; // Break from loop or switch
  continue?: Continue; // Continue to the next loop iteration
  timeout?: Timeout; // Timeout for task or block execution
  catch?: DSLStatement | DSLStatement[]; // Catch block for error handling
  finally?: DSLStatement | DSLStatement[]; // Finally block to execute after try or catch
};

type Conditions = {
  all?: Condition[]; // All conditions must be true (AND)
  any?: Condition[]; // At least one condition must be true (OR)
  not?: Condition; // Negate a condition (NOT)
  custom?: (bindings: Record<string, any>) => boolean; // Custom condition logic
};

// Reuse the existing Condition types
type Condition = ComparisonCondition | LogicalCondition | StateBasedCondition | TimeBasedCondition | ErrorCondition | CustomCondition;

type ComparisonCondition =
  | { type: 'Equals'; left: any; right: any }
  | { type: 'NotEquals'; left: any; right: any }
  | { type: 'GreaterThan'; left: any; right: any }
  | { type: 'LessThan'; left: any; right: any }
  | { type: 'GreaterThanOrEquals'; left: any; right: any }
  | { type: 'LessThanOrEquals'; left: any; right: any };

type LogicalCondition =
  | { type: 'And'; conditions: Condition[] }
  | { type: 'Or'; conditions: Condition[] }
  | { type: 'Not'; condition: Condition };

type StateBasedCondition = { type: 'StateEquals'; path: string; value: any } | { type: 'StateNotEquals'; path: string; value: any };

type TimeBasedCondition =
  | { type: 'BeforeTime'; time: Date }
  | { type: 'AfterTime'; time: Date }
  | { type: 'WithinTimeRange'; startTime: Date; endTime: Date };

type ErrorCondition = { type: 'OnError'; errorType?: string } | { type: 'OnSuccess' };

type CustomCondition = {
  type: 'Custom';
  evaluate: (bindings: Record<string, any>) => boolean;
};

class DSLRuntimeGraphInterpreter {
  private dsl: DSLDocument;
  private bindings: Record<string, any>;
  private graph: DependencyGraph = new Map<string, Node>();
  private executed: Set<string> = new Set<string>();

  constructor(dsl: DSLDocument) {
    this.dsl = dsl;
    this.bindings = { ...dsl.state };
    this.buildDependencyGraphFromDSL();
  }

  private buildDependencyGraphFromDSL() {
    const processStatement = (statement: DSLStatement) => {
      // Evaluate the 'if' condition before any processing
      if (statement.if && !evaluateConditions(statement.if, this.bindings)) {
        if (statement.elseif) {
          for (const elseif of statement.elseif) {
            if (evaluateConditions(elseif.condition, this.bindings)) {
              this.executeStatements(elseif.then);
              return; // Exit once an elseif condition is met
            }
          }
        }
        if (statement.else) {
          this.executeStatements(statement.else); // Execute 'else' branch if no conditions are met
        }
        return; // Skip processing if the 'if' condition is not met
      }

      if (statement.execute) this.addExecuteNode(statement.execute);
      if (statement.sequence) this.addSequenceNode(statement.sequence);
      if (statement.parallel) this.addParallelNode(statement.parallel);
      if (statement.loop) this.addLoopNode(statement.loop);
      // Continue for all other DSL types...
    };

    processStatement(this.dsl.plan);
  }

  private async executeStatements(statements: DSLStatement | DSLStatement[]): Promise<void> {
    if (Array.isArray(statements)) {
      for (const statement of statements) {
        await this.executeStatement(statement);
      }
    } else {
      await this.executeStatement(statements);
    }
  }

  private async executeStatement(statement: DSLStatement): Promise<void> {
    // Check 'if' condition for each DSLStatement
    if (statement.if && !evaluateConditions(statement.if, this.bindings)) {
      if (statement.elseif) {
        for (const elseif of statement.elseif) {
          if (evaluateConditions(elseif.condition, this.bindings)) {
            await this.executeStatements(elseif.then);
            return; // Exit once an elseif condition is met
          }
        }
      }
      if (statement.else) {
        await this.executeStatements(statement.else);
      }
      return; // Skip if no condition matches
    }

    // Execute based on the type of DSLStatement
    if (statement.execute) await this.executeNode(statement.execute.name);
    if (statement.sequence) await this.executeStatements(statement.sequence.elements);
    if (statement.parallel) await Promise.all(statement.parallel.branches.map((branch) => this.executeStatements(branch)));
    if (statement.loop) {
      while (evaluateConditions({ custom: statement.loop!.condition }, this.bindings)) {
        await this.executeStatements(statement.loop!.body);
      }
    }
    // Handle other types as necessary...
  }

  private async executeNode(nodeName: string): Promise<void> {
    if (this.executed.has(nodeName)) return;
    const node = this.graph.get(nodeName);
    if (!node) return;

    await Promise.all(node.dependencies.map((dep) => this.executeNode(dep)));
    await node.execute();
    this.executed.add(nodeName);
  }
}

function evaluateConditions(conditions: Conditions, bindings: Record<string, any>): boolean {
  if (conditions.all) {
    return conditions.all.every((cond) => evaluateCondition(cond, bindings));
  }
  if (conditions.any) {
    return conditions.any.some((cond) => evaluateCondition(cond, bindings));
  }
  if (conditions.not) {
    return !evaluateCondition(conditions.not, bindings);
  }
  if (conditions.custom) {
    return conditions.custom(bindings);
  }
  return false; // Default fallback
}
