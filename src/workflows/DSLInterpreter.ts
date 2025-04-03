import { proxyActivities } from '@temporalio/workflow';
import { DirectedGraph } from 'eventemitter3-graphology';
import { hasCycle, topologicalGenerations } from 'graphology-dag';
import { StepMetadata } from '../decorators/Step';

export type DSLDefinition = {
  variables: Record<string, unknown>;
  plan: Statement;
};

export type Statement = {
  condition?: (dsl: DSLDefinition) => Promise<boolean>;
  retries?: number;
  timeout?: number;
  required?: boolean;
} & ({ sequence: Sequence } | { parallel: Parallel } | { execute: Execute });

export type Sequence = {
  elements: Statement[];
};

export type Parallel = {
  branches: Statement[];
};

export type Execute = {
  code?: string;
  step?: StepInvocation;
  activity?: ActivityInvocation;
  workflow?: WorkflowInvocation;
};

export type ActivityInvocation = {
  name: string;
  arguments?: string[];
  result?: string;
  group?: number;
};

export type WorkflowInvocation = {
  name: string;
  arguments?: string[];
  result?: string;
  group?: number;
};

export type StepInvocation = {
  name: string;
  arguments?: string[];
  result?: string;
  group?: number;
};

export async function DSLInterpreter(
  dsl: DSLDefinition,
  injectedActivities?: Record<string, (...args: string[]) => Promise<string | undefined>>,
  injectedSteps?: Record<string, (...args: string[]) => Promise<string | undefined>>
): Promise<unknown> {
  const acts =
    injectedActivities ||
    proxyActivities<Record<string, (...args: string[]) => Promise<string | undefined>>>({
      startToCloseTimeout: '1 minute'
    });

  const steps = injectedSteps || {};

  const bindings = dsl.variables as Record<string, string>;
  const graph = buildDependencyGraph(dsl.plan, bindings);

  return await executeGraphByGenerations(graph, bindings, acts, steps);
}

type ExecuteInput = {
  activities: Record<string, (...args: any[]) => Promise<any>>;
  steps?: Record<string, (input: unknown) => Promise<unknown>>;
};

function buildDependencyGraph(plan: Statement, bindings: Record<string, string | undefined>): DirectedGraph {
  const graph = new DirectedGraph();

  // Helper function to create node execution logic
  const createExecuteFunction = (type: 'activity' | 'step', name: string, args: string[], result?: string) => {
    return async ({ activities, steps }: ExecuteInput) => {
      const executorMap = type === 'activity' ? activities : steps;
      if (!executorMap?.[name]) {
        throw new Error(`${type} function '${name}' not found`);
      }

      let resolvedArgs = args.map((arg) => {
        try {
          if (graph.hasNodeAttribute(arg, 'result')) {
            return graph.getNodeAttribute(arg, 'result');
          }
        } catch (e) {
          if (bindings[arg] !== undefined) {
            return bindings[arg];
          }
          return arg;
        }
      });

      // @ts-ignore
      const output = await executorMap[name](...resolvedArgs);

      if (result && output !== undefined) {
        bindings[result] = output;
        graph.setNodeAttribute(result, 'result', output);
      }
      return output;
    };
  };

  // Helper function to add node and its dependencies
  const addNodeAndDependencies = (type: 'activity' | 'step', name: string, args: string[] = [], result?: string) => {
    const nodeId = result ?? name;

    if (!graph.hasNode(nodeId)) {
      graph.addNode(nodeId, {
        type,
        execute: createExecuteFunction(type, name, args, result)
      });
    }

    // Add dependencies as edges
    for (const arg of args) {
      if ((graph.hasNode(arg) || bindings[arg] !== undefined) && !graph.hasEdge(arg, nodeId)) {
        try {
          graph.addDirectedEdge(arg, nodeId);
        } catch (e) {
          // Edge might already exist
        }
      }
    }
  };

  const processStatement = (statement: Statement) => {
    if ('execute' in statement) {
      if (statement.execute.activity) {
        const { name, arguments: args = [], result } = statement.execute.activity;
        addNodeAndDependencies('activity', name, args, result);
      } else if (statement.execute.step) {
        const { name, arguments: args = [], result } = statement.execute.step;
        addNodeAndDependencies('step', name, args, result);
      } else if (statement.execute.code) {
        // Handle code execution if needed
        console.warn('Code execution not implemented');
      }
    } else if ('sequence' in statement) {
      statement.sequence.elements.forEach(processStatement);
    } else if ('parallel' in statement) {
      statement.parallel.branches.forEach(processStatement);
    }
  };

  processStatement(plan);

  // Check for cycles
  if (hasCycle(graph)) {
    throw new Error('Circular dependency detected in workflow graph');
  }

  // After building the graph, we can visualize it
  console.log(visualizeWorkflowGenerations(graph));

  return graph;
}

