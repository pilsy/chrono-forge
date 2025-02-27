import { DirectedGraph } from 'eventemitter3-graphology';
import { EntitiesState } from './entities';
import { Relationship, SchemaManager } from './SchemaManager';

/**
 * Convert (entityName, id) to a node ID string, e.g. "User#123".
 */
function toNodeId(entityName: string, id: string): string {
  return `${entityName}#${id}`;
}

/**
 * GraphManager that stores references in a directed graph,
 * and provides custom BFS + cycle detection.
 */
export class GraphManager {
  private readonly graph: DirectedGraph;

  constructor(options: Record<string, any> = {}) {
    this.graph = new DirectedGraph(options);
  }

  // ---------------------------------------------------------------------------
  // Basic Node & Edge Management
  // ---------------------------------------------------------------------------

  public addEntityNode(entityName: string, id: string): void {
    const nodeId = toNodeId(entityName, id);
    if (!this.graph.hasNode(nodeId)) {
      this.graph.addNode(nodeId);
    }
  }

  public removeEntityNode(entityName: string, id: string): void {
    const nodeId = toNodeId(entityName, id);
    if (this.graph.hasNode(nodeId)) {
      this.graph.dropNode(nodeId);
    }
  }

  public hasEntityNode(entityName: string, id: string): boolean {
    return this.graph.hasNode(toNodeId(entityName, id));
  }

  public addReference(fromName: string, fromId: string, toName: string, toId: string): void {
    const fromNode = toNodeId(fromName, fromId);
    const toNode = toNodeId(toName, toId);

    if (!this.graph.hasNode(fromNode)) {
      this.graph.addNode(fromNode);
    }
    if (!this.graph.hasNode(toNode)) {
      this.graph.addNode(toNode);
    }

    if (!this.graph.hasEdge(fromNode, toNode)) {
      this.graph.addEdge(fromNode, toNode);
    }
  }

  public removeReference(fromName: string, fromId: string, toName: string, toId: string): void {
    const fromNode = toNodeId(fromName, fromId);
    const toNode = toNodeId(toName, toId);
    if (this.graph.hasEdge(fromNode, toNode)) {
      this.graph.dropEdge(fromNode, toNode);
    }
  }

  public hasReference(fromName: string, fromId: string, toName: string, toId: string): boolean {
    return this.graph.hasEdge(toNodeId(fromName, fromId), toNodeId(toName, toId));
  }

  public getOutboundReferences(entityName: string, id: string): string[] {
    const nodeId = toNodeId(entityName, id);
    if (!this.graph.hasNode(nodeId)) return [];
    return Array.from(this.graph.outNeighbors(nodeId));
  }

  public getInboundReferences(entityName: string, id: string): string[] {
    const nodeId = toNodeId(entityName, id);
    if (!this.graph.hasNode(nodeId)) return [];
    return Array.from(this.graph.inNeighbors(nodeId));
  }

  public clear(): void {
    this.graph.clear();
  }

  // ---------------------------------------------------------------------------
  // PART 1: BFS with maxDepth & skipping siblings
  // ---------------------------------------------------------------------------

  /**
   * BFS that:
   *  1) stops expanding if depth >= maxDepth
   *  2) if we arrive at a parent node from a child,
   *     we skip expansions to that parent's other children
   *     => "sibling skipping"
   */
  public customBFS(startName: string, startId: string, maxDepth: number): string[] {
    const startNode = toNodeId(startName, startId);
    if (!this.graph.hasNode(startNode)) return [];

    // visited: set of nodes we have already discovered
    const visited = new Set<string>();

    // We'll store BFS queue items as: { node, from, depth }
    // where 'from' is the node we arrived from
    const queue: Array<{ node: string; from?: string; depth: number }> = [{ node: startNode, depth: 0 }];
    visited.add(startNode);

    while (queue.length > 0) {
      const { node, from, depth } = queue.shift()!;

      // If we've hit max depth, don't expand further
      if (depth >= maxDepth) continue;

      // Expand outNeighbors
      // But if `node` is a parent of `from`, skip expansions to siblings
      // i.e., if from is in node.outNeighbors, we don't want to go from node->(other children).
      // We'll define "isParentOfFrom" as node -> from edge existing:
      const isParentOfFrom = !!(from && this.graph.hasEdge(node, from));

      for (const neighbor of this.graph.outNeighbors(node)) {
        // Sibling skipping logic:
        if (isParentOfFrom && neighbor !== from) {
          // That means 'neighbor' is a sibling of 'from'.
          // We skip it, i.e. do not enqueue it.
          continue;
        }

        // Normal BFS check: skip if we've visited
        if (!visited.has(neighbor)) {
          visited.add(neighbor);

          queue.push({
            node: neighbor,
            from: node,
            depth: depth + 1
          });
        }
      }
    }

    return Array.from(visited);
  }

