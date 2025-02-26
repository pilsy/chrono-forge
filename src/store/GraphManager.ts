import { DirectedGraph } from 'graphology';

// A helper function to produce a unique ID for each entity.
function toNodeId(entityName: string, id: string) {
  return `${entityName}#${id}`;
}

/**
 * GraphManager using graphology's DirectedGraph
 */
export class GraphManager {
  private readonly graph: DirectedGraph;

  /**
   * You can pass graphology constructor options if you want multi-edges,
   * typed edges, self-loops, etc. (e.g. { multi: true, allowSelfLoops: false })
   */
  constructor(options: Record<string, any> = {}) {
    this.graph = new DirectedGraph(options);
  }

  /**
   * Create or ensure a node for the given entity.
   */
  public addEntityNode(entityName: string, id: string): void {
    const nodeId = toNodeId(entityName, id);
    if (!this.graph.hasNode(nodeId)) {
      this.graph.addNode(nodeId);
    }
  }

  /**
   * Remove an entity node entirely, dropping all edges from or to it.
   */
  public removeEntityNode(entityName: string, id: string): void {
    const nodeId = toNodeId(entityName, id);
    if (this.graph.hasNode(nodeId)) {
      this.graph.dropNode(nodeId);
    }
  }

  /**
   * Check if an entity (node) is in the graph.
   */
  public hasEntityNode(entityName: string, id: string): boolean {
    const nodeId = toNodeId(entityName, id);
    return this.graph.hasNode(nodeId);
  }

  /**
   * Add a directed reference from one entity to another (e.g., parent -> child).
   * Creates any missing nodes automatically.
   */
  public addReference(fromName: string, fromId: string, toName: string, toId: string): void {
    const fromNode = toNodeId(fromName, fromId);
    const toNode = toNodeId(toName, toId);

    // Ensure both nodes exist
    if (!this.graph.hasNode(fromNode)) {
      this.graph.addNode(fromNode);
    }
    if (!this.graph.hasNode(toNode)) {
      this.graph.addNode(toNode);
    }

    // For a directed graph, we just add an edge from -> to
    // By default, graphology won't add duplicates if the edge already exists
    if (!this.graph.hasEdge(fromNode, toNode)) {
      this.graph.addEdge(fromNode, toNode);
    }
  }

  /**
   * Remove a directed reference (edge) if it exists.
   */
  public removeReference(fromName: string, fromId: string, toName: string, toId: string): void {
    const fromNode = toNodeId(fromName, fromId);
    const toNode = toNodeId(toName, toId);

    // Graphology edges have an internal ID. We can drop by key or by node pair.
    // If there is only one edge fromNode->toNode, this is fine. For multi-graphs, you'd handle differently.
    if (this.graph.hasEdge(fromNode, toNode)) {
      // dropEdge can accept the edge key (string) or node pair:
      // this.graph.dropEdge(edgeKey);
      // or
      this.graph.dropEdge(fromNode, toNode);
    }
  }

  /**
   * Check if there's a directed edge from one entity to another.
   */
  public hasReference(fromName: string, fromId: string, toName: string, toId: string): boolean {
    const fromNode = toNodeId(fromName, fromId);
    const toNode = toNodeId(toName, toId);
    return this.graph.hasEdge(fromNode, toNode);
  }

  /**
   * Retrieve outbound references (children) from a given entity.
   * Graphology 0.x typically uses `.outNeighbors(node)` to get direct successors in a directed graph.
   */
  public getOutboundReferences(entityName: string, id: string): string[] {
    const nodeId = toNodeId(entityName, id);
    if (!this.graph.hasNode(nodeId)) return [];
    return this.graph.outNeighbors(nodeId) as string[];
  }

  /**
   * Retrieve inbound references (parents) pointing to a given entity.
   */
  public getInboundReferences(entityName: string, id: string): string[] {
    const nodeId = toNodeId(entityName, id);
    if (!this.graph.hasNode(nodeId)) return [];
    return this.graph.inNeighbors(nodeId) as string[];
  }

  /**
   * Clear the entire graph (all nodes and edges).
   */
  public clear(): void {
    this.graph.clear();
  }

  /**
   * Example BFS from a given entity, capturing all reachable nodes:
   */
  public bfsFrom(startName: string, startId: string): string[] {
    const startNode = toNodeId(startName, startId);
    if (!this.graph.hasNode(startNode)) return [];

    const visited = new Set<string>();
    const queue: string[] = [startNode];
    visited.add(startNode);

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const neighbor of this.graph.outNeighbors(current)) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    return Array.from(visited);
  }
}

// Suppose we store an instance in a StateManager or globally:
const graphManager = new GraphManager();

// Add references (User#123 -> Post#999)
graphManager.addReference('User', '123', 'Post', '999');

// Check inbound references for "Post#999" (should contain "User#123"):
console.log(graphManager.getInboundReferences('Post', '999'));

// BFS from "User#123":
const reachable = graphManager.bfsFrom('User', '123');
console.log("All reachable from 'User#123':", reachable);
