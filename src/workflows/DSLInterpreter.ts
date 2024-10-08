export type DSLDefinition = {
  variables: Record<string, any>;
  state: Record<string, any>;
  plan: DSLStatement;
};

export type DSLStatement = { when?: (dsl: DSLDefinition) => Promise<boolean>; until?: (dsl: DSLDefinition) => Promise<boolean> } & (
  | { execute: Execute }
  | { sequence: Sequence }
  | { parallel: Parallel }
);

export type Sequence = { elements: DSLStatement[] };
export type Parallel = { branches: DSLStatement[] };
export type Execute = { name: string; code?: string; needs?: string[]; provides?: string[]; result?: string };

export async function DSLInterpreter(dsl: DSLDefinition): Promise<unknown> {
  const bindings = dsl.variables as Record<string, string>;
  return await execute(dsl.plan, bindings);
}

export async function execute(statement: DSLStatement, bindings: Record<string, string | undefined>): Promise<void> {
  if ('parallel' in statement) {
    await Promise.all(statement.parallel.branches.map((el) => execute(el, bindings)));
  } else if ('sequence' in statement) {
    for (const el of statement.sequence.elements) {
      await execute(el, bindings);
    }
  } else {
    const activity = statement.activity;
    let args = activity.arguments || [];
    args = args.map((arg) => bindings[arg] ?? arg);
    const activityResult = await acts[activity.name](...args);
    if (activity.result) {
      bindings[activity.result] = activityResult;
    }
  }
}
