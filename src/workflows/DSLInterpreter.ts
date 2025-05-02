import dottie from 'dottie';
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
  wait?:
    | ((variables: Record<string, unknown>, plan: Statement) => boolean)
    | [(variables: Record<string, unknown>, plan: Statement) => boolean, number];
} & (
  | { sequence: Sequence }
  | { parallel: Parallel }
  | { execute: Execute }
  | { foreach: ForEach }
  | { while: While }
  | { doWhile: DoWhile }
);

export type Sequence = {
  elements: Statement[];
};

export type Parallel = {
  branches: Statement[];
};

export type Execute = {
  // Optional name, defaults to the name of the step, activity or workflow
  name?: string;

  code?: string;
  step?: string;
  activity?: string;
  workflow?: string;

  with?: string[];
  store?: string;
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
  in: string;
  as: string;
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

// Consolidate execution context type
type ExecutionContext = {
  activities: Record<string, (...args: any[]) => Promise<any>>;
  steps: Record<string, (input: unknown) => Promise<unknown>> | undefined;
  variables: Record<string, unknown>;
  plan: Statement;
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

  // Create a proxy for the variables that updates dsl.variables automatically
  const bindings = new Proxy(dsl.variables as Record<string, any>, {
    get: (target, prop: string) => target[prop],
    set: (target, prop: string, value) => {
      target[prop] = value;
      return true;
    }
  });

  const graph = buildDependencyGraph(dsl.plan, bindings);
  const generations = topologicalGenerations(graph);

  if (generations.length === 0) {
    console.warn('No generations found in the graph. Skipping execution.');
    return;
  }

  console.log(visualizeWorkflowGenerations(graph));

  const skippedNodes = new Set<string>();
  for (const generation of generations) {
    for (const nodeId of generation) {
      const node = graph.getNodeAttributes(nodeId);
      if (!node?.execute) continue;

      // Check if any dependencies were skipped
      const dependencies = graph.inNeighbors(nodeId);
      const anyRequiredDependencySkipped = dependencies.some((depId) => {
        if (!skippedNodes.has(depId)) {
          return false;
        }

        // Check if the dependency is required
        const depNode = graph.getNodeAttributes(depId);
        return depNode?.required === true;
      });

      if (anyRequiredDependencySkipped) {
        // Skip this node if any required dependency was skipped
        skippedNodes.add(nodeId);
        console.log(`Skipping node ${nodeId} because a required dependency was skipped`);
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

      // Handle wait if it exists
      if (node.wait) {
        try {
          if (Array.isArray(node.wait)) {
            const [condition, timeout] = node.wait;
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
            while (!node.wait(dsl.variables)) {
              // Wait a bit before checking again
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
          }
        } catch (error) {
          console.error(`Error in wait condition for ${nodeId}:`, error);
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

type ExecuteInput = {
  steps?: Record<string, (input: unknown) => Promise<unknown>>;
  activities: Record<string, (...args: any[]) => Promise<any>>;
  variables: Record<string, unknown>;
  plan: Statement;
};

function buildDependencyGraph(
  plan: Statement,
  bindings: Record<string, string | undefined>,
  existingGraph?: DirectedGraph,
  startId?: number
): DirectedGraph {
  const graph = existingGraph || new DirectedGraph();
  let autoIncrementId = startId || 0;

  const createExecuteFunction = (
    type: 'activity' | 'step' | 'code' | 'workflow',
    nodeId: string,
    name: string,
    args: string[],
    store?: string,
    statement?: Statement,
    executorMap?: Record<string, (...args: any[]) => Promise<any>>
  ) => {
    return async ({ activities, steps, variables, plan }: ExecutionContext) => {
      executorMap = executorMap ?? (type === 'activity' ? activities : steps);
      if (!executorMap?.[name]) {
        throw new Error(`${type} function '${name}' not found`);
      }

      const resolvedArgs = args.map((arg) => {
        // Get value directly from the proxied bindings
        const value = bindings[arg];
        if (value !== undefined) return value;

        // Check for result from another node
        return graph.hasNode(arg) ? (graph.getNodeAttribute(arg, 'result') ?? arg) : arg;
      });

      // @ts-ignore
      const output = await executorMap[name](...resolvedArgs);
      if (output !== undefined) {
        if (store) {
          // Store directly to bindings via proxy
          bindings[store] = output;
        }
        graph.setNodeAttribute(nodeId, 'result', output);
      }
      return output;
    };
  };

  const addNodeAndDependencies = (
    type: 'activity' | 'step' | 'code' | 'workflow',
    name: string,
    args: string[],
    store?: string,
    statement?: Statement,
    executorMap?: Record<string, (...args: any[]) => Promise<any>>
  ): string => {
    const nodeId = `${type}_${name}_${autoIncrementId++}`;
    graph.addNode(nodeId, {
      type,
      name,
      args,
      store,
      when: statement?.when,
      wait: statement?.wait,
      required: statement?.required,
      execute: createExecuteFunction(type, nodeId, name, args, store, statement, executorMap)
    });

    // Add edges from nodes that have results matching our with
    for (const arg of args) {
      const dependencyNodes = Array.from(graph.nodes()).filter((n) => {
        const nodeResult = graph.getNodeAttribute(n, 'store');
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

      const { name = `${autoIncrementId++}`, with: args = [], store, code, step, activity } = statement.execute;
      if (activity) {
        nodeId = addNodeAndDependencies('activity', activity, args, store, statement);
      } else if (step) {
        nodeId = addNodeAndDependencies('step', step, args, store, statement);
      } else if (code) {
        nodeId = addNodeAndDependencies('code', name, args, store, statement, {
          [name]: async (...vals: any[]) => {
            // Create a context object that uses the proxy for all accessed variables
            const context: Record<string, any> = {};

            // Map the provided values to their argument names
            for (let i = 0; i < args.length; i++) {
              // Get the initial value from bindings through the proxy
              context[args[i]] = vals[i];
            }

            // Create a proxy for the context that updates bindings
            const contextProxy = new Proxy(context, {
              get: (target, prop: string) => {
                // Try to get from context first, then from bindings
                if (prop in target) {
                  return target[prop];
                }
                return bindings[prop];
              },
              set: (target, prop: string, value) => {
                // If this is an argument, update context
                if (args.includes(prop)) {
                  target[prop] = value;
                }
                // Always update bindings which updates dsl.variables via the proxy
                bindings[prop] = value;
                return true;
              }
            });

            // Execute the code with access to all variables via the proxy
            const fn = new Function('context', `with (context) { ${code} }`);
            return fn(contextProxy);
          }
        });
      }

      if (nodeId && previousNodeId) {
        try {
          graph.addDirectedEdge(previousNodeId, nodeId);
        } catch (e) {}
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
        in: statement.foreach.in,
        as: statement.foreach.as,
        body: statement.foreach.body,
        condition: statement.when,
        wait: statement.wait,
        execute: async ({ activities, steps, variables, plan }: ExecuteInput) => {
          const itemsArray = bindings[statement.foreach.in];
          if (!Array.isArray(itemsArray)) {
            throw new Error(`Variable ${statement.foreach.in} is not an array`);
          }

          for (const as of itemsArray) {
            bindings[statement.foreach.as] = as;

            const tempGraph = buildDependencyGraph(statement.foreach.body, bindings, undefined, autoIncrementId);
            autoIncrementId += 1000;

            await executeGraphByGenerations(tempGraph, bindings, activities, steps, { variables, plan });
          }
        }
      });

      if (previousNodeId) {
        try {
          graph.addDirectedEdge(previousNodeId, nodeId);
        } catch (e) {}
      }

      return nodeId;
    } else if ('while' in statement) {
      const nodeId = `while_${autoIncrementId++}`;

      graph.addNode(nodeId, {
        type: 'while',
        condition: statement.while.condition,
        body: statement.while.body,
        wait: statement.wait,
        execute: async ({ activities, steps, variables, plan }: ExecuteInput) => {
          while (await statement.while.condition(variables, plan)) {
            const tempGraph = buildDependencyGraph(statement.while.body, bindings, undefined, autoIncrementId);
            autoIncrementId += 1000;

            await executeGraphByGenerations(tempGraph, bindings, activities, steps, { variables, plan });
          }
        }
      });

      if (previousNodeId) {
        try {
          graph.addDirectedEdge(previousNodeId, nodeId);
        } catch (e) {}
      }

      return nodeId;
    } else if ('doWhile' in statement) {
      const nodeId = `doWhile_${autoIncrementId++}`;

      graph.addNode(nodeId, {
        type: 'doWhile',
        condition: statement.doWhile.condition,
        body: statement.doWhile.body,
        wait: statement.wait,
        execute: async ({ activities, steps, variables, plan }: ExecuteInput) => {
          do {
            const tempGraph = buildDependencyGraph(statement.doWhile.body, bindings, undefined, autoIncrementId);
            autoIncrementId += 1000;

            await executeGraphByGenerations(tempGraph, bindings, activities, steps, { variables, plan });
          } while (await statement.doWhile.condition(variables, plan));
        }
      });

      if (previousNodeId) {
        try {
          graph.addDirectedEdge(previousNodeId, nodeId);
        } catch (e) {}
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
            step: stepMeta.method, // Use the method name for execution
            store: stepName // Use the step name as the result identifier
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
              step: stepMeta.method,
              store: stepName
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
