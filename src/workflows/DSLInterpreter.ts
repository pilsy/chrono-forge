import { proxyActivities } from '@temporalio/workflow';
import { DirectedGraph } from 'eventemitter3-graphology';
import { hasCycle, topologicalGenerations } from 'graphology-dag';
import { StepMetadata } from '../decorators/Step';

export type DSLDefinition = {
  variables: Record<string, unknown>;
  plan: Statement;
};

export type Statement = {
  when?: (variables: Record<string, unknown>, plan: Statement) => boolean;
  retries?: number;
  timeout?: number;
  required?: boolean;
  waitFor?:
    | ((variables: Record<string, unknown>, plan: Statement) => boolean)
    | [(variables: Record<string, unknown>, plan: Statement) => boolean, number];
} & (
  | { sequence: Sequence }
  | { parallel: Parallel }
  | { execute: Execute }
  | { foreach: ForEach }
  | { while: While }
  | { doWhile: DoWhile }
  | { condition: DSLCondition }
);

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

export type ForEach = {
  items: string;
  item: string;
  body: Statement;
};

export type While = {
  condition: (variables: Record<string, unknown>, plan: Statement) => boolean;
  body: Statement;
};

export type DoWhile = {
  body: Statement;
  condition: (variables: Record<string, unknown>, plan: Statement) => boolean;
};

