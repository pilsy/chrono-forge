# Migrating to temporal-forge 2.0

2.0 makes the framework **strict by default**: nothing about a running workflow can be changed from outside unless the
workflow opts in, gates fail closed, and cancellation always finishes. It also runs on current Temporal SDKs. 1.9.x
does not: its `reflect-metadata` polyfill can't load in newer SDK sandboxes (see "Requirements").

Each section says what changed, why, and what to do. Start with "Upgrading running workflows": it decides how you roll
the upgrade out.

## Upgrading running workflows

**Changed:** 2.0 registers different handlers and runs different code at start-up and in its loops (for example no
property signals, opt-in control signals, a different cancel path). A workflow that **started on 1.x** and is replayed
by a 2.0 worker can take a different path from its recorded history and fail with a non-determinism error.

**Do one of these:**

- **Drain:** let every 1.x workflow finish (or continue-as-new) on 1.x workers, then deploy 2.0 workers.
- **New task queue:** run 2.0 workers on a new task queue and start new workflows there, while 1.x workers keep
  serving the old queue until it is empty.
- **Worker Versioning:** if you already use Temporal's Worker Versioning, deploy 2.0 as a new version and keep the old
  version pinned for running workflows.

Long-running `StatefulWorkflow`s that continue-as-new pick up the new code on their next run, but the run that is live
during the deploy is still a 1.x run: drain it or move it with the new-task-queue route.

## Requirements

- **Temporal TypeScript SDK 1.27 or newer**, as peer dependencies you install yourself: `@temporalio/workflow`,
  `@temporalio/common`, `@temporalio/client` and `@temporalio/interceptors-opentelemetry` (`^1.27.0`; keep all
  `@temporalio/*` packages on the same version, the OpenTelemetry interceptor requires it). 1.x listed them as normal
  dependencies at `^1.11.7`.
- **Node.js 20.3 or newer** (what the SDK requires). Node 20 is end-of-life; use 22 or 24.
- **`reflect-metadata` is gone.** Current SDK sandboxes freeze their globals, and the polyfill's attempt to add
  `Reflect.defineMetadata` makes every workflow fail while the bundle loads (`TypeError: Cannot define property
  decorate, object is not extensible`). Decorator metadata now lives in a module-level `WeakMap`. If your own code
  relied on temporal-forge importing `reflect-metadata` for you, import it yourself, outside workflow code.
- **Jest:** Temporal's worker loads part of itself with a dynamic `import()`, which Jest only allows with
  `node --experimental-vm-modules`.
- Removed unused dependencies: `openai`, `nanoid`, `graphology-operators`.

## `@Property` is read-only by default

**Changed:** `@Property()` creates a query but **no signal**. Before, every property could be overwritten by a signal of
the same name, by anyone able to signal the workflow. This includes the base class's own control fields: `status`,
`dsl`, `continueAsNew`, `pendingIteration`, `pendingUpdate`, `startDelay` and `conditionTimeout` are now queryable only.

**Do:** opt in where a signal should set the value:

```ts
@Property({ set: true })              // signal named after the property
protected label: string = 'initial';

@Property({ set: 'renameTo' })        // signal with its own name (1.x ignored this name unless `get` was a string)
protected name: string = 'initial';
```

To make an **inherited** field settable again, redeclare it and keep any value passed in the workflow's arguments
(field initializers run after the base constructor, so a plain `= 'running'` would discard a status carried across
continue-as-new):

```ts
@Property({ set: true })
protected status: string = (this as any).args?.status ?? 'running';
```

Better still, add an explicit `@Signal` for exactly the change you want to allow.

**`signalName` alone no longer creates a signal.** 1.x's `set` defaulted to `true`, so `@Property({ signalName: 'x' })`
made a signal named `x`. In 2.0 `set` defaults to `false` and `signalName` only names a signal you opt in to: write
`@Property({ set: true, signalName: 'x' })` or `@Property({ set: 'x' })`.

**StatefulWorkflow:** `apiUrl`, `data`, `managedPaths`, `pendingUpdate` and `continueAsNew` are no longer settable by
signal. `apiUrl` comes only from the start parameters or the workflow's `@Temporal` options (as for children in 1.x,
a parent does not pass its own down): a signal could point the workflow at another server while it kept sending the
real token. Use the documented `update` /
`delete` signals or an explicit `@Signal` instead of `signal('data', …)`.

## `apiToken` is no longer exposed

