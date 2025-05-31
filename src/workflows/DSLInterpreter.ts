import { proxyActivities, inWorkflowContext, condition } from '@temporalio/workflow';
import { DirectedGraph } from 'eventemitter3-graphology';
import { hasCycle, topologicalGenerations } from 'graphology-dag';
import { StepMetadata } from '../decorators/Step';
import dottie from 'dottie';

export type DSLDefinition = {
  variables: Record<string, unknown>;
  plan: Statement;
};

export type StatementConditions = {
  when?: (variables: Record<string, unknown>, plan: Statement) => boolean;
  wait?:
    | ((variables: Record<string, unknown>, plan: Statement) => boolean)
    | [(variables: Record<string, unknown>, plan: Statement) => boolean, number];
  timeout?: number;
  retries?: number;
  required?: boolean;
};

export type Statement = {
  sequence?: Sequence;
  parallel?: Parallel;
  execute?: Execute;
  foreach?: ForEach;
  while?: While;
  doWhile?: DoWhile;
} & StatementConditions;

export type Sequence = {
  elements: Statement[];
} & StatementConditions;

export type Parallel = {
  branches: Statement[];
} & StatementConditions;

export type Execute = {
  // Optional name, defaults to the name of the step, activity or workflow
  name?: string;

  code?: string;
  step?: string;
  activity?: string;
  workflow?: string;

  with?: string[];
  store?: string;
} & StatementConditions;

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
  injectedSteps?: Record<string, (...args: string[]) => Promise<string | undefined>>,
  options?: {
    visualizationFormat?: 'list' | 'tree';
  }
): AsyncGenerator<DSLGeneration, void, unknown> {
  const acts =
    injectedActivities ||
    proxyActivities<Record<string, (...args: string[]) => Promise<string | undefined>>>({
      startToCloseTimeout: '1 minute'
    });

  const steps = injectedSteps || {};
  const visualizationFormat = options?.visualizationFormat ?? 'tree';

  // Create a proxy for the variables that updates dsl.variables automatically
  const bindings = new Proxy(dsl.variables as Record<string, any>, {
    get: (target, prop: string) => {
      // Always get the most up-to-date value from dsl.variables
      return dsl.variables[prop];
    },
    set: (target, prop: string, value) => {
      // Update both the target and dsl.variables
      target[prop] = value;
      dsl.variables[prop] = value;
      return true;
    }
  });

  const graph = buildDependencyGraph(dsl.plan, bindings);
  const generations = topologicalGenerations(graph);

  if (generations.length === 0) {
    console.warn('No generations found in the graph. Skipping execution.');
    return;
  }

  console.log(visualizeWorkflow(graph, visualizationFormat));

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

            // If this is a sequence node, also mark all descendant nodes to be skipped
            if (node.type === 'sequence') {
              // Get all descendant nodes by looking at all outNeighbors recursively
              const descendants = getAllDescendants(graph, nodeId);
              for (const descendantId of descendants) {
                skippedNodes.add(descendantId);
                console.log(
                  `Skipping descendant node ${descendantId} because parent sequence condition returned false`
                );
              }
            }

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
          if (inWorkflowContext()) {
            await condition(
              Array.isArray(node.wait) ? node.wait[0] : node.wait,
              Array.isArray(node.wait) ? node.wait[1] : undefined
            );
          } else {
            // Non-workflow context handling
            const waitFn = Array.isArray(node.wait) ? node.wait[0] : node.wait;
            const timeout = Array.isArray(node.wait) ? node.wait[1] : undefined;
            const startTime = Date.now();
            const hasTimeout = timeout !== undefined && timeout !== null && timeout > 0;
            const timeoutMs = hasTimeout ? timeout * 1000 : 0;

            while (!waitFn(dsl.variables, dsl.plan)) {
              if (hasTimeout && Date.now() - startTime > timeoutMs) {
                console.log(`Timeout waiting for condition on node ${nodeId}`);
                skippedNodes.add(nodeId);
                break;
              }
              await new Promise((resolve) => setTimeout(resolve, 100));
            }

            if (skippedNodes.has(nodeId)) {
              continue;
            }
          }
        } catch (error) {
          console.error(`Error in wait condition for ${nodeId}:`, error);
          skippedNodes.add(nodeId);
          continue;
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
  let autoIncrementId = startId ?? 0;

  const graph = existingGraph ?? new DirectedGraph();

  const createExecuteFunction = (
    type: 'activity' | 'step' | 'code' | 'workflow' | 'sequence' | 'foreach' | 'while' | 'doWhile',
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
        const value = dottie.get(bindings, arg);
        if (value !== undefined) return value;

        return graph.hasNode(arg) ? (graph.getNodeAttribute(arg, 'result') ?? arg) : arg;
      });

      // @ts-ignore
      const output = await executorMap[name](...resolvedArgs);
      if (output !== undefined) {
        if (store) {
          bindings[store] = output;
        }
        graph.setNodeAttribute(nodeId, 'result', output);
      }
      return output;
    };
  };

  const addNodeAndDependencies = (
    type: 'activity' | 'step' | 'code' | 'workflow' | 'sequence' | 'foreach' | 'while' | 'doWhile',
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

    for (const arg of args) {
      const dependencyNodes = Array.from(graph.nodes()).filter((n) => {
        const nodeResult = graph.getNodeAttribute(n, 'store');
        return nodeResult === arg;
      });

      for (const depNode of dependencyNodes) {
        try {
          graph.addDirectedEdge(depNode, nodeId);
        } catch {}
      }
    }

    return nodeId;
  };

  const processStatement = (statement: Statement, previousNodeId?: string): string | undefined => {
    let nodeId: string | undefined;

    if ('sequence' in statement) {
      const { elements, when, wait, required } = statement.sequence as Sequence;

      if (when || wait) {
        nodeId = `sequence_condition_${autoIncrementId++}`;
        graph.addNode(nodeId, {
          type: 'sequence',
          when,
          wait,
          required,
          execute: async ({ activities, steps, variables, plan }: ExecuteInput) => {
            const tempGraph = buildDependencyGraph({ sequence: { elements } }, bindings, undefined, autoIncrementId);
            autoIncrementId += 1000;

            await executeGraphByGenerations(
              tempGraph,
              bindings,
              activities,
              steps,
              { variables, plan },
              { visualizationFormat: 'tree' }
            );
          }
        });

        if (previousNodeId) {
          try {
            graph.addDirectedEdge(previousNodeId, nodeId);
          } catch {}
        }
      }

      let lastNodeId = nodeId;
      for (const element of elements) {
        lastNodeId = processStatement(element, lastNodeId);
      }
      return lastNodeId;
    } else if ('parallel' in statement) {
      const startNodeId = previousNodeId;
      const nodeIds = (statement?.parallel?.branches ?? [])
        .map((branch) => processStatement(branch, startNodeId))
        .filter((id): id is string => id !== undefined);

      return nodeIds.length > 0 ? nodeIds[nodeIds.length - 1] : undefined;
    } else {
      if (statement?.foreach) {
        nodeId = `foreach_${autoIncrementId++}`;
        graph.addNode(nodeId, {
          type: 'foreach',
          in: statement.foreach.in,
          as: statement.foreach.as,
          body: statement.foreach.body,
          condition: statement.when,
          wait: statement.wait,
          execute: async ({ activities, steps, variables, plan }: ExecuteInput) => {
            const itemsArray = dottie.get(bindings, statement.foreach!.in, []);

            for (const as of itemsArray) {
              bindings[statement.foreach!.as] = as;

              const tempGraph = buildDependencyGraph(statement.foreach!.body, bindings, undefined, autoIncrementId);
              autoIncrementId += 1000;

              await executeGraphByGenerations(
                tempGraph,
                bindings,
                activities,
                steps,
                { variables, plan },
                { visualizationFormat: 'tree' }
              );
            }
          }
        });
      } else if (statement?.while) {
        nodeId = `while_${autoIncrementId++}`;
        graph.addNode(nodeId, {
          type: 'while',
          condition: statement.while.condition,
          body: statement.while.body,
          wait: statement.wait,
          execute: async ({ activities, steps, variables, plan }: ExecuteInput) => {
            while (await statement.while!.condition(variables, plan)) {
              const tempGraph = buildDependencyGraph(statement.while!.body, bindings, undefined, autoIncrementId);
              autoIncrementId += 1000;

              await executeGraphByGenerations(
                tempGraph,
                bindings,
                activities,
                steps,
                { variables, plan },
                { visualizationFormat: 'tree' }
              );
            }
          }
        });
      } else if (statement?.doWhile) {
        nodeId = `doWhile_${autoIncrementId++}`;
        graph.addNode(nodeId, {
          type: 'doWhile',
          condition: statement.doWhile.condition,
          body: statement.doWhile.body,
          wait: statement.wait,
          execute: async ({ activities, steps, variables, plan }: ExecuteInput) => {
            do {
              const tempGraph = buildDependencyGraph(statement.doWhile!.body, bindings, undefined, autoIncrementId);
              autoIncrementId += 1000;

              await executeGraphByGenerations(
                tempGraph,
                bindings,
                activities,
                steps,
                { variables, plan },
                { visualizationFormat: 'tree' }
              );
            } while (await statement.doWhile!.condition(variables, plan));
          }
        });
      } else if (statement?.execute) {
        const { name = `${autoIncrementId++}`, with: args = [], store, code, step, activity } = statement.execute;

        if (activity) {
          nodeId = addNodeAndDependencies('activity', activity, args, store, statement);
        } else if (step) {
          nodeId = addNodeAndDependencies('step', step, args, store, statement);
        } else if (code) {
          nodeId = addNodeAndDependencies('code', name, args, store, statement, {
            [name]: async (...vals: any[]) => {
              const context: Record<string, any> = {};

              for (let i = 0; i < args.length; i++) {
                context[args[i]] = vals[i];
              }

              const contextProxy = new Proxy(context, {
                get: (target, prop: string) => {
                  if (prop in target) {
                    return target[prop];
                  }
                  // Access bindings which will get the latest value from dsl.variables
                  return bindings[prop];
                },
                set: (target, prop: string, value) => {
                  if (args.includes(prop)) {
                    target[prop] = value;
                  }
                  // Update bindings (which will update dsl.variables through its proxy)
                  bindings[prop] = value;
                  return true;
                }
              });

              const fn = new Function('context', `with (context) { ${code} }`);
              return fn(contextProxy);
            }
          });
        }
      }

      if (nodeId && previousNodeId) {
        try {
          graph.addDirectedEdge(previousNodeId, nodeId);
        } catch {}
      }
      return nodeId;
    }
  };

  processStatement(plan);

  if (hasCycle(graph)) {
    throw new Error('Circular dependency detected in workflow graph');
  }

  return graph;
}

