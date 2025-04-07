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
};

export type WorkflowInvocation = {
  name: string;
  arguments?: string[];
  result?: string;
};

export type StepInvocation = {
  name: string;
  arguments?: string[];
  result?: string;
};

export type DSLGeneration = {
  nodeId: string;
  graph: DirectedGraph;
  bindings: Record<string, string>;
  acts: Record<string, (...args: string[]) => Promise<string | undefined>>;
  steps: Record<string, (...args: string[]) => Promise<string | undefined>>;
  nodeIds: string[];
  execute: () => Promise<unknown>;
};

export async function* DSLInterpreter(
  dsl: DSLDefinition,
  injectedActivities?: Record<string, (...args: string[]) => Promise<string | undefined>>,
  injectedSteps?: Record<string, (...args: string[]) => Promise<string | undefined>>
): AsyncGenerator<DSLGeneration, void, unknown> {
  const acts =
    injectedActivities ||
    proxyActivities<Record<string, (...args: string[]) => Promise<string | undefined>>>({
      startToCloseTimeout: '1 minute'
    });

  const steps = injectedSteps || {};
  const bindings = dsl.variables as Record<string, string>;
  const graph = buildDependencyGraph(dsl.plan, bindings);
  const generations = topologicalGenerations(graph);

  if (generations.length === 0) {
    console.warn('No generations found in the graph. Skipping execution.');
    return;
  }

  console.log(visualizeWorkflowGenerations(graph));

  for (const generation of generations) {
    for (const nodeId of generation) {
      const node = graph.getNodeAttributes(nodeId);
      if (!node?.execute) continue;

      // Check condition if it exists
      if (node.condition) {
        const conditionMet = await node.condition(dsl);
        if (!conditionMet) continue;
      }

      yield {
        nodeId,
        graph,
        bindings: dsl.variables as Record<string, string>,
        acts,
        steps,
        nodeIds: generation,
        execute: async () => await node.execute({ activities: acts, steps })
      };
    }
  }

  console.log('Workflow completed successfully');
}

async function executeNode(
  nodeId: string,
  graph: DirectedGraph,
  activities: Record<string, (...args: string[]) => Promise<string | undefined>>,
  steps: Record<string, (...args: string[]) => Promise<string | undefined>>
): Promise<unknown> {
  try {
    const node = graph.getNodeAttributes(nodeId);
    if (!node.execute) {
      throw new Error(`No execute function found for node ${nodeId}`);
    }

    return await node.execute({ activities, steps });
  } catch (error) {
    console.error(`Error executing node ${nodeId}:`, error);
    throw error;
  }
}

type ExecuteInput = {
  steps?: Record<string, (input: unknown) => Promise<unknown>>;
  activities: Record<string, (...args: any[]) => Promise<any>>;
};

function buildDependencyGraph(plan: Statement, bindings: Record<string, string | undefined>): DirectedGraph {
  const graph = new DirectedGraph();
  let autoIncrementId = 0;

  // Helper function to create node execution logic
  const createExecuteFunction = (
    type: 'activity' | 'step',
    nodeId: string,
    name: string,
    args: string[],
    result?: string,
    condition?: (dsl: DSLDefinition) => Promise<boolean>
  ) => {
    return async ({ activities, steps }: ExecuteInput) => {
      const executorMap = type === 'activity' ? activities : steps;
      if (!executorMap?.[name]) {
        throw new Error(`${type} function '${name}' not found`);
      }

      let resolvedArgs = args.map((arg) => {
        if (bindings[arg] !== undefined) {
          return bindings[arg];
        }
        // Check if the argument references a result from another node
        if (graph.hasNode(arg)) {
          const nodeResult = graph.getNodeAttribute(arg, 'result');
          if (nodeResult !== undefined) {
            return nodeResult;
          }
        }
        return arg;
      });

      // @ts-ignore
      const output = await executorMap[name](...resolvedArgs);
      if (output !== undefined) {
        if (result) {
          bindings[result] = output;
        }
        graph.setNodeAttribute(nodeId, 'result', output);
      }
      return output;
    };
  };

  // Helper function to add node and its dependencies
  const addNodeAndDependencies = (
    type: 'activity' | 'step',
    name: string,
    args: string[],
    result?: string,
    condition?: (dsl: DSLDefinition) => Promise<boolean>
  ): string => {
    const nodeId = `${type}_${name}_${autoIncrementId++}`;
    graph.addNode(nodeId, {
      type,
      name,
      args,
      result,
      condition,
      execute: createExecuteFunction(type, nodeId, name, args, result, condition)
    });

    // Add edges from nodes that have results matching our arguments
    for (const arg of args) {
      const dependencyNodes = Array.from(graph.nodes()).filter((n) => {
        const nodeResult = graph.getNodeAttribute(n, 'result');
        return nodeResult === arg;
      });

      for (const depNode of dependencyNodes) {
        try {
          graph.addDirectedEdge(depNode, nodeId);
        } catch (e) {
          // Edge might already exist
        }
      }
    }

    return nodeId;
  };

  const processStatement = (statement: Statement, previousNodeId?: string): string | undefined => {
    if ('execute' in statement) {
      let nodeId: string | undefined;

      if (statement.execute.activity) {
        const { name, arguments: args = [], result } = statement.execute.activity;
        nodeId = addNodeAndDependencies('activity', name, args, result, statement.condition);
      } else if (statement.execute.step) {
        const { name, arguments: args = [], result } = statement.execute.step;
        nodeId = addNodeAndDependencies('step', name, args, result, statement.condition);
      }

      // Always add dependency on previous node in sequence
      if (nodeId && previousNodeId) {
        try {
          graph.addDirectedEdge(previousNodeId, nodeId);
        } catch (e) {
          // Edge might already exist
        }
      }
      return nodeId;
    } else if ('sequence' in statement) {
      let lastNodeId: string | undefined;
      for (const element of statement.sequence.elements) {
        lastNodeId = processStatement(element, lastNodeId);
      }
      return lastNodeId;
    } else if ('parallel' in statement) {
      const startNodeId = previousNodeId;
      const nodeIds = statement.parallel.branches
        .map((branch) => {
          // Each parallel branch starts from the same previous node
          return processStatement(branch, startNodeId);
        })
        .filter((id): id is string => id !== undefined);

      // Return the last node ID from the parallel branches
      return nodeIds.length > 0 ? nodeIds[nodeIds.length - 1] : undefined;
    }
    return undefined;
  };

  processStatement(plan);

  // Check for cycles
  if (hasCycle(graph)) {
    throw new Error('Circular dependency detected in workflow graph');
  }

  // After building the graph, we can visualize it

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
