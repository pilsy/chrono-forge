import 'reflect-metadata';
import { STEP_METADATA_KEY } from './metadata';
import { Statement } from '../workflows/DSLInterpreter';

export interface StepOptions {
  /**
   * Custom name for the step. If not provided, the method name will be used.
   */
  name?: string;

  /**
   * Condition function that determines if this step should wait before executing.
   * The step will wait until this function returns true.
   * The function has access to the workflow instance via 'this'.
   * This maps to 'wait' in the DSLInterpreter.
   */
  condition?: (this: WorkflowInstance, variables: Record<string, unknown>, plan: Statement) => boolean;

  /**
   * When function that determines if this step should be executed.
   * The step will only run if this function returns true.
   * The function has access to the workflow instance via 'this'.
   * This maps to 'when' in the DSLInterpreter.
   */
  when?: (this: WorkflowInstance, variables: Record<string, unknown>, plan: Statement) => boolean;

  /**
   * Steps that should be executed before this step.
   * Can be a single step name or an array of step names.
   */
  before?: string | string[];

  /**
   * Steps that should be executed after this step.
   * Can be a single step name or an array of step names.
   */
  after?: string | string[];

  /**
   * Maximum number of retry attempts if the step fails.
   * Default is 0 (no retries).
   */
  retries?: number;

  /**
   * Timeout in milliseconds after which the step execution will be aborted.
   * Default is undefined (no timeout).
   */
  timeout?: number;

  /**
   * Whether this step is required for workflow completion.
   * If false, workflow can complete even if this step fails or is skipped.
   * Default is true.
   */
  required?: boolean;

  /**
   * Custom error handler for this specific step.
   * @param error The error that occurred during step execution
   * @returns A value to use as the step result, or throws to propagate the error
   */
  onError?: (error: Error) => any;
}

export interface StepMetadata {
  name: string;
  method: string;
  condition?: (this: WorkflowInstance, variables: Record<string, unknown>, plan: Statement) => boolean;
  when?: (this: WorkflowInstance, variables: Record<string, unknown>, plan: Statement) => boolean;
  before?: string | string[];
  after?: string | string[];
  retries?: number;
  timeout?: number;
  required?: boolean;
  onError?: (error: Error) => any;
  executed?: boolean;
  result?: any;
  error?: Error;
}

// Define a logger interface to avoid TS errors
interface Logger {
  debug?: (message: string) => void;
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
}

// Define the base type for workflow classes that might use the Step decorator
export interface WorkflowInstance {
  log?: Logger;
  [key: string]: any;
}

/**
 * Step decorator for defining workflow steps with dependencies and execution conditions.
 *
 * This decorator allows you to define methods as workflow steps with specific execution
 * order, conditions, retry logic, and error handling. Steps can have dependencies on other
 * steps using the 'before' and 'after' options.
 *
 * @example
 * ```typescript
 * class MyWorkflow extends Workflow {
 *   @Step()
 *   async step1() {
 *     // This step will run first
 *   }
 *
 *   @Step({ after: 'step1', retries: 3 })
 *   async step2() {
 *     // This step will run after step1 and retry up to 3 times if it fails
 *   }
 *
 *   @Step({
 *     after: ['step1', 'step2'],
 *     condition: function() { return this.someCondition; },
 *     onError: (err) => console.error('Step failed:', err)
 *   })
 *   async conditionalStep() {
 *     // This step will only run if someCondition is true
 *     // and both step1 and step2 have completed
 *   }
 * }
 * ```
 *
 * To execute steps in the correct order, use the `executeSteps()` method in your workflow's
 * execute method:
 *
 * ```typescript
 * async execute() {
 *   return await this.executeSteps();
 * }
 * ```
 *
 * @param options Configuration options for the step
 * @returns Method decorator
 */
export const Step = (options: StepOptions = {}) => {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    const stepName = options.name ?? propertyKey;

    // Store the original method
    const originalMethod = descriptor.value;

    // Replace the method with a wrapped version that handles retries and timeouts
    descriptor.value = async function (this: WorkflowInstance, ...args: any[]) {
      try {
        return await originalMethod.apply(this, args);
      } catch (error) {
        // Log error
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.log?.error?.(`Step '${stepName}' failed: ${errorMessage}`);

        throw error;
      }
    };

    // Add step metadata using reflection
    const steps = Reflect.getMetadata(STEP_METADATA_KEY, target) ?? [];
    steps.push({
      name: stepName,
      method: propertyKey,
      condition: options.condition,
      when: options.when,
      before: options.before,
      after: options.after,
      retries: options.retries ?? 0,
      timeout: options.timeout,
      required: options.required !== false, // Default to true
      onError: options.onError,
      executed: false
    });
    Reflect.defineMetadata(STEP_METADATA_KEY, steps, target);

    return descriptor;
  };
};

