# Changelog

## Unreleased

### Added

- `StatefulWorkflow`: `children: { strict: true }` (opt-in; planned as the default in 3.0). Managed children then default
  to `workflowIdReusePolicy` REJECT_DUPLICATE, `parentClosePolicy` ABANDON and no retries, and a child cancelled from
  outside is not started again. A managed path's own settings still win.

### Changed

- `StatefulWorkflow`: the start `state` and `data` are queued in the constructor, before any signal or update handler is
  bound, so handlers that arrive with the start (signal-with-start, update-with-start) work on top of the start data
  instead of having it merged over their changes. Managed paths are configured on first need, and an `@Action` first
  applies queued changes, so it sees the start data.
- `StateManager.dispatch`: changes apply in the order they were dispatched; a sync dispatch no longer jumps ahead of
  changes already queued.
- `StatefulWorkflow`: when `execute()` leaves changes pending, the loop applies them in another pass at once instead of
  sleeping 2.5 s first. A state machine that writes one step per pass no longer waits about 8 s per task. After 100
  such passes in a row (`maxImmediatePasses`) the loop still sleeps once, so an `execute()` that writes on every pass
  yields instead of tripping Temporal's deadlock detector.

### Fixed

- `StatefulWorkflow`: the loop consumes a wake-up (`pendingIteration`) after it waits, not before. A state change made
  before the loop first waited (by a signal sent with the start) or while `execute()` ran was dropped, and the
  workflow slept with work pending.
- `Workflow` (continue-as-new loop): the same fix. The loop cleared `pendingIteration` before it waited and again after
  `execute()`, so a wake-up set by a signal while `execute()` ran was dropped. Setting `pendingIteration` inside
  `execute()` now also runs another pass, as documented.
- Entity proxies: a write through the proxy of an entity whose id contains dots (such as `install.role`) no longer
  throws `"undefined" is not valid JSON`. The `<entity>.<id>.` prefix is now removed as a whole before the rest of the
  mutation path is split, and a proxy only handles mutations under its own exact prefix.
- `StatefulWorkflow`: a managed path's `processData` runs with the workflow as `this`, like `condition` (it was called
  unbound).
- `StatefulWorkflow`: when a managed child's ID already exists (`WorkflowExecutionAlreadyStartedError`), the start is
  logged and skipped. It used to stop the whole state-change pass, so the other children of that change never started.

## 2.0.0

Strict by default, and runs on current Temporal SDKs. See [MIGRATION-2.0.md](./MIGRATION-2.0.md) for what to change.

### Breaking

- Temporal SDK `^1.27.0` as peer dependencies (`@temporalio/workflow`, `common`, `client`,
  `interceptors-opentelemetry`); Node.js `>=20.3.0`.
- `reflect-metadata` removed: decorator metadata is kept in a module-level `WeakMap`, because current SDK sandboxes
  freeze `Reflect` and the polyfill made every workflow fail to load.
- Workflows started on 1.x can fail replay on 2.0 workers: drain them or move to a new task queue (see the migration
  guide).
- `@Property()` is query-only by default; `set: true` (or a signal name) opts in, and `signalName` alone no longer
  creates a signal. The base class's control fields are no longer settable by signal. In `StatefulWorkflow`, `apiUrl`,
  `data`, `managedPaths`, `pendingUpdate` and `continueAsNew` are not settable by signal.
- `StatefulWorkflow.apiToken` is no longer a query or a memo value, the `params` query leaves it out, and a 1.x memo's
  `properties.apiToken` is dropped at continue-as-new.
- `pause`, `resume` and `cancel` signals need `@Temporal({ controlSignals: true })`; `subscribe` and `unsubscribe` need
  `@Temporal({ subscribeSignals: true })`.
- A `cancel` signal fails the run with a `CancelledFailure` instead of completing it.
- A `@Validator` that names no `@Action` fails the workflow at start-up (`InvalidValidator`).
- An `@Action`'s plain `Error` fails the Update as a non-retryable `ApplicationFailure`; `runAction` takes
  `(methodName, ...args)` and `bindActions` is on the base `Workflow`.
- Framework metadata can't be read with `Reflect.getMetadata`.
- `@Condition` fails with `ConditionTimeout` after its timeout; `@Conditional` no longer swallows errors; `@Guard`
  fails with `GuardFailed`.
- Any error in `setup` / `hooks` / `init` listeners fails the workflow (`WorkflowStartupError` for a plain `Error`).
- Queries no longer emit events.
- DSL: code statements need `allowDSLCode` / `allowCode`; only the own entries of the activity and step maps can run;
  a `wait` timeout fails (`DSLWaitTimeout`) and a throwing `when` / `wait` fails (`DSLConditionError`); nested
  failures keep their type; no `workflow` variable.

### Added

- `@Action` / `@Validator` as Workflow Updates on the base `Workflow`, with synchronous validators enforced and `name` /
  `unfinishedPolicy` options.
- `@Guard` is exported.
- `cancelChildren()` and `childCancellationTimeout`.

### Fixed

- A cancelled non-continueable workflow now closes as `CANCELLED` (1.x waited forever).
- A pause during a step-based workflow waits for `resume` instead of ending the run with steps skipped.
- A validator that returns a Promise rejects the Update instead of wedging the workflow until it times out.
- Child workflows are asked to cancel and awaited before the parent closes (1.x let the parent-close policy terminate
  them).
- `@Property({ set: 'name' })` uses the given signal name when `get` isn't a string.
- A subclass's `@Action`, `@Step`, `@Validator` and `@Hook` no longer modify its parent class's metadata.
- Continue-as-new uses `typedSearchAttributes`.
- Tests: `npm test` runs the unit suites, then each integration suite in its own process; merged workflow coverage is
  unwrapped. Before, a single run silently skipped the two integration suites and still exited 0.
- CI: the npm publish jobs never ran, because they read `needs.version-check` without depending on that job.

### Changed

- CI: tests also run on pull requests, on Node 22 and 24, after a build.
- Publishing is a manual run of the "Node.js Package" workflow on `main`, using npm trusted publishing (OIDC) instead
  of a stored token. It publishes only a version that has no tag yet, and only if the Test Suite passed for that exact
  commit on a push to `main`. A merge no longer tries to publish.
- Docs: updated for 2.0 (`@Property`, `@Action` / `@Validator`, `@Guard`, DSL code statements, `apiToken`); the
  StatefulWorkflow overview and introduction are rewritten. The package now includes `CHANGELOG.md` and
  `MIGRATION-2.0.md`.
