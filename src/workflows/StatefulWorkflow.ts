/* eslint-disable @typescript-eslint/ban-ts-comment */
import dottie, { get } from 'dottie';
import * as workflow from '@temporalio/workflow';
import {
  normalizeEntities,
  EntitiesState,
  updateNormalizedEntities,
  deleteNormalizedEntities,
  deleteEntities,
  updateEntity
} from '../utils/entities';
import { DetailedDiff } from 'deep-object-diff';
import { schema, Schema } from 'normalizr';
import { isEmpty, isEqual, unset } from 'lodash';
import { Workflow, ChronoFlowOptions } from './Workflow';
import {
  Signal,
  Query,
  Before,
  Property,
  ACTIONS_METADATA_KEY,
  VALIDATOR_METADATA_KEY,
  ActionOptions,
  On,
  After,
  Mutex,
  Debounce
} from '../decorators';
import { SchemaManager } from '../store/SchemaManager';
import { StateManager } from '../store/StateManager';
import { limitRecursion } from '../utils/limitRecursion';
import { getCompositeKey } from '../utils/getCompositeKey';
import { PROPERTY_METADATA_KEY } from '../decorators';
import { UpdateHandlerOptions, Handler } from '@temporalio/workflow/lib/interfaces';
import { HandlerUnfinishedPolicy } from '@temporalio/common';
import { flatten } from '../utils/flatten';
import { unflatten } from '../utils';

export type ManagedPath = {
  entityName?: string;
  path?: string;
  workflowType?: string;
  idAttribute?: string | string[];
  isMany?: boolean;
  includeParentId?: boolean;
  autoStart?: boolean;
  subscriptions?: {
    update?: boolean;
    deletion?: boolean;
  };
  cancellationType?: workflow.ChildWorkflowCancellationType;
  parentClosePolicy?: workflow.ParentClosePolicy;
  condition?: (entity: Record<string, any>, data: StatefulWorkflow['data']) => boolean;
  processData?: (entity: Record<string, any>, data: StatefulWorkflow['data']) => Record<string, any>;
};

export type ManagedPaths = {
  [path: string]: ManagedPath;
};

export type Subscription = {
  workflowId: string;
  signalName: string;
  selector: string;
  parent?: string;
  child?: string;
  ancestorWorkflowIds?: string[];
  condition?: (state: any) => boolean;
  entityName?: string;
  subscriptionId?: string;
};

export type Entities = {
  [entityName: string]: Schema;
};

export type StatefulWorkflowParams<D = {}> = {
  id: string;
  entityName: string;
  data?: D;
  state?: EntitiesState;
  status: string;
  apiUrl?: string;
  apiToken?: string;
  subscriptions?: Subscription[];
  autoStart?: boolean;
  ancestorWorkflowIds?: string[];
};

export type StatefulWorkflowOptions = {
  schema?: schema.Entity;
  schemaName?: string;
  autoStart?: boolean;
  apiUrl?: string;
  workflowType?: string;
};

export type PendingChange = {
  updates?: Record<string, any>;
  deletions?: Record<string, any>;
  entityName: string;
  strategy?: '$set' | '$merge';
  changeOrigin?: string;
  sync?: boolean;
};

export interface ActionMetadata {
  method: keyof StatefulWorkflow<any, any>;
  options?: ActionOptions<any, any>;
}

export type AncestorHandleEntry = {
  entityId: string;
  entityName: string;
  isParent: boolean;
  handle: workflow.ExternalWorkflowHandle;
};

export abstract class StatefulWorkflow<
  P extends StatefulWorkflowParams = StatefulWorkflowParams,
  O extends StatefulWorkflowOptions = StatefulWorkflowOptions
