type Node = { dependencies: string[]; execute: () => Promise<void> };

function buildDependencyGraphFromDSL(dsl: DSL): Map<string, Node> {
  const graph = new Map<string, Node>();

  function addNode(name: string, dependencies: string[], execute: () => Promise<void>) {
    graph.set(name, { dependencies, execute });
  }

  function processStatement(statement: Statement) {
    if ('activity' in statement) {
      const { name, arguments: args = [], result } = statement.activity;
      const dependencies = args.filter((arg) => graph.has(arg));
      addNode(result || name, dependencies, async () => {
        const resolvedArgs = args.map((arg) => graph.get(arg)?.execute() || Promise.resolve(arg));
        const activityResult = await acts[name](...(await Promise.all(resolvedArgs)));
        if (result) graph.set(result, { dependencies: [], execute: async () => activityResult });
      });
    } else if ('sequence' in statement) {
      statement.sequence.elements.forEach(processStatement);
    } else if ('parallel' in statement) {
      statement.parallel.branches.forEach(processStatement);
    }
  }

  processStatement(dsl.root);
  return graph;
}

async function ChronoGraph(graph: Map<string, Node>, bindings: Record<string, string | undefined>): Promise<void> {
  const executed = new Set<string>();

  async function executeNode(nodeName: string): Promise<void> {
    if (executed.has(nodeName)) return;
    const node = graph.get(nodeName);
    if (!node) return;

    await Promise.all(node.dependencies.map(executeNode));
    await node.execute();
    executed.add(nodeName);
  }

  for (const [nodeName, node] of graph.entries()) {
    if (node.dependencies.length === 0) {
      await executeNode(nodeName);
    }
  }
}