async function executeGraphByGenerations(
  graph: DirectedGraph,
  bindings: Record<string, string | undefined>,
  activities: Record<string, (...args: string[]) => Promise<string | undefined>>,
  steps: Record<string, (...args: string[]) => Promise<string | undefined>>
): Promise<void> {
  const generations = topologicalGenerations(graph);

  if (generations.length === 0) {
    console.warn('No generations found in the graph. Skipping execution.');
    return;
  }

  for (let genIndex = 0; genIndex < generations.length; genIndex++) {
    const generation = generations[genIndex];

    console.log(`Executing generation ${genIndex} with ${generation.length} nodes: ${generation.join(', ')}`);
    await executeGenerationWithErrorHandling(generation, graph, activities, steps);
  }
  console.log('Workflow completed successfully');
}

function visualizeWorkflowGenerations(graph: DirectedGraph): string {
  const generations = topologicalGenerations(graph);
  let visualization = 'Workflow Execution Plan:\n';

  generations.forEach((generation, index) => {
    visualization += `\nGeneration ${index}:\n`;
    generation.forEach((nodeId) => {
      const dependencies = graph.inNeighbors(nodeId);
      const nodeType = graph.hasNodeAttribute(nodeId, 'type') ? graph.getNodeAttribute(nodeId, 'type') : 'unknown';
      visualization += `  - ${nodeId} [${nodeType}]${dependencies.length > 0 ? ` (depends on: ${dependencies.join(', ')})` : ''}\n`;
    });
  });

  return visualization;
}

async function executeGenerationWithErrorHandling(
  generation: string[],
  graph: DirectedGraph,
  activities: Record<string, (...args: string[]) => Promise<string | undefined>>,
  steps: Record<string, (...args: string[]) => Promise<string | undefined>>
): Promise<void> {
  const results = await Promise.allSettled(
    generation.map(async (nodeId) => {
      try {
        if (graph.hasNodeAttribute(nodeId, 'execute')) {
          const execute = graph.getNodeAttribute(nodeId, 'execute');
          await execute({ activities, steps });
        }
      } catch (error) {
        console.error(`Error executing node ${nodeId}:`, error);
        throw error;
      }
    })
  );

  // Check if any operations failed
  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length > 0) {
    throw new Error(`${failures.length} operations failed in this generation`);
  }
}

/**
 * Adapter function to convert StepMetadata from the @Step decorator into DSLDefinition format
 *
 * @param steps Array of step metadata from a Workflow class
 * @returns DSLDefinition object representing the workflow steps
 */
export function convertStepsToDSL(
  steps: StepMetadata[],
  initialVariables: Record<string, unknown> = {}
): DSLDefinition {
  if (!steps || steps.length === 0) {
    return { variables: initialVariables, plan: { sequence: { elements: [] } } };
  }

  // Create a graph to determine dependencies
  const graph = new DirectedGraph();

  // Add all steps as nodes
  for (const step of steps) {
    graph.addNode(step.name, { metadata: step });
  }

  // Add edges based on before/after relationships
  for (const step of steps) {
    // Handle 'before' relationships
    if (step.before) {
      const beforeSteps = Array.isArray(step.before) ? step.before : [step.before];
      for (const beforeStep of beforeSteps) {
        if (graph.hasNode(beforeStep)) {
          graph.addDirectedEdge(step.name, beforeStep);
        }
      }
    }

    // Handle 'after' relationships
    if (step.after) {
      const afterSteps = Array.isArray(step.after) ? step.after : [step.after];
      for (const afterStep of afterSteps) {
        if (graph.hasNode(afterStep)) {
          graph.addDirectedEdge(afterStep, step.name);
        }
      }
    }
  }

  // Check for cycles
  if (hasCycle(graph)) {
    throw new Error('Circular dependency detected in workflow steps');
  }

  // Get the execution order by generations
  const generations = topologicalGenerations(graph);

  // Convert generations to DSLDefinition structure
  const dslElements: Statement[] = [];

  for (const generation of generations) {
    if (generation.length === 1) {
      // Single step in generation - add directly
      const stepName = generation[0];
      const stepMeta = steps.find((s) => s.name === stepName);
      if (stepMeta) {
        dslElements.push({
          execute: {
            step: {
              name: stepMeta.method, // Use the method name for execution
              result: stepName // Use the step name as the result identifier
            }
          }
        });
      }
    } else if (generation.length > 1) {
      // Multiple steps in generation - add as parallel
      const parallelBranches: Statement[] = [];

      for (const stepName of generation) {
        const stepMeta = steps.find((s) => s.name === stepName);
        if (stepMeta) {
          parallelBranches.push({
            execute: {
              step: {
                name: stepMeta.method,
                result: stepName
              }
            }
          });
        }
      }

      dslElements.push({
        parallel: {
          branches: parallelBranches
        }
      });
    }
  }

  // Return the completed DSLDefinition
  return {
    variables: initialVariables,
    plan: {
      sequence: {
        elements: dslElements
      }
    }
  };
}
