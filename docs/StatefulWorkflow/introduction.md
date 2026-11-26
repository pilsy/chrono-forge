[Table of Contents](./table_of_contents.md#table-of-contents) | [Next >](./getting_started.md)

---

### 1: Introduction to `StatefulWorkflow`

`StatefulWorkflow` is a TypeScript/Temporal base class for workflows that keep normalized state, auto-manage child workflows from that state, and propagate updates via signals. It gives you a consistent pattern for hierarchical workflows without hand-rolling store plumbing or signal fan-out logic.

#### What it is (at a glance)

- Built for Temporal Node/TypeScript (v1.x), meant to run inside a Temporal worker.
- Normalized store (`normalizr` + `SchemaManager`) with automatic persistence to workflow memo.
- Child lifecycle automation: start/update/cancel children based on `managedPaths`.
- Signal/query surface for updates, subscriptions, and configuration (API URL/token).
- Guards for ancestry/circular relationships to avoid redundant or looping workflows.

#### Minimal quickstart

```ts
// pseudo-code: your workflow extending StatefulWorkflow
export class ProjectWorkflow extends StatefulWorkflow<ProjectState> {
  managedPaths = ['projects[*].tasks[*]']; // drives child workflows

  @Action()
  async addTask(input: { taskId: string; projectId: string; title: string }) {
    // mutate normalized state; children spawn/update automatically
    this.update({ data: { id: input.taskId, title: input.title, projectId: input.projectId }, entityName: 'Task' });
  }
}
```

- Run with a Temporal worker as usual; use queries (`state`, `pendingChanges`, `subscriptions`) and signals (`update`, `delete`, `apiToken`) to interact. `subscribe` / `unsubscribe` are opt-in with `@Temporal({ subscribeSignals: true })`.
- See [Getting Started](./getting_started.md) for setup, imports, and a runnable example.

#### When to use

- You have hierarchical entities (e.g., org → project → task) and want child workflows to mirror state changes automatically.
- You need normalized state with predictable updates and memo persistence.
- You must propagate changes across related workflows via signals without bespoke routing.

#### When to skip

- Flat, short-lived workflows without child orchestration.
- Scenarios where memo size, fan-out, or signal volume must be strictly minimal and you do not need normalized state.

---
[Table of Contents](./table_of_contents.md#table-of-contents) | [Next >](./getting_started.md)