> extends Workflow<P, O> {
  private _actionsBound: boolean = false;
  private _memoProperties: Record<string, any> = {};
  protected actionRunning: boolean = false;
  protected continueAsNew: boolean = true;
  protected stateManager!: StateManager;
  protected schemaManager = SchemaManager.getInstance();
  protected iteration = 0;
  protected schema: Schema;

  /**
   * Determines whether data should be loaded in the workflow based on internal state.
   *
   * This method checks if the `loadData` function exists and if there is a pending update.
   * It is essential to ensure data is only loaded when necessary, avoiding unnecessary calls
   * or updates.
   *
   * @returns {boolean}
   * - `true` if the workflow has a `loadData` method and a pending update, meaning data
   *   needs to be refreshed.
   * - `false` otherwise, indicating that no data needs to be loaded.
   */
  protected shouldLoadData(): boolean {
    return typeof (this as any)?.loadData === 'function' && this.pendingUpdate;
  }

  /**
   * Abstract method that represents the core logic to be executed by the workflow.
   *
   * This method must be implemented by any subclass extending `StatefulWorkflow`. It is the
   * central piece where the workflow's specific operations and tasks are defined.
   *
   * Implementations of this method will define how the workflow should behave in its execution
   * cycle. This is typically where the main business logic resides.
   *
   * @param args - Optional arguments that may be passed to the workflow.
   * @param options - Additional execution options that may affect the workflow behavior.
   * @returns {Promise<unknown>}
   * - A promise that resolves with the result of the workflow's execution. The return value
   *   may vary depending on the specific workflow implementation.
   */
  protected abstract execute(args?: unknown, options?: ChronoFlowOptions): Promise<unknown>;

  @Property({ set: false })
  protected apiToken?: string;

  /**
   * Signal to set or update the API token for the workflow.
   *
   * This signal allows external systems or child workflows to update the API token used by
   * this workflow. Once the token is set, it marks the workflow's state as needing an update
   * (`pendingUpdate`), and forwards the token update signal to child workflows.
   *
   * @param {string} apiToken - The new API token to be used by the workflow. If the new token
   *   differs from the current token, the workflow will trigger a pending update and propagate
   *   the token to its child workflows.
   * @returns {void}
   */
  @Signal('apiToken')
  public setApiToken(apiToken: string): void {
    this.log.trace(`[${this.constructor.name}]:${this.entityName}:${this.id}.setApiToken`);
    if (apiToken && this.apiToken !== apiToken) {
      this.log.info(`Updating apiToken...`);
      this.apiToken = apiToken;
      this.pendingUpdate = true;
      this.forwardSignalToChildren('apiToken', apiToken);
    }
  }

  @Property({ set: false })
  protected id: string;

  @Property({ set: false })
  protected entityName: string;

  /**
   * Getter and setter for the workflow's internal state.
   *
   * The `state` property represents the current state of the workflow's entities,
   * managed by the `schemaManager`. This property can be used to retrieve or update
   * the entire state of the workflow.
   *
   * When the state is updated, it is directly set in the schema manager, ensuring
   * that all entity-related operations reflect the latest state.
   *
   * @returns {EntitiesState}
   * - The current state of all entities in the workflow.
   */
  @Property()
  get state() {
    return this.stateManager.state;
  }

  set state(state: EntitiesState) {
    this.stateManager.state = state;
  }

  /**
   * Retrieves the workflow's entity-specific data from the schema manager.
   *
   * This getter dynamically fetches the data associated with the specific entity (`entityName`)
   * and `id` of the workflow from the `SchemaManager`. The retrieved data is wrapped in a
   * proxy that allows for real-time updates. Any mutations to the data trigger state changes
   * and are automatically dispatched via the `SchemaManager`.
   *
   * The getter handles the complexity of normalized data, ensuring that the denormalization
   * process respects the relationships defined in the schema.
   *
   * @returns {P['data']}
   * - The current data for the entity, denormalized and proxied for real-time updates.
   */
  @Property()
  protected get data(): P['data'] {
    return this.stateManager.query(this.entityName, this.id);
  }

  /**
   * Getter and setter for the workflow's entity-specific data, managed by the SchemaManager.
   *
   * **Getter**: This retrieves the workflow's data associated with the entity (`entityName`)
   * and `id`. The data is automatically **denormalized** using the entity schema, so it
   * includes any relational data. The getter returns a **proxied** version of the data,
   * allowing the workflow to react to any changes made to the data.
   *
   * The Proxy intercepts interactions with the data. If you modify the data, the proxy
   * triggers an update to the workflow's state, and the SchemaManager normalizes the new data.
   *
   * **Setter**: This updates the workflow's data by dispatching a state update via the
   * SchemaManager. When new data is set, it is **normalized** according to the entity schema,
   * then saved to the workflow's internal state.
   *
   * The setter works asynchronously, as the update is dispatched through the workflow's
   * event-driven state management, ensuring that changes are synchronized with child
   * workflows and other parts of the system.
   *
   * ### Example Usage:
   * Suppose you have a `BookWorkflow` managing a `Book` entity with multiple `Chapters`:
   *
   * ```typescript
   * @Workflow({
   *    schema: schemas.Book,
   *    schemaName: 'Book',
   *    autoStart: true
   * })
   * export class BookWorkflow extends StatefulWorkflow<
   *    StatefulWorkflowParams<BookModel>,
   *    StatefulWorkflowOptions
   * > {
   *    @Property({ path: 'chapters' })
   *    protected chapters!: ChapterModel[];
   *
   *    @Action<AddChapterAction, BookModel>()
   *    protected async addChapter(action: AddChapterAction): Promise<BookModel> {
   *        // Access current data through the getter
   *        if (!this.data) {
   *            throw new Error('No book data available yet');
   *        }
   *        // Add a new chapter to the book
   *        const newChapter = action.payload.chapter;
   *        this.chapters.push(newChapter);
   *        return this.data; // Return the updated book data
   *    }
   * }
   * ```
   *
   * In the above example:
   * - The `data` getter is used to fetch the current state of the `Book` entity, which includes its `Chapters`.
   * - The Proxy automatically tracks changes to the `chapters` array. When a new chapter is added, the workflow updates its state and triggers the necessary state changes.
   *
   * **Real-Time Updates with Proxy**:
   * The data is wrapped in a Proxy, so any modification to the `Book` or its `Chapters` will automatically trigger an update. For example, if you modify a specific chapter:
   *
   * ```typescript
   * // Update the title of a specific chapter
   * this.chapters[0].title = 'New Chapter Title';
   * ```
   *
   * This change will be automatically detected, and the Proxy will trigger an update, saving the new title and ensuring that the state remains synchronized.
   *
   * **SchemaManager's Role**:
   * The `SchemaManager` normalizes the data when setting it and denormalizes it when retrieving it. The Proxy ensures real-time synchronization between the denormalized data and the internal state.
   *
   * @returns {P['data']}
   * - The denormalized data for the entity, proxied for real-time updates.
   */
  protected set data(data: any) {
    this.update({ data, entityName: this.entityName, changeOrigin: workflow.workflowInfo().workflowId });
  }

  @Property()
  protected pendingUpdate: boolean = true;

  @Query('pendingChanges')
  get pendingChanges() {
    return this.stateManager.queue;
  }

  @Property({ set: false })
  protected subscriptions: Subscription[] = [];

  protected subscriptionHandles: { [workflowId: string]: workflow.ExternalWorkflowHandle } = {};

  /**
   * Defines paths within the workflow's state that are automatically managed, often
   * involving child workflows or nested entities. This allows workflows to handle
   * complex, hierarchical data structures with ease.
   *
   * **managedPaths** is a mapping of entity properties to configurations that control
   * how these properties (and their related entities) are managed by the parent workflow.
   * Each path in `managedPaths` defines how the workflow should interact with a nested
   * entity or set of entities, including:
   *
   * - Automatically starting child workflows for these entities.
   * - Handling the relationships between parent and child workflows.
   * - Synchronizing state between the parent workflow and child workflows.
   *
   * ### Key Configuration Options:
   *
   * - **`entityName`**: The name of the entity managed at this path. This corresponds to the entity name
   *   as defined in the schema.
   *
   * - **`path`**: The key in the parent entity where the nested entity (or entities) are located.
   *   For example, in a `Book` entity, the path could be `'chapters'`, representing a list of `Chapter` entities.
   *
   * - **`workflowType`**: The type of the child workflow to start for the nested entities. This could be
   *   a `ChapterWorkflow` for chapters in a book or a `TaskWorkflow` for tasks in a project.
   *
   * - **`idAttribute`**: The unique identifier or combination of attributes that uniquely identify the
   *   nested entities. This can be a single field (e.g., `'id'`) or an array of fields for composite keys
   *   (e.g., `['projectId', 'taskId']`).
   *
   * - **`isMany`**: Indicates whether the path contains multiple entities (e.g., an array of chapters
   *   in a book). If `true`, the workflow will manage multiple entities at this path.
   *
   * - **`includeParentId`**: If `true`, the parent entity's ID is included in the child workflow's ID.
   *   This is useful when child workflows need to track their parent entity (e.g., a chapter must know
   *   which book it belongs to).
   *
   * - **`autoStart`**: Automatically starts child workflows for the entities at this path.
   *   When `true`, each entity in the path will have its corresponding child workflow started automatically.
   *
   * - **`cancellationType`**: Defines the cancellation policy for the child workflows. For example, this
   *   can ensure that child workflows are canceled if the parent workflow is canceled or errors out.
   *
   * - **`parentClosePolicy`**: Determines how the child workflows should behave when the parent workflow
   *   closes. For instance, child workflows can be canceled when the parent is done, or they can continue
   *   running independently.
   *
   * - **`condition`**: A function that specifies whether a child workflow should be started for a particular
   *   entity based on its data. This provides fine-grained control over when child workflows are started.
   *
   * - **`processData`**: A function that processes the entity's data before starting the child workflow.
   *   This is useful when additional data needs to be passed to the child workflow, such as including
   *   the parent entity's information.
   *
   * ### Example Usage:
   * Suppose you have a `ProjectWorkflow` that manages a `Project` entity with nested `Task` entities:
   *
   * ```typescript
   * @Workflow({
   *   schema: schemas.Project,
   *   schemaName: 'Project',
   *   autoStart: true
   * })
   * export class ProjectWorkflow extends StatefulWorkflow<
   *   StatefulWorkflowParams<ProjectModel>,
   *   StatefulWorkflowOptions
   * > {
   *   protected managedPaths: ManagedPaths = {
   *     tasks: {
   *       idAttribute: 'id',
   *       entityName: 'Task',
   *       workflowType: 'TaskWorkflow',
   *       autoStart: true,
   *       includeParentId: true,
   *       processData: (task, project) => {
   *         task.projectId = project.id;  // Attach the project ID to the task
   *         return task;
   *       }
   *     }
   *   };
   * }
   * ```
   *
   * In the example above:
   *
   * - **`tasks`**: The `tasks` path defines how the `Task` entities within a `Project` are managed.
   *   Each task is treated as a separate entity, and a `TaskWorkflow` is automatically started for each.
   *
   * - **`idAttribute: 'id'`**: The unique identifier for each task is the `id` field.
   *
   * - **`autoStart: true`**: Child workflows for tasks are automatically started when the project
   *   workflow is executed.
   *
   * - **`includeParentId: true`**: The `TaskWorkflow` will receive the `projectId` to keep track of which
   *   project each task belongs to.
   *
   * - **`processData`**: Before starting the `TaskWorkflow`, the `processData` function attaches the
   *   project ID to each task.
   *
   * ### Custom Child Workflow Conditions:
   * In some cases, you may only want to start child workflows based on certain conditions. This can be
   * controlled using the `condition` option.
   *
   * For example, you might only want to start a `TaskWorkflow` if the task is marked as "important":
   *
   * ```typescript
   * protected managedPaths: ManagedPaths = {
   *   tasks: {
   *     idAttribute: 'id',
   *     entityName: 'Task',
   *     workflowType: 'TaskWorkflow',
   *     autoStart: true,
   *     condition: (task, project) => task.isImportant
   *   }
   * };
   * ```
   *
   * In this case, only tasks with `isImportant: true` will have their corresponding `TaskWorkflow` started.
   *
   * ### Child Workflow Cancellation and Close Policies:
   * The `cancellationType` and `parentClosePolicy` settings define how child workflows are managed when the
   * parent workflow is canceled or closed. For example:
   *
   * ```typescript
   * protected managedPaths: ManagedPaths = {
   *   tasks: {
   *     idAttribute: 'id',
   *     entityName: 'Task',
   *     workflowType: 'TaskWorkflow',
   *     autoStart: true,
   *     cancellationType: workflow.ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
   *     parentClosePolicy: workflow.ParentClosePolicy.PARENT_CLOSE_POLICY_REQUEST_CANCEL
   *   }
   * };
   * ```
   *
   * In this configuration:
   *
   * - **`cancellationType: WAIT_CANCELLATION_COMPLETED`**: The parent workflow waits for the child workflows
   *   to complete before canceling them.
   *
   * - **`parentClosePolicy: REQUEST_CANCEL`**: When the parent workflow finishes, it requests the cancellation
   *   of its child workflows.
   *
   * ### ManagedPaths Summary:
   * - `managedPaths` is essential for handling nested entities in workflows.
   * - It automates the creation and management of child workflows.
   * - It provides flexibility in defining how and when child workflows are started, as well as how their
   *   lifecycle is controlled.
   *
   * @type {ManagedPaths}
   */
  @Property({ set: false })
  protected managedPaths: ManagedPaths = {};

  @Property()
  protected apiUrl?: string;

  @Property()
  protected ancestorWorkflowIds: string[] = [];

  @Property({ set: false })
  protected params: P;

  @Property({ set: false })
  protected options: O;

  protected ancestorHandles: { [key: string]: AncestorHandleEntry } = {};

  constructor(params: P, options: O) {
    super(params, options);

    this.params = params;
    this.options = options;

    this.stateManager = StateManager.getInstance(workflow.workflowInfo().workflowId);

    if (this.params?.ancestorWorkflowIds) {
      this.ancestorWorkflowIds = this.params.ancestorWorkflowIds;
    }

    if (this.ancestorWorkflowIds) {
      for (const workflowId of this.ancestorWorkflowIds) {
        const [entityName, entityId] = workflowId.split('-');
        this.ancestorHandles[workflowId] = {
          entityId,
          entityName,
          handle: workflow.getExternalWorkflowHandle(workflowId),
          isParent: workflow.workflowInfo().parent?.workflowId === workflowId
        };
      }
    }

    this.id = this.params?.id;
    this.entityName = (this.params?.entityName || options?.schemaName) as string;
    this.schema = this.entityName
      ? (this.schemaManager.getSchema(this.entityName) as schema.Entity)
      : (options.schema as schema.Entity);

    if (this.params?.subscriptions) {
      for (const subscription of this.params.subscriptions) {
        this.subscribe(subscription);
      }
    }

    this.stateManager.on('stateChange', this.stateChanged.bind(this));
    this.pendingUpdate = true;
    this.pendingIteration = true;

    const memo = unflatten(workflow.workflowInfo()?.memo ?? {}) as {
      state?: EntitiesState;
      iteration?: number;
      status?: string;
      properties: Record<string, any>;
    };

    if (!isEmpty(memo?.properties ?? {})) {
      this._memoProperties = memo.properties;
    }

    if (memo?.state && !isEmpty(memo.state)) {
      this.stateManager.state = memo.state;
    }

    if (this.params?.state && !isEmpty(this.params?.state)) {
      this.stateManager.dispatch(
        updateNormalizedEntities(this.params.state, '$set'),
        false,
        workflow.workflowInfo().workflowId
      );
    }

    if (this.params?.data && !isEmpty(this.params?.data)) {
      this.stateManager.dispatch(updateEntity(this.params.data, this.entityName), false);
    }

    this.status = this.params?.status ?? 'running';

    this.apiUrl = this.params?.apiUrl || options?.apiUrl;
    this.apiToken = this.params?.apiToken;
  }

  @Mutex('executeWorkflow')
  protected async executeWorkflow(): Promise<any> {
    this.log.debug(`[${this.constructor.name}]:${this.entityName}:${this.id}.executeWorkflow`);

    return new Promise(async (resolve, reject) => {
      try {
        if (this.schema) this.configureManagedPaths(this.schema);
        while (this.iteration <= this.maxIterations) {
          this.log.debug(`[${this.constructor.name}]:${this.entityName}:${this.id}:execute`);

          await workflow.condition(
            () =>
              (typeof (this as any).condition === 'function' && (this as any).condition()) ||
              this.pendingIteration ||
              this.pendingUpdate ||
              !!this.pendingChanges.length ||
              this.status !== 'running',
            this.conditionTimeout
          );

          if (this.status === 'paused') {
            await this.emitAsync('paused');
            await this.forwardSignalToChildren('pause');
            await workflow.condition(() => this.status !== 'paused' || this.isInTerminalState());
          }

          if (this.status === 'cancelled') {
            break;
          }

          if (this.shouldLoadData()) {
            await this.loadDataAndEnqueue();
          }

          if (!this.isInTerminalState()) {
            this.result = await this.execute();
          }

          if (this.isInTerminalState()) {
            return this.status !== 'errored' ? resolve(this.result || this.data) : reject(this.result);
          }

          if (
            ++this.iteration >= this.maxIterations ||
            (workflow.workflowInfo().continueAsNewSuggested && workflow.workflowInfo().historySize >= 41943040) ||
            this.shouldContinueAsNew
          ) {
            await this.handleMaxIterations();
            break;
          }

          if (!this.actionRunning) {
            if (this.pendingUpdate) {
              this.pendingUpdate = false;
            }

            if (this.pendingIteration) {
              this.pendingIteration = false;
            }
          }
        }

        resolve(this.result ?? this.data);
      } catch (err) {
        await this.handleExecutionError(err, reject);
      }
    });
  }

  @Signal()
  public update({
    data,
    updates,
    entityName,
    strategy = '$merge',
    changeOrigin,
    sync = true
  }: PendingChange & { data?: Record<string, any> }): void {
    this.log.trace(
      `[${this.constructor.name}]:${this.entityName}:${this.id}.update(${JSON.stringify({ data, updates, entityName, changeOrigin }, null, 2)})`
    );

    if (data !== null && !isEmpty(data)) {
      updates = normalizeEntities(
        data,
        entityName === this.entityName ? this.schema : SchemaManager.getInstance().getSchema(entityName)
      );
    }
    if (updates) {
      this.stateManager.dispatch(updateNormalizedEntities(updates, strategy), sync, changeOrigin);
    } else {
      this.log.error(`Invalid Update: ${JSON.stringify(data, null, 2)}, \n${JSON.stringify(updates, null, 2)}`);
    }
  }

  @Signal()
  public delete({
    data,
    deletions,
    entityName,
    changeOrigin,
    sync = true
  }: PendingChange & { data?: Record<string, any> }): void {
    this.log.trace(`[${this.constructor.name}]:${this.entityName}:${this.id}.delete`);
    if (!isEmpty(data)) {
      deletions = normalizeEntities(
        data,
        entityName === this.entityName ? this.schema : SchemaManager.getInstance().getSchema(entityName)
      );
    }
    if (deletions) {
      this.stateManager.dispatch(deleteNormalizedEntities(deletions), sync, changeOrigin);
    } else {
      this.log.error(`Invalid Delete: ${JSON.stringify(data, null, 2)}, \n${JSON.stringify(deletions, null, 2)}`);
    }
  }

  @Signal()
  public async subscribe(subscription: Subscription): Promise<void> {
    this.log.trace(`[${this.constructor.name}]:${this.entityName}:${this.id}.subscribe`);

    const { workflowId, subscriptionId } = subscription;
    if (!this.subscriptions.find((sub) => sub.workflowId === workflowId && sub.subscriptionId === subscriptionId)) {
      this.subscriptions.push(subscription);
      this.subscriptionHandles[workflowId] = await workflow.getExternalWorkflowHandle(workflowId);
    }
  }

  @Signal()
  public async unsubscribe(subscription: Subscription): Promise<void> {
    this.log.trace(`[${this.constructor.name}]:${this.entityName}:${this.id}.unsubscribe`);

    const { workflowId, subscriptionId } = subscription;
    const index = this.subscriptions.findIndex(
      (sub) => sub.workflowId === workflowId && sub.subscriptionId === subscriptionId
    );
    if (index !== -1) {
      delete this.subscriptionHandles[workflowId];
      this.subscriptions.splice(index, 1);
    }
  }

  private async cancelChildWorkflow(handle: workflow.ChildWorkflowHandle<any>) {
    this.log.trace(
      `[${this.constructor.name}]:${this.entityName}:${this.id}: Successfully Unsubscribing from workflow handle: ${handle.workflowId}`
    );
    try {
      if (handle) {
        this.log.info(`[${this.constructor.name}]:${this.entityName}:${this.id}: Cancelling child workflow...`);
        const extHandle = workflow.getExternalWorkflowHandle(handle.workflowId);
        await extHandle.cancel();
      }
    } catch (error: any) {
      this.log.error(
        `[${this.constructor.name}]:${this.entityName}:${this.id}: Failed to cancel from workflow handle: ${(error as Error).message}`
      );
    }
  }

  @Before('execute')
  protected async processState(): Promise<void> {
    if (this.actionRunning) {
      this.log.info(
        `[${this.constructor.name}]:${this.entityName}:${this.id}: Action is running, waiting for all changes to be made before processing...`
      );
      await workflow.condition(() => !this.actionRunning);
    }

    this.log.debug(`[${this.constructor.name}]:${this.entityName}:${this.id}.processState`);
    if (this.pendingChanges.length) {
      await this.stateManager.processChanges();
    }
  }

  protected async stateChanged({
    newState,
    previousState,
    differences,
    changeOrigins
  }: {
    newState: EntitiesState;
    previousState: EntitiesState;
    differences: DetailedDiff;
    changeOrigins: string[];
  }): Promise<void> {
    this.log.debug(`[${this.constructor.name}]:${this.entityName}:${this.id}.stateChanged`);

    if (!isEmpty(differences.added) || !isEmpty(differences.updated) || !isEmpty(differences.deleted)) {
      const created = get(differences.added, `${this.entityName}.${this.id}`, false);
      const updated = get(differences.updated, `${this.entityName}.${this.id}`, false);
      const deleted = get(differences.deleted, `${this.entityName}.${this.id}`, false);

      if (created) {
        await this.emit('created', created, newState, previousState, changeOrigins);
      } else if (updated) {
        await this.emit('updated', updated, newState, previousState, changeOrigins);
      } else if (deleted && this.isItemDeleted(differences, this.entityName, this.id)) {
        if (!(await this.emit('deleted', deleted, newState, previousState, changeOrigins))) {
          this.status = 'cancelled';
        }
      }

      await this.processChildState(newState, differences, previousState || {}, changeOrigins);
      if (this.iteration !== 0) {
        await this.processSubscriptions(newState, differences, previousState || {}, changeOrigins);
      }

      this.pendingIteration = true;
    }
  }

  @Mutex('memo')
  @After('processState')
  protected async upsertStateToMemo(): Promise<void> {
    this.log.info(`[StatefulWorkflow]: Saving state to memo: ${workflow.workflowInfo().workflowId}`);

    const memo = (workflow.workflowInfo().memo || {}) as {
      state?: EntitiesState;
      iteration?: number;
      status?: string;
      properties: Record<string, any>;
    };

    const flattenedNewState = flatten({ state: this.state, properties: this._memoProperties });
    const flattenedCurrentState: any = memo || {};

    const updatedMemo: Record<string, any> = {};
    let hasChanges = false;

    for (const [key, newValue] of Object.entries(flattenedNewState)) {
      const currentValue = flattenedCurrentState[key];
      if (!isEqual(newValue, currentValue)) {
        updatedMemo[key] = newValue;
        hasChanges = true;
      }
    }

    for (const key of Object.keys(flattenedCurrentState)) {
      if (!(key in flattenedNewState)) {
        updatedMemo[key] = undefined;
      }
    }

    if (hasChanges) {
      workflow.upsertMemo({
        ...updatedMemo,
        iteration: this.iteration,
        status: this.status,
        lastUpdated: new Date().toISOString()
      });
    }
  }

  protected async processSubscriptions(
    newState: EntitiesState,
    differences: DetailedDiff,
    previousState: EntitiesState,
    changeOrigins: string[]
  ): Promise<void> {
    this.log.trace(`[${this.constructor.name}]:${this.entityName}:${this.id}.processSubscriptions`);

    for (const subscription of this.subscriptions) {
      const { workflowId, selector, condition, entityName, subscriptionId } = subscription;

      const shouldPropagate = this.shouldPropagate(
        newState,
        differences,
        selector,
        condition,
        changeOrigins,
        this.ancestorWorkflowIds
      );
      if (!shouldPropagate) {
        continue;
      }

      const { updates, deletions } = this.extractChangesForSelector(differences, selector, newState, previousState);

      const handle = this.subscriptionHandles[workflowId];
      if (handle) {
        try {
          if (!isEmpty(updates)) {
            this.log.trace(
              `[${this.constructor.name}]:${this.entityName}:${this.id}.Sending update to workflow: ${workflowId}, Subscription ID: ${subscriptionId}`
            );

            await handle.signal('update', {
              updates,
              entityName,
              changeOrigin: workflow.workflowInfo().workflowId,
              subscriptionId,
              sync: true
            });
          }

          if (!isEmpty(deletions)) {
            this.log.trace(
              `[${this.constructor.name}]:${this.entityName}:${this.id}.Sending delete to workflow: ${workflowId}, Subscription ID: ${subscriptionId}`
            );

            await handle.signal('delete', {
              deletions,
              entityName,
              changeOrigin: workflow.workflowInfo().workflowId,
              subscriptionId,
              sync: true
            });
          }
        } catch (err) {
          this.log.error(`Failed to signal workflow '${workflowId}': ${(err as Error).message}`);
        }
      }
    }
  }

  /**
   * Determines whether the changes should be propagated to the subscription.
   * @param newState - The new state after changes.
   * @param differences - The DetailedDiff object containing changes.
   * @param selector - The selector string to match changes against.
   * @param condition - An optional condition function to further filter updates.
   * @param changeOrigins - Origins of the changes.
   * @param ancestorWorkflowIds - Ancestor workflow IDs to prevent circular dependencies.
   * @returns True if the changes should be propagated, false otherwise.
   */
  private shouldPropagate(
    newState: EntitiesState,
    differences: DetailedDiff,
    selector: string,
    condition?: (state: any) => boolean,
    changeOrigins?: string[],
    ancestorWorkflowIds: string[] = []
  ): boolean {
    this.log.debug(`[StatefulWorkflow]: Checking if we should propagate update for selector: ${selector}`);

    if (changeOrigins) {
      for (const origin of changeOrigins) {
        if (origin && ancestorWorkflowIds.includes(origin)) {
          this.log.debug(
            `Skipping propagation for selector ${selector} because the change originated from an ancestor workflow (${origin}).`
          );
          return false;
        }
      }
    }

    const selectorRegex = new RegExp('^' + selector.replace(/\\./g, '\\.').replace(/\*/g, '.*') + '$');
    for (const diffType of ['added', 'updated'] as const) {
      const entities = differences[diffType] as EntitiesState;
      if (!entities) continue;

      for (const [entityName, entityChanges] of Object.entries(entities)) {
        for (const [entityId, entityData] of Object.entries(entityChanges)) {
          for (const key in entityData) {
            if (Object.prototype.hasOwnProperty.call(entityData, key)) {
              const path = `${entityName}.${entityId}.${key}`;

              if (selectorRegex.test(path)) {
                const selectedData = get(newState, path);

                if (condition && !condition(selectedData)) {
                  this.log.debug(`Custom condition for selector ${selector} not met.`);
                  continue;
                }

                this.log.debug(`Differences detected that match selector ${selector}, propagation allowed.`);
                return true;
              } else {
                // Check if the selector is a parent path of the current path
                const selectorParts = selector.split('.');
                const keyParts = path.split('.');
                let isParent = true;

                for (let i = 0; i < selectorParts.length; i++) {
                  if (selectorParts[i] === '*') {
                    continue;
                  }
                  if (selectorParts[i] !== keyParts[i]) {
                    isParent = false;
                    break;
                  }
                }

                if (isParent) {
                  const parentKey = selector.split('.').slice(-1)[0];
                  const selectedData = get(newState, `${entityName}.${entityId}.${parentKey}`);

                  if (condition && !condition(selectedData)) {
                    this.log.debug(`Custom condition for selector ${selector} not met.`);
                    continue;
                  }

                  this.log.debug(`Differences detected within selector ${selector}, propagation allowed.`);
                  return true;
                }
              }
            }
          }
        }
      }
    }

    this.log.debug(
      `No matching differences found, conditions not met, or ancestry conflicts for selector: ${selector}`
    );
    return false;
  }

  /**
   * Extracts only the changed entities that match the given selector.
   * @param differences - The DetailedDiff object containing changes.
   * @param selector - The selector string to match changes against.
   * @param newState - The new state after changes.
   * @returns A subset of EntitiesState containing only the relevant changes.
   */
  private extractChangesForSelector(
    differences: DetailedDiff,
    selector: string,
    newState: EntitiesState,
    previousState: EntitiesState
  ): { updates: EntitiesState; deletions: EntitiesState } {
    const updates: EntitiesState = {};
    const deletions: EntitiesState = {};

    const selectorRegex = new RegExp('^' + selector.replace(/\*/g, '.*') + '$');

    for (const diffType of ['added', 'updated', 'deleted'] as const) {
      const entities = differences[diffType] as EntitiesState;
      if (!entities) continue;

      for (const [entityName, entityChanges] of Object.entries(entities)) {
        for (const entityId in entityChanges) {
          const entityPath = `${entityName}.${entityId}`;

          if (diffType === 'deleted') {
            if (!get(newState, entityPath) && selectorRegex.test(entityPath)) {
              if (!deletions[entityName]) {
                deletions[entityName] = {};
              }
              deletions[entityName][entityId] = get(previousState, entityPath); // Get snapshot from previous state
            }
          } else {
            const entityData = entityChanges[entityId];
            for (const key in entityData) {
              if (Object.prototype.hasOwnProperty.call(entityData, key)) {
                const path = `${entityPath}.${key}`;
                if (selectorRegex.test(path)) {
                  if (!updates[entityName]) {
                    updates[entityName] = {};
                  }
                  if (!updates[entityName][entityId]) {
                    updates[entityName][entityId] = {};
                  }
                  updates[entityName][entityId][key] = get(newState, path);
                }
              }
            }
          }
        }
      }
    }

    return { updates, deletions };
  }

  protected async processChildState(
    newState: EntitiesState,
    differences: DetailedDiff,
    previousState: EntitiesState,
    changeOrigins: string[]
  ): Promise<void> {
    this.log.trace(`[${this.constructor.name}]:${this.entityName}:${this.id}.processChildState`);

    const newData = limitRecursion(this.id, this.entityName, newState);
    const oldData = limitRecursion(this.id, this.entityName, previousState);

    for (const [path, config] of Object.entries(this.managedPaths)) {
      const currentValue = get(newData, config.path as string);
      const previousValue = get(oldData, config.path as string);

      if (Array.isArray(currentValue)) {
        await this.processArrayItems(newState, currentValue, config, differences, previousState, changeOrigins);
      } else if (currentValue) {
        await this.processItem(newState, currentValue, config, differences, previousState, changeOrigins, path);
      }

      await this.processDeletions(previousValue, differences, config);
    }
  }

  private async processItem(
    newState: EntitiesState,
    itemValue: any,
    config: ManagedPath,
    differences: DetailedDiff,
    previousState: EntitiesState,
    changeOrigins: string[],
    path: string
  ): Promise<void> {
    const compositeId = Array.isArray(config.idAttribute)
      ? getCompositeKey(itemValue, config.idAttribute)
      : itemValue[config.idAttribute as string];

    await this.processSingleItem(newState, compositeId, config, differences, previousState, changeOrigins);
  }

  private async processDeletions(previousValue: any, differences: DetailedDiff, config: ManagedPath): Promise<void> {
    if (Array.isArray(previousValue)) {
      for (const item of previousValue) {
        const compositeId = Array.isArray(config.idAttribute)
          ? getCompositeKey(item, config.idAttribute)
          : item[config.idAttribute as string];

        if (this.isItemDeleted(differences, String(config.entityName), compositeId)) {
          this.log.debug(`Processing deleted item in ${config.entityName}`);
          await this.handleDeletion(config, compositeId);
        }
      }
    } else if (previousValue) {
      const itemId = previousValue[config.idAttribute as string];
      if (this.isItemDeleted(differences, String(config.entityName), itemId)) {
        this.log.debug(`Processing deleted item in ${config.entityName}`);
        await this.handleDeletion(config, itemId);
      }
    }
  }

  private isItemDeleted(differences: DetailedDiff, entityName: string, itemId: string): boolean {
    const deletedEntitiesByName: any = get(differences, `deleted.${entityName}`, {});
    const keyExistsInDeletions = Object.keys(deletedEntitiesByName).includes(itemId);

    if (keyExistsInDeletions) {
      if (deletedEntitiesByName[itemId] === undefined) {
        return true;
      }
    }
    return false;
  }

  private async handleDeletion(config: ManagedPath, compositeId: string): Promise<void> {
    const workflowId = config.includeParentId
      ? `${config.entityName}-${compositeId}-${this.id}`
      : `${config.entityName}-${compositeId}`;

    const handle = this.handles[workflowId];
    if (handle) {
      await this.cancelChildWorkflow(handle);
    }
  }

  protected async processArrayItems(
    newState: EntitiesState,
    items: any[],
    config: ManagedPath,
    differences: DetailedDiff,
    previousState: EntitiesState,
    changeOrigins: string[]
  ): Promise<void> {
    this.log.trace(`[${this.constructor.name}]:${this.entityName}:${this.id}.processArrayItems`);

    for (const newItem of items) {
      const itemId = Array.isArray(config.idAttribute)
        ? getCompositeKey(newItem, config.idAttribute)
        : newItem[config.idAttribute as string];

      await this.processSingleItem(newState, itemId, config, differences, previousState, changeOrigins);
    }
  }

  protected async processSingleItem(
    newState: EntitiesState,
    itemId: string,
    config: ManagedPath,
    differences: DetailedDiff,
    previousState: EntitiesState,
    changeOrigins: string[]
  ): Promise<void> {
    this.log.trace(`[${this.constructor.name}]:${this.entityName}:${this.id}.processSingleItem(${itemId})`);

    const compositeId = Array.isArray(config.idAttribute)
      ? getCompositeKey(newState[config.entityName as string][itemId], config.idAttribute)
      : itemId;

    const workflowId = config.includeParentId
      ? `${config.entityName}-${compositeId}-${this.id}`
      : `${config.entityName}-${compositeId}`;

    if (changeOrigins.includes(workflowId)) {
      this.log.debug(`[${this.constructor.name}]:${this.entityName}:${this.id} Skipping recursive update...`);
      return;
    }

    const existingHandle = this.handles[workflowId];
    const previousItem = get(previousState, `${config.entityName}.${compositeId}`, {});
    const newItem = get(newState, `${config.entityName}.${compositeId}`, {});
    const hasStateChanged = !isEqual(previousItem, newItem);

    if (hasStateChanged) {
      if (existingHandle && 'result' in existingHandle) {
        await this.updateChildWorkflow(existingHandle as workflow.ChildWorkflowHandle<any>, newItem, newState, config);
      } else if (!existingHandle && !isEmpty(differences)) {
        await this.startChildWorkflow(config, newItem, newState);
      }
    }
  }

  protected async startChildWorkflow(config: ManagedPath, state: any, newState: any): Promise<void> {
    try {
      const {
        workflowType,
        entityName,
        idAttribute,
        includeParentId,
        cancellationType = workflow.ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
        parentClosePolicy = workflow.ParentClosePolicy.PARENT_CLOSE_POLICY_TERMINATE,
        autoStart
      } = config;

      if (!autoStart) {
        this.log.trace(
          `${workflowType} with entityName ${entityName} not configured to autoStart...\n${JSON.stringify(config, null, 2)}`
        );
        return;
      }

      const { [idAttribute as string]: id, ...rest } = state;
      const parentData = limitRecursion(this.id, this.entityName, newState);

      const rawData = limitRecursion(id, String(entityName), newState);
      const data = typeof config.processData === 'function' ? config.processData(rawData, parentData) : rawData;
      const compositeId = Array.isArray(idAttribute) ? getCompositeKey(data, idAttribute) : id;
      const workflowId = includeParentId ? `${entityName}-${compositeId}-${this.id}` : `${entityName}-${compositeId}`;

      if (this.ancestorWorkflowIds.includes(workflowId)) {
        this.log.info(
          `[${this.constructor.name}]:${this.entityName}:${this.id} Circular dependency detected for workflowId: ${workflowId}. Skipping child workflow start.`
        );
        return;
      }

      if (typeof config.condition === 'function') {
        this.log.trace(
          `[${this.constructor.name}]:${this.entityName}:${this.id}: Calling condition function before starting child...`
        );
        if (!config.condition.apply(this, [rawData, this])) {
          this.log.info(
            `[${this.constructor.name}]:${this.entityName}:${this.id}: Condition returned false, not starting child.`
          );
          return;
        }
      }

      const startPayload = {
        workflowId,
        cancellationType,
        parentClosePolicy,
        startToCloseTimeout: '10 minutes',
        args: [
          {
            id,
            state: normalizeEntities(data, SchemaManager.getInstance().getSchema(entityName as string)),
            entityName,
            subscriptions: [
              {
                subscriptionId: `${this.entityName}:${this.id}.${config.path}:${id}`,
                workflowId: workflow.workflowInfo().workflowId,
                signalName: 'update',
                selector: '*',
                parent: `${this.entityName}:${this.id}`,
                child: `${config.entityName}:${id}`,
                ancestorWorkflowIds: [...this.ancestorWorkflowIds]
              }
            ],
            apiToken: this.apiToken,
            ancestorWorkflowIds: [...this.ancestorWorkflowIds, workflow.workflowInfo().workflowId]
          }
        ],
        retry: {
          initialInterval: 1000 * 1,
          maximumInterval: 1000 * 20,
          backoffCoefficient: 1.5,
          maximumAttempts: 30
        }
      };

      this.log.trace(
        `[${this.constructor.name}]:${this.entityName}:${this.id}.startChildWorkflow( workflowType=${workflowType}, startPayload=${JSON.stringify(startPayload, null, 2)}\n)`
      );
      this.handles[workflowId] = await workflow.startChild(String(workflowType), startPayload);
      this.emit(`child:${entityName}:started`, { ...config, workflowId, data });
      this.handles[workflowId]
        .result()
        .then((result) => this.emit(`child:${entityName}:completed`, { ...config, workflowId, result }))
        .catch(async (error) => {
          this.log.error(
            `[${this.constructor.name}]:${this.entityName}:${this.id} Child workflow error: ${error.message}\n${error.stack}`
          );
          if (workflow.isCancellation(error) && this.status !== 'cancelled') {
            this.log.info(
              `[${this.constructor.name}]:${this.entityName}:${this.id} Restarting child workflow due to cancellation.`
            );
            try {
              await this.startChildWorkflow(
                config,
                this.stateManager.query(String(entityName), compositeId, false),
                this.state
              );
            } catch {}
          } else {
            this.emit(`child:${entityName}:errored`, { ...config, workflowId, error });
          }
        });
    } catch (err) {
      if (err instanceof Error) {
        this.log.error(
          `[${this.constructor.name}]:${this.entityName}:${this.id} Failed to start new child workflow: ${err.message}\n${err.stack}`
        );
      } else {
        this.log.error(
          `[${this.constructor.name}]:${this.entityName}:${this.id} An unknown error occurred while starting a new child workflow`
        );
      }
      throw err;
    }
  }

  protected async updateChildWorkflow(
    handle: workflow.ChildWorkflowHandle<any>,
    state: any,
    newState: any,
    config: ManagedPath
  ): Promise<void> {
    this.log.debug(`[${this.constructor.name}]:${this.entityName}:${this.id}.updateChildWorkflow`);
    try {
      const { workflowType, entityName, idAttribute, includeParentId, autoStart } = config;

      if (!autoStart) {
        this.log.warn(
          `${workflowType} with entityName ${entityName} not configured to autoStart...\n${JSON.stringify(config, null, 2)}`
        );
        return;
      }

      const { [idAttribute as string]: id, ...rest } = state;
      const parentData = limitRecursion(this.id, this.entityName, newState);
      const rawData = limitRecursion(id, String(entityName), newState);
      const data = typeof config.processData === 'function' ? config.processData(rawData, parentData) : rawData;
      const compositeId = Array.isArray(idAttribute) ? getCompositeKey(data, idAttribute) : id;
      const workflowId = includeParentId ? `${entityName}-${compositeId}-${this.id}` : `${entityName}-${compositeId}`;

      if (this.ancestorWorkflowIds.includes(workflowId)) {
        this.log.info(
          `[${this.constructor.name}]:${this.entityName}:${this.id} Circular update detected for workflowId: ${workflowId}. Skipping child workflow update.`
        );
        return;
      }

      if (typeof config.condition === 'function') {
        this.log.info(
          `[${this.constructor.name}]:${this.entityName}:${this.id}: Calling condition function before starting child...`
        );
        if (!config.condition.apply(this, [rawData, this])) {
          this.log.info(
            `[${this.constructor.name}]:${this.entityName}:${this.id}: Condition returned false, not starting child.`
          );
          return;
        }
      }

      await handle.signal('update', {
        data,
        entityName: config.entityName,
        strategy: '$merge',
        sync: true,
        changeOrigin: workflow.workflowInfo().workflowId
      });
      this.emit(`child:${entityName}:updated`, {
        ...config,
        workflowId: handle.workflowId,
        data,
        changeOrigin: workflow.workflowInfo().workflowId
      });
    } catch (err) {
      if (err instanceof Error) {
        this.log.error(
          `[${this.constructor.name}]:${this.entityName}:${this.id} Failed to signal existing workflow handle: ${err.message}`
        );
      } else {
        this.log.error(
          `[${this.constructor.name}]:${this.entityName}:${this.id} An unknown error occurred while signaling the child workflow`
        );
      }
    }
  }

  protected async handleMaxIterations(): Promise<void> {
    // @ts-ignore
    const continueAsNewMethod = (this as any)._continueAsNewMethod || this.continueAsNewHandler;
    await workflow.condition(() => workflow.allHandlersFinished(), '30 seconds');

    if (continueAsNewMethod && typeof (this as any)[continueAsNewMethod] === 'function') {
      return await (this as any)[continueAsNewMethod]();
    } else {
      const continueFn = workflow.makeContinueAsNewFunc({
        workflowType: String(this.options.workflowType),
        memo: workflow.workflowInfo().memo,
        searchAttributes: workflow.workflowInfo().searchAttributes
      });

      await continueFn({
        state: this.state,
        status: this.status,
        subscriptions: this.subscriptions,
        ...Object.keys(this.params).reduce(
          (params, key: string) => ({
            ...params, // @ts-ignore
            [key as string]: this[key as string]
          }),
          {}
        )
      });
    }
  }

  protected async loadDataAndEnqueue(): Promise<void> {
    // @ts-ignore
    if (typeof this?.loadData === 'function') {
      // @ts-ignore
      let { data, updates, strategy = '$merge' } = await this.loadData();
      if (!data && !updates) {
        console.log(`No data or updates returned from loadData(), skipping state change...`);
        return;
      }
      if (data && !updates) {
        updates = normalizeEntities(data, this.entityName);
      }

      this.stateManager.dispatch(updateNormalizedEntities(updates, strategy), false);
    }
  }

  protected configureManagedPaths(
    parentSchema: Schema & { schema?: { [key: string]: Schema & [{ _idAttribute: string; _key: string }] } }
  ): void {
    this.log.debug(`[${this.constructor.name}]:${this.entityName}:${this.id}.configureManagedPaths`);
    if (!parentSchema.schema) {
      throw new Error("The provided schema does not have 'schema' defined.");
    }
    const childSchemas = parentSchema.schema;
    for (const [path, _schema] of Object.entries(childSchemas)) {
      const schema = _schema instanceof Array ? _schema[0] : _schema;
      this.managedPaths[path] = {
        path,
        idAttribute: schema._idAttribute,
        workflowType: `${schema._key}Workflow`,
        autoStart: typeof this.options?.autoStart === 'boolean' ? this.options?.autoStart : true,
        entityName: schema._key,
        isMany: _schema instanceof Array,
        ...(this.managedPaths[path] || {})
      };
    }
  }

  protected async bindProperties() {
    await super.bindProperties();

    const properties = this.collectMetadata(PROPERTY_METADATA_KEY, this.constructor.prototype);

    properties.forEach(({ propertyKey, path, memo }) => {
      const isStringPath = typeof path === 'string';
      const useMemoPath = memo === true && isStringPath;
      const memoKeyString = typeof memo === 'string';

      const resolveMemoKey = () => (useMemoPath ? path : memo);

      if (memo || memoKeyString) {
        this._memoProperties[propertyKey] = Reflect.get(this, propertyKey);
      }

      if (isStringPath || memoKeyString) {
        Object.defineProperty(this, propertyKey, {
          get: () => {
            if (useMemoPath || memoKeyString) {
              return this._memoProperties ? this._memoProperties[resolveMemoKey()] : undefined;
            } else if (isStringPath) {
              return dottie.get(this.data || {}, path);
            }
            return undefined;
          },
          set: (value) => {
            if (useMemoPath || memoKeyString) {
              dottie.set(this._memoProperties, resolveMemoKey(), value);
            }
            if (isStringPath) {
              dottie.set(this.data || (this.data = {}), path, value);
            }
          },
          configurable: false,
          enumerable: true
        });
      }
    });
  }

  @On('init')
  protected async bindActions() {
    if (this._actionsBound) {
      return;
    }

    const actions: ActionMetadata[] = Reflect.getMetadata(ACTIONS_METADATA_KEY, this.constructor.prototype) || [];
    const validators = Reflect.getMetadata(VALIDATOR_METADATA_KEY, this.constructor.prototype) || {};

    for (const { method, options } of actions) {
      const methodName = method as keyof StatefulWorkflow<any, any>;
      const updateOptions: UpdateHandlerOptions<any[]> = {};
      const validatorMethod = validators[methodName];
      if (validatorMethod) {
        updateOptions.validator = (this as any)[validatorMethod].bind(this);
      }
      updateOptions.unfinishedPolicy = HandlerUnfinishedPolicy.ABANDON;

      workflow.setHandler(
        workflow.defineUpdate<any, any>(method),
        (input: any) => this.runAction(methodName, input), // Adjust runAction call to pass methodName
        updateOptions
      );
    }

    this._actionsBound = true;
  }

  @Mutex('Action')
  protected async runAction(methodName: keyof StatefulWorkflow<any, any>, input: any): Promise<any> {
    this.actionRunning = true;
    let result: any;
    let error: any;

    try {
      result = await (this[methodName] as (input: any) => any).call(this, input); // Use .call to ensure correct context
    } catch (err: any) {
      error = err;
      this.log.error(error);
    } finally {
      this.actionRunning = false;
      this.pendingIteration = true;
    }

    await workflow.condition(() => !this.stateManager.processing && !this.pendingIteration);

    // Return the result or the error if it exists
    if (error !== undefined) {
      return Promise.reject(error);
    }
    return result !== undefined ? result : this.data;
  }
}