async function executeGraphByGenerations(
  graph: DirectedGraph,
  bindings: Record<string, string | undefined>,
  activities: Record<string, (...args: any[]) => Promise<any>>,
  steps: Record<string, (input: unknown) => Promise<unknown>> | undefined,
  dsl: DSLDefinition,
  options?: {
    visualizationFormat?: 'list' | 'tree';
  }
): Promise<void> {
  const generations = topologicalGenerations(graph);
  if (generations.length === 0) {
    console.warn('No generations found in the graph. Skipping execution.');
    return;
  }

  console.log(visualizeWorkflow(graph, options?.visualizationFormat ?? 'list'));

  for (let genIndex = 0; genIndex < generations.length; genIndex++) {
    const generation = generations[genIndex];

    console.log(
      `\x1b[1m\x1b[36mExecuting generation ${genIndex} with ${generation.length} nodes:\x1b[0m ${generation.join(', ')}`
    );
    await executeGenerationWithErrorHandling(generation, graph, activities, steps, dsl);
  }
  console.log('\x1b[1m\x1b[32mWorkflow completed successfully\x1b[0m');
}

function visualizeWorkflowGenerations(graph: DirectedGraph): string {
  const generations = topologicalGenerations(graph);
  let visualization = '\x1b[1m\x1b[36mWorkflow Execution Plan:\x1b[0m\n';

  generations.forEach((generation, index) => {
    visualization += `\n\x1b[1m\x1b[33mGeneration ${index}:\x1b[0m\n`;
    generation.forEach((nodeId) => {
      const dependencies = graph.inNeighbors(nodeId);
      const nodeType = graph.hasNodeAttribute(nodeId, 'type') ? graph.getNodeAttribute(nodeId, 'type') : 'unknown';

      // Color-code different node types
      let nodeTypeColor = '\x1b[32m'; // Default green
      if (nodeType === 'activity') nodeTypeColor = '\x1b[35m'; // Magenta
      if (nodeType === 'step') nodeTypeColor = '\x1b[36m'; // Cyan
      if (nodeType === 'foreach' || nodeType === 'while' || nodeType === 'doWhile') nodeTypeColor = '\x1b[33m'; // Yellow

      visualization += `  • \x1b[1m${nodeId}\x1b[0m [${nodeTypeColor}${nodeType}\x1b[0m]`;

      if (dependencies.length > 0) {
        visualization += ` \x1b[90m(depends on: ${dependencies.join(', ')})\x1b[0m`;
      }
      visualization += '\n';
    });
  });

  return visualization;
}