export type DSLCondition = {
  predicate: string;
  timeout?: number;
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

  // Track nodes that were skipped due to conditions or dependencies
  const skippedNodes = new Set<string>();

  if (generations.length === 0) {
    console.warn('No generations found in the graph. Skipping execution.');
    return;
  }

  console.log(visualizeWorkflowGenerations(graph));

  for (const generation of generations) {
    for (const nodeId of generation) {
      const node = graph.getNodeAttributes(nodeId);
      if (!node?.execute) continue;

      // Check if any dependencies were skipped
      const dependencies = graph.inNeighbors(nodeId);
      const anyDependencySkipped = dependencies.some((depId) => skippedNodes.has(depId));

      if (anyDependencySkipped) {
        // Skip this node if any dependency was skipped
        skippedNodes.add(nodeId);
        console.log(`Skipping node ${nodeId} because a dependency was skipped`);
        continue;
      }

      // Check condition if it exists
      if (node.when) {
        try {
          const conditionMet = node.when(dsl.variables, dsl.plan);
          if (!conditionMet) {
            // Skip this node if condition not met
            skippedNodes.add(nodeId);
            console.log(`Skipping node ${nodeId} because condition returned false`);
            continue;
          }
        } catch (error) {
          console.error(`Error evaluating condition for ${nodeId}:`, error);
          skippedNodes.add(nodeId);
          continue;
        }
      }

      // Handle waitFor if it exists
      if (node.waitFor) {
        try {
          if (Array.isArray(node.waitFor)) {
            const [condition, timeout] = node.waitFor;
            const startTime = Date.now();
            const timeoutMs = timeout * 1000; // Convert seconds to milliseconds

            while (!condition(dsl.variables)) {
              if (Date.now() - startTime > timeoutMs) {
                console.log(`Timeout waiting for condition on node ${nodeId}`);
                skippedNodes.add(nodeId);
                break; // Break out of the while loop
              }
              // Wait a bit before checking again
              await new Promise((resolve) => setTimeout(resolve, 100));
            }

            // Skip this node if it was added to skippedNodes
            if (skippedNodes.has(nodeId)) {
              continue; // Skip to the next node
            }
          } else {
            // Simple condition without timeout
            while (!node.waitFor(dsl.variables)) {
              // Wait a bit before checking again
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
          }
        } catch (error) {
          console.error(`Error in waitFor condition for ${nodeId}:`, error);
          skippedNodes.add(nodeId);
          continue; // Skip to the next node
        }
      }

      // Skip this node if it was added to skippedNodes
      if (skippedNodes.has(nodeId)) {
        continue; // Skip to the next node
      }

      yield {
        nodeId,
        graph,
        bindings: dsl.variables as Record<string, string>,
        acts,
        steps,
        nodeIds: generation,
        execute: async () => await node.execute({ activities: acts, steps, variables: dsl.variables, plan: dsl.plan })
      };
    }
  }

  console.log('Workflow completed successfully');
}

async function executeNode(
  nodeId: string,
  graph: DirectedGraph,
  activities: Record<string, (...args: any[]) => Promise<any>>,
  steps: Record<string, (input: unknown) => Promise<unknown>> | undefined,
  dsl: DSLDefinition
): Promise<unknown> {
  try {
    const node = graph.getNodeAttributes(nodeId);
    if (!node.execute) {
      throw new Error(`No execute function found for node ${nodeId}`);
    }

    return await node.execute({ activities, steps, variables: dsl.variables, plan: dsl.plan });
  } catch (error) {
    console.error(`Error executing node ${nodeId}:`, error);
    throw error;
  }
}

type ExecuteInput = {
  steps?: Record<string, (input: unknown) => Promise<unknown>>;
  activities: Record<string, (...args: any[]) => Promise<any>>;
  variables: Record<string, unknown>;
  plan: Statement;
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
    when?: (variables: Record<string, unknown>, plan: Statement) => boolean,
    waitFor?:
      | ((variables: Record<string, unknown>, plan: Statement) => boolean)
      | [(variables: Record<string, unknown>, plan: Statement) => boolean, number]
  ) => {
    return async ({ activities, steps, variables, plan }: ExecuteInput) => {
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
        // Handle array access like currentSearchResults[0].url
        if (arg.includes('[') && arg.includes(']')) {
          const [arrayName, rest] = arg.split('[');
          const [indexStr, propertyPath] = rest.split(']');
          const index = parseInt(indexStr, 10);

          if (bindings[arrayName] && Array.isArray(bindings[arrayName]) && bindings[arrayName][index]) {
            if (propertyPath) {
              // Handle property access like .url
              const property = propertyPath.substring(1); // Remove the dot
              return bindings[arrayName][index][property];
            }
            return bindings[arrayName][index];
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
    when?: (variables: Record<string, unknown>, plan: Statement) => boolean,
    waitFor?:
      | ((variables: Record<string, unknown>, plan: Statement) => boolean)
      | [(variables: Record<string, unknown>, plan: Statement) => boolean, number]
  ): string => {
    const nodeId = `${type}_${name}_${autoIncrementId++}`;
    graph.addNode(nodeId, {
      type,
      name,
      args,
      result,
      when,
      waitFor,
      execute: createExecuteFunction(type, nodeId, name, args, result, when, waitFor)
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
        nodeId = addNodeAndDependencies('activity', name, args, result, statement.when, statement.waitFor);
      } else if (statement.execute.step) {
        const { name, arguments: args = [], result } = statement.execute.step;
        nodeId = addNodeAndDependencies('step', name, args, result, statement.when, statement.waitFor);
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
    } else if ('foreach' in statement) {
      // Create a special node for the foreach loop
      const nodeId = `foreach_${autoIncrementId++}`;

      graph.addNode(nodeId, {
        type: 'foreach',
        items: statement.foreach.items,
        item: statement.foreach.item,
        body: statement.foreach.body,
        condition: statement.when,
        waitFor: statement.waitFor,
        execute: async ({ activities, steps, variables, plan }: ExecuteInput) => {
          const itemsArray = bindings[statement.foreach.items];
          if (!Array.isArray(itemsArray)) {
            throw new Error(`Variable ${statement.foreach.items} is not an array`);
          }

          for (const item of itemsArray) {
            // Set item variable for the current iteration
            bindings[statement.foreach.item] = item;

            // Create a temporary subgraph for this iteration
            const tempGraph = new DirectedGraph();
            const tempBindings = { ...bindings };

            // Process the body of the loop for this iteration
            const bodyNodeId = processStatementForSubgraph(statement.foreach.body, tempGraph, tempBindings);

            // Execute the subgraph
            if (bodyNodeId) {
              await executeGraphByGenerations(tempGraph, tempBindings, activities, steps, { variables, plan });
            }
          }
        }
      });

      // Add dependency on previous node
      if (previousNodeId) {
        try {
          graph.addDirectedEdge(previousNodeId, nodeId);
        } catch (e) {
          // Edge might already exist
        }
      }

      return nodeId;
    } else if ('while' in statement) {
      const nodeId = `while_${autoIncrementId++}`;

      graph.addNode(nodeId, {
        type: 'while',
        condition: statement.while.condition,
        body: statement.while.body,
        waitFor: statement.waitFor,
        execute: async ({ activities, steps, variables, plan }: ExecuteInput) => {
          while (await statement.while.condition(variables, plan)) {
            // Create a temporary subgraph for this iteration
            const tempGraph = new DirectedGraph();
            const tempBindings = { ...bindings };

            // Process the body of the loop for this iteration
            const bodyNodeId = processStatementForSubgraph(statement.while.body, tempGraph, tempBindings);

            // Execute the subgraph
            if (bodyNodeId) {
              await executeGraphByGenerations(tempGraph, tempBindings, activities, steps, { variables, plan });
            }
          }
        }
      });

      // Add dependency on previous node
      if (previousNodeId) {
        try {
          graph.addDirectedEdge(previousNodeId, nodeId);
        } catch (e) {
          // Edge might already exist
        }
      }

      return nodeId;
    } else if ('doWhile' in statement) {
      const nodeId = `doWhile_${autoIncrementId++}`;

      graph.addNode(nodeId, {
        type: 'doWhile',
        condition: statement.doWhile.condition,
        body: statement.doWhile.body,
        waitFor: statement.waitFor,
        execute: async ({ activities, steps, variables, plan }: ExecuteInput) => {
          do {
            // Create a temporary subgraph for this iteration
            const tempGraph = new DirectedGraph();
            const tempBindings = { ...bindings };

            // Process the body of the loop for this iteration
            const bodyNodeId = processStatementForSubgraph(statement.doWhile.body, tempGraph, tempBindings);

            // Execute the subgraph
            if (bodyNodeId) {
              await executeGraphByGenerations(tempGraph, tempBindings, activities, steps, { variables, plan });
            }
          } while (await statement.doWhile.condition(variables, plan));
        }
      });

      // Add dependency on previous node
      if (previousNodeId) {
        try {
          graph.addDirectedEdge(previousNodeId, nodeId);
        } catch (e) {
          // Edge might already exist
        }
      }

      return nodeId;
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
  activities: Record<string, (...args: any[]) => Promise<any>>,
  steps: Record<string, (input: unknown) => Promise<unknown>> | undefined,
  dsl: DSLDefinition
): Promise<void> {
  const generations = topologicalGenerations(graph);

  if (generations.length === 0) {
    console.warn('No generations found in the graph. Skipping execution.');
    return;
  }

  for (let genIndex = 0; genIndex < generations.length; genIndex++) {
    const generation = generations[genIndex];

    console.log(`Executing generation ${genIndex} with ${generation.length} nodes: ${generation.join(', ')}`);
    await executeGenerationWithErrorHandling(generation, graph, activities, steps, dsl);
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
  activities: Record<string, (...args: any[]) => Promise<any>>,
  steps: Record<string, (input: unknown) => Promise<unknown>> | undefined,
  dsl: DSLDefinition
): Promise<void> {
  const results = await Promise.allSettled(
    generation.map(async (nodeId) => {
      try {
        if (graph.hasNodeAttribute(nodeId, 'execute')) {
          const execute = graph.getNodeAttribute(nodeId, 'execute');
          await execute({ activities, steps, variables: dsl.variables, plan: dsl.plan });
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
 * @param initialVariables Initial variables for the DSL
 * @param workflowInstance The workflow instance (optional)
 * @returns DSLDefinition object representing the workflow steps
 */
export function convertStepsToDSL(
  steps: StepMetadata[],
  initialVariables: Record<string, unknown> = {},
  workflowInstance?: any
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
        const statement: Statement = {
          execute: {
            step: {
              name: stepMeta.method, // Use the method name for execution
              result: stepName // Use the step name as the result identifier
            }
          }
        };

        // Add condition if present
        if (stepMeta.condition) {
          statement.when = (variables, plan) => {
            try {
              if (workflowInstance && typeof stepMeta.condition === 'function') {
                return Boolean(stepMeta.condition.call(workflowInstance));
              }
              if (stepMeta.condition) {
                return Boolean(stepMeta.condition());
              }
              return true;
            } catch (error) {
              console.error(`Error evaluating condition for step ${stepName}:`, error);
              return false;
            }
          };
        }

        // Add other step properties
        if (stepMeta.retries !== undefined) {
          statement.retries = stepMeta.retries;
        }

        if (stepMeta.timeout !== undefined) {
          statement.timeout = stepMeta.timeout;
        }

        if (stepMeta.required !== undefined) {
          statement.required = stepMeta.required;
        }

        dslElements.push(statement);
      }
    } else if (generation.length > 1) {
      // Multiple steps in generation - add as parallel
      const parallelBranches: Statement[] = [];

      for (const stepName of generation) {
        const stepMeta = steps.find((s) => s.name === stepName);
        if (stepMeta) {
          const statement: Statement = {
            execute: {
              step: {
                name: stepMeta.method,
                result: stepName
              }
            }
          };

          // Add condition if present
          if (stepMeta.condition) {
            statement.when = (variables, plan) => {
              try {
                if (workflowInstance && typeof stepMeta.condition === 'function') {
                  return Boolean(stepMeta.condition.call(workflowInstance));
                }
                if (stepMeta.condition) {
                  return Boolean(stepMeta.condition());
                }
                return true;
              } catch (error) {
                console.error(`Error evaluating condition for step ${stepName}:`, error);
                return false;
              }
            };
          }

          // Add other step properties
          if (stepMeta.retries !== undefined) {
            statement.retries = stepMeta.retries;
          }

          if (stepMeta.timeout !== undefined) {
            statement.timeout = stepMeta.timeout;
          }

          if (stepMeta.required !== undefined) {
            statement.required = stepMeta.required;
          }

          parallelBranches.push(statement);
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

// Helper function to process statements in a subgraph
function processStatementForSubgraph(
  statement: Statement,
  subgraph: DirectedGraph,
  subBindings: Record<string, any>
): string | undefined {
  // Similar to processStatement but designed to work on a subgraph
  // This is a simplified implementation - you would need to adapt this
  // to work with your specific DSL structure

  let autoIncrementSubId = 0;

  const processSubStatement = (stmt: Statement, prevNodeId?: string): string | undefined => {
    if ('execute' in stmt) {
      let nodeId: string | undefined;

      if (stmt.execute.activity) {
        const { name, arguments: args = [], result } = stmt.execute.activity;
        nodeId = `${name}_${autoIncrementSubId++}`;
        subgraph.addNode(nodeId, {
          type: 'activity',
          name,
          args,
          result,
          condition: stmt.when,
          waitFor: stmt.waitFor,
          execute: async ({ activities, steps, variables, plan }: ExecuteInput) => {
            const executorMap = activities;
            if (!executorMap?.[name]) {
              throw new Error(`Activity function '${name}' not found`);
            }

            let resolvedArgs = args.map((arg) => {
              if (subBindings[arg] !== undefined) {
                return subBindings[arg];
              }
              return arg;
            });

            // @ts-ignore
            const output = await executorMap[name](...resolvedArgs);
            if (output !== undefined && result) {
              subBindings[result] = output;
            }
            return output;
          }
        });
      } else if (stmt.execute.step) {
        const { name, arguments: args = [], result } = stmt.execute.step;
        nodeId = `${name}_${autoIncrementSubId++}`;
        subgraph.addNode(nodeId, {
          type: 'step',
          name,
          args,
          result,
          condition: stmt.when,
          waitFor: stmt.waitFor,
          execute: async ({ activities, steps, variables, plan }: ExecuteInput) => {
            const executorMap = steps;
            if (!executorMap?.[name]) {
              throw new Error(`Step function '${name}' not found`);
            }

            let resolvedArgs = args.map((arg) => {
              if (subBindings[arg] !== undefined) {
                return subBindings[arg];
              }
              return arg;
            });

            // @ts-ignore
            const output = await executorMap[name](...resolvedArgs);
            if (output !== undefined && result) {
              subBindings[result] = output;
            }
            return output;
          }
        });
      }

      // Add dependency on previous node
      if (nodeId && prevNodeId) {
        try {
          subgraph.addDirectedEdge(prevNodeId, nodeId);
        } catch (e) {
          // Edge might already exist
        }
      }
      return nodeId;
    } else if ('sequence' in stmt) {
      let lastNodeId: string | undefined;
      for (const element of stmt.sequence.elements) {
        lastNodeId = processSubStatement(element, lastNodeId);
      }
      return lastNodeId;
    } else if ('parallel' in stmt) {
      const startNodeId = prevNodeId;
      const nodeIds = stmt.parallel.branches
        .map((branch) => processSubStatement(branch, startNodeId))
        .filter((id): id is string => id !== undefined);

      return nodeIds.length > 0 ? nodeIds[nodeIds.length - 1] : undefined;
    }

    return undefined;
  };

  return processSubStatement(statement);
}