`StatefulWorkflow`'s `apiToken` is no longer a query and is no longer written to the workflow memo (both are readable by
anyone with read access to the namespace). The `params` query returns the start parameters **without** `apiToken`, in
parents and children alike. The token still reaches child workflows through their arguments and can still be rotated
with the `apiToken` signal.

**A 1.x memo can still hold the token.** 1.x wrote it to the memo as `properties.apiToken`. 2.0 never reads it back and
drops it from the memo it carries into continue-as-new, so it disappears at the workflow's next continue-as-new. Until
then it stays in the memo of the live run (and in closed 1.x runs' history). If that matters, rotate the token after the
upgrade.

## `@Action` works on every Workflow, and validators must be synchronous

**Changed:** `@Action` / `@Validator` are bound as Temporal **Workflow Updates** on the base `Workflow`, not only on
`StatefulWorkflow`. Actions and validators are collected along the class chain (a subclass's validator for a name wins),
and a subclass's decorators no longer leak into its parent class's metadata.

A validator runs before the Update is accepted. If it throws, the Update is rejected and nothing is written to the
workflow history: use this for checks such as "the plan hash matches" or "this approval hasn't been used".

**Validators must be synchronous.** Temporal ignores a validator's return value, so an `async` validator that rejects
would still accept the Update. 2.0 fails the workflow at start-up (`ApplicationFailure` type `InvalidValidator`) if a
validator is `async`, and rejects the Update (also `InvalidValidator`) if a validator returns a Promise; the workflow
keeps running.

**A validator must name an action.** A `@Validator('aprove')` next to an action named `approve` would otherwise be
ignored and the action would run unvalidated. 2.0 fails the workflow at start-up with `InvalidValidator`, naming the
validator and the actions that exist.

**An action's error fails the Update, not the workflow.** A plain `Error` thrown by an `@Action` becomes a non-retryable
`ApplicationFailure` (its type is the error's `name`, or `ActionError` for a plain `Error`), so the caller gets a failed
Update and the workflow keeps running. In 1.x it failed the workflow task: the caller hung, Temporal retried the task
and the workflow eventually timed out. `ApplicationFailure`s you throw yourself pass through unchanged.

**`runAction` and `bindActions` moved.** `bindActions()` is on the base `Workflow` now, and
`runAction(methodName, input)` became `runAction(methodName, ...args)`. If you override `runAction`, take the
arguments as a rest parameter and pass them all on.

New `@Action` options: `name` (the Update name; default the method name) and `unfinishedPolicy`. The base default is
Temporal's own (abandon with a warning); `StatefulWorkflow` keeps 1.x's silent `ABANDON`.

```ts
@Validator('approve')
protected validateApprove(a: { approvalId: string; planSha256: string }) {
  if (a.planSha256 !== this.args.planSha256) throw new Error('plan hash does not match');
}

@Action()
protected async approve(a: { approvalId: string; planSha256: string }) { /* … */ }
```

## Gates fail closed

| Decorator | 1.x | 2.0 |
|---|---|---|
| `@Condition(fn, timeout)` | called `fn` without `this`; after the timeout ran the method anyway | `fn` gets the workflow as `this`; a timeout fails with `ApplicationFailure` type `ConditionTimeout` |
| `@Conditional(fn)` | swallowed errors from both the condition and the method, returning `undefined` | a condition that throws fails (`ConditionalError`); the method's own errors propagate; a false condition still skips |
| `@Guard(fn)` | not exported; a failed check threw a plain `Error` (fails the workflow task and retries forever) | exported; a failed check throws `ApplicationFailure` type `GuardFailed`, which the caller can catch or which fails the workflow |

Write `@Condition` predicates as `function () { return this.ready; }`, not arrow functions at module scope.

## `pause`, `resume` and `cancel` signals are opt-in

**Changed:** 1.x registered `pause`, `resume` and `cancel` signals on every workflow, so anyone who could signal it could
stop it. 2.0 registers them only with `@Temporal({ controlSignals: true })`. Calling `this.pause()`, `this.resume()` or
`this.cancel()` from the workflow's own code works either way. Parents forward these signals to their children, so opt
the children in too if you rely on that.

**Fixed, for workflows that opt in:**

- A `pause` waits before the next step and carries on after `resume`. In 1.x a pause during a step-based (non
  continue-as-new) workflow ended the run as `COMPLETED` with the remaining steps skipped.
- A `cancel` signal stops before the next step or iteration, cancels the children and fails the run with a
  `CancelledFailure` ("Cancelled by the cancel signal"), so a caller never mistakes it for success. In 1.x a
  continue-as-new workflow ran once more and then completed normally. For a run that closes as `CANCELLED`, use
  Temporal's own cancel (`handle.cancel()`).

## `subscribe` and `unsubscribe` signals are opt-in (StatefulWorkflow)

Signals don't say who sent them, so anyone who could signal a `StatefulWorkflow` could make it send its state to any
workflow ID. 2.0 registers these signals only with `@Temporal({ subscribeSignals: true })`. Subscriptions passed in the
start parameters (how parents and children subscribe to each other) work either way.

## Cancellation always finishes

1.x only finished cancellation on the continue-as-new path: a cancelled plain workflow waited forever for a status
nothing set, and the "cancel the children" step built its calls without running them, so a parent closed before its
children and the parent-close policy **terminated** them. 2.0 asks every child to cancel, waits up to
`childCancellationTimeout` (30 seconds) for them to close, then closes as `CANCELLED`.

## Lifecycle errors fail the workflow; queries only read

- Any error in a listener for the start-up events (`setup`, `hooks`, `init`), for example a handler that can't be bound,
  now fails the workflow. A plain `Error` becomes a non-retryable `ApplicationFailure` (type `WorkflowStartupError`, or
  the error's own `name`); before this, only an `ApplicationFailure` failed the run and a plain `Error` left it
  `RUNNING` while Temporal retried the task. 1.x logged it with `console.error` and carried on half-configured. Other
  events still log.
- A query no longer emits an event with its name (1.x ran `@On(queryName)` listeners inside a query).

## DSL interpreter

- **Code statements are off.** `execute.code` compiles JavaScript from a string (`new Function`), so a plan from an
  untrusted source could run anything. Enable it per workflow with `@Temporal({ allowDSLCode: true })`, or pass
  `{ allowCode: true }` to `DSLInterpreter` directly. Otherwise a code node fails with `DSLCodeDisabled`.
- **Only the activities you hand in run.** 1.x fell back to `proxyActivities()` for any name, with the default retry
  policy (retries without limit). Pass an object naming them, for example
  `@Temporal({ activities: { makeHTTPRequest, formatData } })`. A `proxyActivities()` proxy answers to any name, so
  name the functions if you want an allow-list. An unknown activity or step fails with `DSLActivityNotFound` /
  `DSLStepNotFound` (non-retryable) instead of a plain `Error`.
- **A real allow-list.** Activities and steps are looked up by the map's **own** names only. 1.x used `map[name]`, so
  inherited names such as `constructor` or `hasOwnProperty` passed.
- **Gates fail closed.** A `wait: [fn, timeout]` that times out fails with `DSLWaitTimeout` (1.x ran the node anyway,
  the same bug `@Condition` had), and a `when` or `wait` function that throws fails with `DSLConditionError` (1.x
  skipped the node silently). A `when` that returns false still skips its node.
- **Nested failures keep their type.** Inside `foreach`, `while`, `doWhile` and nested sequences, a single failure is
  rethrown as it is, and several become one non-retryable failure carrying the first one's type. 1.x replaced them
  with a plain `Error`, so a nested `DSLCodeDisabled` or `DSLActivityNotFound` made Temporal retry the task forever.
- Plans no longer see the workflow instance as a `workflow` variable.

## Other changes

- **Framework metadata is private.** Decorator metadata no longer lives on `Reflect` (see "Requirements"), so
  `Reflect.getMetadata(...)` returns nothing for temporal-forge's keys. Use the decorators and the workflow's queries
  instead of reading the metadata directly.
- Continue-as-new carries `typedSearchAttributes` (the untyped `searchAttributes` is deprecated in the SDK).
- `bindProperties` uses a string `set` as the signal name whatever `get` is.

## Not changed yet

Still as in 1.x, planned for a later release: `StatefulWorkflow`'s child-workflow defaults (`ALLOW_DUPLICATE` id reuse,
`TERMINATE` parent-close policy, `maximumAttempts: 30`, auto-restart after an outside cancel), the `state` signal that
replaces the whole state, `update({ action })` dispatching a raw action, and the DSL's expression-free schema (`when`,
`wait` and loop conditions are still JavaScript functions, so a plan can't be sealed as JSON yet).

`StatefulWorkflow` also keeps some state at module level (`StateManager.instances`, the `SchemaManager` singleton and
`EntityProxyManager`'s cache). Temporal workers run many workflows in one reused V8 context by default, so one
workflow's cleanup can clear another's cache, and a replay can pick up stale state. Until this is scoped per workflow
run, set `reuseV8Context: false` in the `Worker.create` options of workers that run `StatefulWorkflow`.