/**
 * Creates a tree-style visualization of workflow generations
 * @param graph The directed graph representing the workflow
 * @returns A string with ASCII tree visualization of the workflow
 */
function visualizeWorkflowAsTree(graph: DirectedGraph): string {
  topologicalGenerations(graph);
  let result = '\x1b[1m\x1b[36mWorkflow Tree:\x1b[0m\n';

  // Create a map of node to its children
  const nodeChildren: Record<string, string[]> = {};
  graph.forEachNode((nodeId) => {
    nodeChildren[nodeId] = graph.outNeighbors(nodeId);
  });

  // Find root nodes (nodes with no incoming edges)
  const rootNodes = graph.nodes().filter((node) => graph.inDegree(node) === 0);

  // Recursively build the tree
  const buildTree = (nodeId: string, prefix = '', isLast = true) => {
    const nodeType = graph.hasNodeAttribute(nodeId, 'type') ? graph.getNodeAttribute(nodeId, 'type') : 'unknown';

    // Color-code different node types
    let nodeTypeColor = '\x1b[32m'; // Default green
    if (nodeType === 'activity') nodeTypeColor = '\x1b[35m'; // Magenta
    if (nodeType === 'step') nodeTypeColor = '\x1b[36m'; // Cyan
    if (nodeType === 'foreach' || nodeType === 'while' || nodeType === 'doWhile') nodeTypeColor = '\x1b[33m'; // Yellow

    // Current line connector
    const connector = isLast ? '└── ' : '├── ';

    // Add the current node to the result
    result += `${prefix}${connector}\x1b[1m${nodeId}\x1b[0m [${nodeTypeColor}${nodeType}\x1b[0m]\n`;

    // Prefix for children
    const newPrefix = prefix + (isLast ? '    ' : '│   ');

    // Add all children
    const children = nodeChildren[nodeId] || [];
    children.forEach((child, index) => {
      buildTree(child, newPrefix, index === children.length - 1);
    });
  };

  // Build tree starting from each root node
  rootNodes.forEach((rootNode, index) => {
    buildTree(rootNode, '', index === rootNodes.length - 1);
  });

  return result;
}

