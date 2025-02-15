import { proxyActivities } from '@temporalio/workflow';

export type DSL = {
  variables: Record<string, unknown>;
  root: Statement;
};

type Sequence = {
  elements: Statement[];
  level?: number; // Optional level indicating the height of execution
};

type ActivityInvocation = {
  name: string;
  arguments?: string[];
  result?: string;
  group?: number; // Optional group indicating the spacing of this activity in a level
};

type Parallel = {
  branches: Statement[];
  level?: number; // Optional level indicating the height of execution
};

type Statement = { activity: ActivityInvocation } | { sequence: Sequence } | { parallel: Parallel };

// Set up proxy activities
const acts = proxyActivities<Record<string, (...args: string[]) => Promise<string | undefined>>>({
  startToCloseTimeout: '1 minute'
});

export async function DSLInterpreter(dsl: DSL): Promise<unknown> {
  const bindings = dsl.variables as Record<string, string>;
  const dependencyGraph = buildDependencyGraph(dsl.root, bindings);
  return await executeGraph(dependencyGraph, bindings);
}

// Function to build a dependency graph based on the DSL structure
function buildDependencyGraph(
  root: Statement,
  bindings: Record<string, string>
): Map<string, { dependencies: string[]; execute: () => Promise<void> }> {
  const graph = new Map<string, { dependencies: string[]; execute: () => Promise<void> }>();

  const addNode = (name: string, dependencies: string[], execute: () => Promise<void>) => {
    graph.set(name, { dependencies, execute });
  };

  const processStatement = (statement: Statement) => {
    if ('activity' in statement) {
      const { name, arguments: args = [], result } = statement.activity;
      const dependencies = args.filter((arg) => graph.has(arg)); // List of dependencies
      addNode(result || name, dependencies, async () => {
        let resolvedArgs = args.map((arg) => graph.get(arg)?.execute() || Promise.resolve(arg));
        // @ts-expect-error stfu
        const result = await acts[name](...(await Promise.all(resolvedArgs)));
        if (result) bindings[result] = result;
      });
    } else if ('sequence' in statement) {
      statement.sequence.elements.forEach(processStatement);
    } else if ('parallel' in statement) {
      statement.parallel.branches.forEach(processStatement);
    }
  };

  processStatement(root);
  return graph;
}

// Function to execute the dependency graph
async function executeGraph(
  graph: Map<string, { dependencies: string[]; execute: () => Promise<void> }>,
  bindings: Record<string, string | undefined>
): Promise<void> {
  const executed = new Set<string>();

  async function executeNode(nodeName: string): Promise<void> {
    if (executed.has(nodeName)) return; // Skip if already executed
    const node = graph.get(nodeName);
    if (!node) return;

    // Ensure dependencies are executed first
    await Promise.all(node.dependencies.map(executeNode));

    // Execute the node itself
    await node.execute();
    executed.add(nodeName);
  }

  // Execute all nodes in the graph that have no dependencies
  for (const [nodeName, node] of graph.entries()) {
    if (node.dependencies.length === 0) {
      await executeNode(nodeName);
    }
  }
}
