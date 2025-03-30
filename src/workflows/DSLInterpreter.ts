import { proxyActivities } from '@temporalio/workflow';
import { DirectedGraph } from 'eventemitter3-graphology';
import { hasCycle, topologicalSort, topologicalGenerations, forEachTopologicalGeneration } from 'graphology-dag';

export type DSL = {
  variables: Record<string, unknown>;
  root: Statement;
};

type Sequence = {
  elements: Statement[];
  level?: number;
};

type ActivityInvocation = {
  name: string;
  arguments?: string[];
  result?: string;
  group?: number;
};

type Parallel = {
  branches: Statement[];
  level?: number;
};

type Statement = { activity: ActivityInvocation } | { sequence: Sequence } | { parallel: Parallel };

export async function DSLInterpreter(
  dsl: DSL,
  injectedActivities?: Record<string, (...args: string[]) => Promise<string | undefined>>
): Promise<unknown> {
  // Use injected activities if provided, otherwise use proxyActivities
  const acts =
    injectedActivities ||
    proxyActivities<Record<string, (...args: string[]) => Promise<string | undefined>>>({
      startToCloseTimeout: '1 minute'
    });

  const bindings = dsl.variables as Record<string, string>;
  const graph = buildDependencyGraph(dsl.root, bindings);

  // You can choose which execution strategy to use
  // return await executeGraphSequentially(graph, bindings);
  return await executeGraphByGenerations(graph, bindings, acts);
}

function buildDependencyGraph(root: Statement, bindings: Record<string, string | undefined>): DirectedGraph {
  const graph = new DirectedGraph();

  const processStatement = (statement: Statement) => {
    if ('activity' in statement) {
      const { name, arguments: args = [], result } = statement.activity;
      const nodeId = result || name;

      // Add node if it doesn't exist
      if (!graph.hasNode(nodeId)) {
        graph.addNode(nodeId, {
          execute: async (activities: Record<string, (...args: string[]) => Promise<string | undefined>>) => {
            let resolvedArgs = args.map((arg) => {
              try {
                if (graph.hasNodeAttribute(arg, 'result')) {
                  return graph.getNodeAttribute(arg, 'result');
                }
              } catch (e) {
                return bindings[arg];
              }
            });

            const output = await activities[name](...resolvedArgs);

            if (result && output !== undefined) {
              bindings[result] = output;
              graph.setNodeAttribute(result, 'result', output);
            }
            return output;
          }
        });
      }

      // Add dependencies as edges (from dependency to current node)
      for (const arg of args) {
        if ((graph.hasNode(arg) || bindings[arg] !== undefined) && !graph.hasEdge(arg, nodeId)) {
          try {
            graph.addEdge(arg, nodeId);
          } catch (e) {
            // Edge might already exist
          }
        }
      }
    } else if ('sequence' in statement) {
      statement.sequence.elements.forEach(processStatement);
    } else if ('parallel' in statement) {
      statement.parallel.branches.forEach(processStatement);
    }
  };

  processStatement(root);

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
  activities: Record<string, (...args: string[]) => Promise<string | undefined>>
): Promise<void> {
  const generations = topologicalGenerations(graph);

  for (let genIndex = 0; genIndex < generations.length; genIndex++) {
    const generation = generations[genIndex];

    console.log(`Executing generation ${genIndex} with ${generation.length} nodes: ${generation.join(', ')}`);
    await executeGenerationWithErrorHandling(generation, graph, activities);
  }
}

function visualizeWorkflowGenerations(graph: DirectedGraph): string {
  const generations = topologicalGenerations(graph);
  let visualization = 'Workflow Execution Plan:\n';

  generations.forEach((generation, index) => {
    visualization += `\nGeneration ${index}:\n`;
    generation.forEach((nodeId) => {
      const dependencies = graph.inNeighbors(nodeId);
      visualization += `  - ${nodeId}${dependencies.length > 0 ? ` (depends on: ${dependencies.join(', ')})` : ''}\n`;
    });
  });

  return visualization;
}

async function executeGenerationWithErrorHandling(
  generation: string[],
  graph: DirectedGraph,
  activities: Record<string, (...args: string[]) => Promise<string | undefined>>
): Promise<void> {
  const results = await Promise.allSettled(
    generation.map(async (nodeId) => {
      try {
        if (graph.hasNodeAttribute(nodeId, 'execute')) {
          const execute = graph.getNodeAttribute(nodeId, 'execute');
          return await execute(activities);
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