/**
 * Visualizes the workflow generations in different formats
 * @param graph The directed graph to visualize
 * @param format Optional format (list or tree)
 * @returns String representation of the workflow
 */
function visualizeWorkflow(graph: DirectedGraph, format: 'list' | 'tree' = 'list'): string {
  return format === 'tree' ? visualizeWorkflowAsTree(graph) : visualizeWorkflowGenerations(graph);
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

        // Add when condition if present
        if (stepMeta.when) {
          const whenFn = stepMeta.when;
          statement.when = function (variables, plan) {
            try {
              if (workflowInstance) {
                return Boolean(whenFn.call(workflowInstance, variables, plan));
              }
              return Boolean(whenFn.call(this, variables, plan));
            } catch (error) {
              console.error(`Error evaluating when condition for step ${stepName}:`, error);
              return false;
            }
          };
        }

        // Add wait condition if present (maps from condition)
        if (stepMeta.condition) {
          const waitFn = stepMeta.condition;
          statement.wait = function (variables, plan) {
            try {
              if (workflowInstance) {
                return Boolean(waitFn.call(workflowInstance, variables, plan));
              }
              return Boolean(waitFn.call(this, variables, plan));
            } catch (error) {
              console.error(`Error evaluating wait condition for step ${stepName}:`, error);
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

          // Add when condition if present
          if (stepMeta.when) {
            const whenFn = stepMeta.when;
            statement.when = function (variables, plan) {
              try {
                if (workflowInstance) {
                  return Boolean(whenFn.call(workflowInstance, variables, plan));
                }
                return Boolean(whenFn.call(this, variables, plan));
              } catch (error) {
                console.error(`Error evaluating when condition for step ${stepName}:`, error);
                return false;
              }
            };
          }

          // Add wait condition if present (maps from condition)
          if (stepMeta.condition) {
            const waitFn = stepMeta.condition;
            statement.wait = function (variables, plan) {
              try {
                if (workflowInstance) {
                  return Boolean(waitFn.call(workflowInstance, variables, plan));
                }
                return Boolean(waitFn.call(this, variables, plan));
              } catch (error) {
                console.error(`Error evaluating wait condition for step ${stepName}:`, error);
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

/**
 * Recursively find all descendants of a node in a graph
 * @param graph The directed graph
 * @param nodeId The parent node ID
 * @returns Array of all descendant node IDs
 */
function getAllDescendants(graph: DirectedGraph, nodeId: string): string[] {
  const descendants: Set<string> = new Set();

  function collectDescendants(currentNodeId: string) {
    const children = graph.outNeighbors(currentNodeId);
    for (const childId of children) {
      if (!descendants.has(childId)) {
        descendants.add(childId);
        collectDescendants(childId);
      }
    }
  }

  collectDescendants(nodeId);
  return Array.from(descendants);
}
