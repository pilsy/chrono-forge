import { proxyActivities } from '@temporalio/workflow';

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

const acts = proxyActivities<Record<string, (...args: string[]) => Promise<string | undefined>>>({
  startToCloseTimeout: '1 minute'
});

export async function DSLInterpreter(dsl: DSL): Promise<unknown> {
  const bindings = dsl.variables as Record<string, string>;
  const dependencyGraph = buildDependencyGraph(dsl.root, bindings);
  return await executeGraph(dependencyGraph, bindings);
}

function buildDependencyGraph(
  root: Statement,
  bindings: Record<string, string | undefined>
): Map<string, { dependencies: string[]; execute: () => Promise<void> }> {
  const graph = new Map<string, { dependencies: string[]; execute: () => Promise<void> }>();

  const visited = new Set<string>();
  const stack = new Set<string>();

  const detectCycle = (nodeName: string): boolean => {
    if (stack.has(nodeName)) return true;
    if (visited.has(nodeName)) return false;

    visited.add(nodeName);
    stack.add(nodeName);

    const node = graph.get(nodeName);
    if (node) {
      for (const dep of node.dependencies) {
        if (detectCycle(dep)) return true;
      }
    }
    stack.delete(nodeName);
    return false;
  };

  const addNode = (name: string, dependencies: string[], execute: () => Promise<void>) => {
    graph.set(name, { dependencies, execute });
  };

  const processStatement = (statement: Statement) => {
    if ('activity' in statement) {
      const { name, arguments: args = [], result } = statement.activity;
      const dependencies = args.filter((arg) => graph.has(arg) || bindings[arg] !== undefined);

      addNode(result || name, dependencies, async () => {
        let resolvedArgs = args.map((arg) => graph.get(arg)?.execute() || Promise.resolve(bindings[arg]));

        // @ts-ignore
        const output = await acts[name](...(await Promise.all(resolvedArgs)));

        if (result && output !== undefined) {
          bindings[result] = output;
          // @ts-ignore
          addNode(result, [], async () => Promise.resolve(output));
        }
      });
    } else if ('sequence' in statement) {
      statement.sequence.elements.forEach(processStatement);
    } else if ('parallel' in statement) {
      statement.parallel.branches.forEach(processStatement);
    }
  };

  processStatement(root);

  for (const node of graph.keys()) {
    if (detectCycle(node)) {
      throw new Error(`Circular dependency detected at node ${node}`);
    }
  }

  return graph;
}

async function executeGraph(
  graph: Map<string, { dependencies: string[]; execute: () => Promise<void> }>,
  bindings: Record<string, string | undefined>
): Promise<void> {
  const executed = new Set<string>();
  const pending = new Map(graph);

  async function tryExecuteNode(nodeName: string) {
    if (executed.has(nodeName)) return;
    const node = pending.get(nodeName);
    if (!node) return;

    const dependenciesResolved = node.dependencies.every((dep) => executed.has(dep) || bindings[dep] !== undefined);

    if (dependenciesResolved) {
      await node.execute();
      executed.add(nodeName);
      pending.delete(nodeName);

      for (const nextNode of pending.keys()) {
        await tryExecuteNode(nextNode);
      }
    }
  }

  for (const nodeName of graph.keys()) {
    await tryExecuteNode(nodeName);
  }
}