  // ---------------------------------------------------------------------------
  // PART 2: A simple cycle detection
  // ---------------------------------------------------------------------------

  /**
   * detectCycle: runs a DFS across all nodes looking for a cycle.
   * If any cycle is found, returns true. Otherwise returns false.
   *
   * If your references are expected to be a DAG, this is a quick safety check.
   */
  public detectCycle(): boolean {
    const visited = new Set<string>();
    const inStack = new Set<string>(); // track nodes in the current DFS path

    for (const node of this.graph.nodes()) {
      if (!visited.has(node)) {
        if (this._dfsCycle(node, visited, inStack)) {
          return true; // cycle found
        }
      }
    }
    return false;
  }

  private _dfsCycle(node: string, visited: Set<string>, inStack: Set<string>): boolean {
    visited.add(node);
    inStack.add(node);

    for (const neighbor of this.graph.outNeighbors(node)) {
      if (!visited.has(neighbor)) {
        // If neighbor not visited, recurse
        if (this._dfsCycle(neighbor, visited, inStack)) return true;
      } else if (inStack.has(neighbor)) {
        // neighbor is in the current path => cycle
        return true;
      }
    }

    inStack.delete(node);
    return false;
  }

  /**
   * Integrates with SchemaManager to build the reference graph from schema relationships
   * @param state The current entity state
   */
  public buildFromState(state: EntitiesState): void {
    this.clear();

    // First pass: add all entity nodes
    Object.entries(state).forEach(([entityName, entities]) => {
      Object.keys(entities).forEach((id) => {
        this.addEntityNode(entityName, id);
      });
    });

    // Second pass: add all references based on schema relationships
    Object.entries(state).forEach(([entityName, entities]) => {
      const relationships = SchemaManager.relationshipMap[entityName];
      if (!relationships) return;

      Object.entries(entities).forEach(([id, entity]) => {
        // Process each relationship field
        Object.entries(relationships).forEach(([fieldName, relation]) => {
          if (fieldName === '_referencedBy') return;

          const { relatedEntityName, isMany } = relation as Relationship;
          const value = entity[fieldName];

          if (isMany && Array.isArray(value)) {
            // Handle array of references
            value.forEach((targetId: string) => {
              this.addReference(entityName, id, relatedEntityName, targetId);
            });
          } else if (value) {
            // Handle single reference
            this.addReference(entityName, id, relatedEntityName, value);
          }
        });
      });
    });
  }

  /**
   * Checks if an entity is referenced by other entities
   * @param entityName Name of the entity type
   * @param id ID of the entity
   * @param ignoreReference Optional reference to ignore
   * @returns True if the entity is referenced
   */
  public isEntityReferenced(
    entityName: string,
    id: string,
    ignoreReference?: { entityName: string; id: string }
  ): boolean {
    const inboundRefs = this.getInboundReferences(entityName, id);

    if (inboundRefs.length === 0) {
      return false;
    }

    if (!ignoreReference) {
      return true;
    }

    // If there's only one reference and it's the one we're ignoring, return false
    if (inboundRefs.length === 1) {
      const ref = inboundRefs[0];
      const [refEntityName, refId] = ref.split('#');

      if (refEntityName === ignoreReference.entityName && refId === ignoreReference.id) {
        return false;
      }
    }

    return true;
  }

  /**
   * Traverses the graph to find all related entities within a certain depth
   * @param entityName Name of the entity type
   * @param id ID of the entity
   * @param maxDepth Maximum traversal depth
   * @returns Map of entity types to sets of entity IDs
   */
  public findRelatedEntities(entityName: string, id: string, maxDepth: number): Map<string, Set<string>> {
    const visited = this.customBFS(entityName, id, maxDepth);
    const result = new Map<string, Set<string>>();

    visited.forEach((nodeId) => {
      const [entName, entId] = nodeId.split('#');

      if (!result.has(entName)) {
        result.set(entName, new Set<string>());
      }

      result.get(entName)!.add(entId);
    });

    return result;
  }
}