/**
 * Helper method to be added to the Workflow class for executing steps in the correct order.
 * This should be called from the workflow's execute method.
 *
 * @example
 * ```typescript
 * // Add this method to your Workflow base class
 * protected async executeSteps(): Promise<any> {
 *   const steps = this.constructor._steps || [];
 *   const executionOrder = this.resolveStepDependencies(steps);
 *
 *   let results: Record<string, any> = {};
 *
 *   for (const stepName of executionOrder) {
 *     const step = steps.find(s => s.name === stepName);
 *     if (!step) continue;
 *
 *     // Skip if condition function returns false
 *     if (step.condition && !step.condition.call(this)) {
 *       this.log?.debug(`Skipping step '${stepName}' because condition returned false`);
 *       continue;
 *     }
 *
 *     this.log?.debug(`Executing step '${stepName}'`);
 *     try {
 *       results[stepName] = await this[step.method]();
 *     } catch (error) {
 *       if (step.required) {
 *         throw error;
 *       } else {
 *         this.log?.warn(`Non-required step '${stepName}' failed: ${error.message}`);
 *       }
 *     }
 *   }
 *
 *   return results;
 * }
 *
 * // Helper method to resolve step dependencies into execution order using Graphology.
 * // This implements a proper DAG (Directed Acyclic Graph) for dependency resolution.
 * private resolveStepDependenciesWithDAG(steps: StepMetadata[]): string[] {
 *   // Import graphology - you'll need to add this as a dependency
 *   // npm install graphology graphology-operators
 *   const { DirectedGraph } = require('graphology');
 *   const { topologicalSort, hasCycle } = require('graphology-operators');
 *
 *   // Create a directed graph
 *   const graph = new DirectedGraph();
 *
 *   // Add all steps as nodes
 *   for (const step of steps) {
 *     if (!graph.hasNode(step.name)) {
 *       graph.addNode(step.name, { metadata: step });
 *     }
 *   }
 *
 *   // Add edges based on before/after relationships
 *   for (const step of steps) {
 *     // Handle 'before' dependencies (current step must run before these steps)
 *     if (step.before) {
 *       const beforeSteps = Array.isArray(step.before) ? step.before : [step.before];
 *       for (const beforeStep of beforeSteps) {
 *         if (graph.hasNode(beforeStep) && !graph.hasEdge(step.name, beforeStep)) {
 *           // Edge from current step to 'before' step
 *           graph.addEdge(step.name, beforeStep);
 *         }
 *       }
 *     }
 *
 *     // Handle 'after' dependencies (current step must run after these steps)
 *     if (step.after) {
 *       const afterSteps = Array.isArray(step.after) ? step.after : [step.after];
 *       for (const afterStep of afterSteps) {
 *         if (graph.hasNode(afterStep) && !graph.hasEdge(afterStep, step.name)) {
 *           // Edge from 'after' step to current step
 *           graph.addEdge(afterStep, step.name);
 *         }
 *       }
 *     }
 *   }
 *
 *   // Check for cycles in the graph
 *   if (hasCycle(graph)) {
 *     throw new Error('Circular dependency detected in workflow steps');
 *   }
 *
 *   // Perform topological sort to get execution order
 *   return topologicalSort(graph);
 * }
 *
 * // Legacy method for resolving step dependencies - kept for backward compatibility
 * // New code should use resolveStepDependenciesWithDAG instead
 * private resolveStepDependencies(steps: StepMetadata[]): string[] {
 *   try {
 *     return this.resolveStepDependenciesWithDAG(steps);
 *   } catch (error) {
 *     this.log?.warn(`Failed to resolve dependencies with DAG: ${error.message}. Falling back to legacy method.`);
 *
 *     // ... existing implementation ...
 *   }
 * }
 * ```
 */

/**
 * The Step decorator should be used with a WorkflowBase class that implements:
 * 1. executeSteps() - for running the steps in dependency order
 * 2. resolveStepDependencies() - for determining the proper execution order
 *
 * @see The example implementation in src/tests/testWorkflows/UserRegistrationWorkflow.ts
 */
