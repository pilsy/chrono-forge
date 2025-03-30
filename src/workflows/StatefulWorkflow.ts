/* eslint-disable @typescript-eslint/ban-ts-comment */
import dottie, { get } from 'dottie';
import * as workflow from '@temporalio/workflow';
import {
  normalizeEntities,
  EntitiesState,
  updateNormalizedEntities,
  deleteNormalizedEntities,
  updateEntity,
  EntityAction,
  EntityStrategy,
  setState
} from '../store';
import { detailedDiff, DetailedDiff } from 'deep-object-diff';
import { schema, Schema } from 'normalizr';
import { isEmpty, isEqual, isObject } from 'lodash';
import { Workflow, TemporalOptions } from './Workflow';
import {
  Signal,
  Query,
  Before,
  Property,
  ACTIONS_METADATA_KEY,
  VALIDATOR_METADATA_KEY,
  PROPERTY_METADATA_KEY,
  ActionOptions,
  On,
  EVENTS_METADATA_KEY
} from '../decorators';
import { EnhancedEntity, SchemaManager } from '../store/SchemaManager';
import { StateManager } from '../store/StateManager';
import { limitRecursion } from '../utils/limitRecursion';
import { getCompositeKey } from '../utils/getCompositeKey';
import { UpdateHandlerOptions } from '@temporalio/workflow/lib/interfaces';
import { Duration, HandlerUnfinishedPolicy } from '@temporalio/common';
import { flatten } from '../utils/flatten';
import { unflatten } from '../utils';
import { mergeDeepRight } from 'ramda';
import { LRUCacheWithDelete } from 'mnemonist';

/**
 * Configuration structure defining how entity paths and associated workflows are managed.
 *
 * This type outlines the available options for configuring entity management within workflows. It includes
 * essential details such as entity identifiers, workflow behavior, and conditions for workflow execution.
 *
 * ## Properties
 * - **`entityName`** (optional): Represents the entity's name used for identification purposes.
 * - **`path`** (optional): Describes the path in the state where the entity data is stored.
 * - **`workflowType`** (optional): Specifies the workflow type that corresponds to this entity.
 * - **`idAttribute`** (optional): Identifies the attribute(s) that uniquely determine the entity; can be a string or an array for composite keys.
 * - **`isMany`** (optional): Boolean indicating whether the path refers to multiple entities.
 * - **`includeParentId`** (optional): If true, includes parent identifiers in the workflow IDs to ensure they are unique.
 * - **`autoStart`** (optional): Determines if the workflow should initiate automatically once configured conditions are met.
 * - **`cancellationType`** (optional): Determines the child workflow's cancellation policy using values from `workflow.ChildWorkflowCancellationType`.
 * - **`parentClosePolicy`** (optional): Defines the effect of a parent workflow's closure on the child workflow, using `workflow.ParentClosePolicy`.
 * - **`workflowIdConflictPolicy`** (optional): Dictates how to handle workflow ID conflicts, utilizing values from `workflow.WorkflowIdConflictPolicy`.
 * - **`workflowIdReusePolicy`** (optional): Indicates policy for workflow ID reuse, using values from `workflow.WorkflowIdReusePolicy`.
 * - **`workflowTaskTimeout`** (optional): Duration after which the workflow should time out if it hasn't completed.
 * - **`startDelay`** (optional): Duration to wait before starting the workflow.
 * - **`retry`** (optional): Configuration object defining retry parameters for the workflow:
 *   - `initialInterval`: Initial retry interval in milliseconds.
 *   - `maximumInterval`: Maximum interval for retries.
 *   - `backoffCoefficient`: Coefficient for retry backoff calculations.
 *   - `maximumAttempts`: Maximum retry attempts allowed.
 * - **`startToCloseTimeout`** (optional): Duration after which the workflow should time out if it hasn't completed.
 * - **`condition`** (optional): Function determining whether the workflow should start, given the entity and related data.
 * - **`getSubscriptions`** (optional): Function returning an array of subscription configurations based on an update subscription object.
 * - **`processData`** (optional): Function for processing entity data before starting the workflow, providing ready-to-use data for workflow context.
 *
 * ## Usage Example
 * ```typescript
 * const configPath: ManagedPath = {
 *   entityName: "User",
 *   path: "users",
 *   idAttribute: "userId",
 *   autoStart: true,
 *   processData: (entity, data) => ({ ...entity, modified: true }),
 * };
 * ```
 *
 * ## Notes
 * - The `ManagedPath` type captures a comprehensive set of configuration options for entity management, supporting both single and composite entities.
 * - Proper configuration is crucial for robust, automated workflow operations, ensuring effective entity lifecycle handling.
 */
export type ManagedPath = {
  entityName?: string;
  path?: string;
  workflowType?: string;
  idAttribute?: string | string[];
  isMany?: boolean;
  includeParentId?: boolean;
  autoStart?: boolean;
  cancellationType?: workflow.ChildWorkflowCancellationType;
  parentClosePolicy?: workflow.ParentClosePolicy;
  workflowIdConflictPolicy?: workflow.WorkflowIdConflictPolicy;
  workflowIdReusePolicy?: workflow.WorkflowIdReusePolicy;
  workflowTaskTimeout?: Duration;
  startDelay?: Duration;
  retry?: {
    initialInterval?: number;
    maximumInterval?: number;
    backoffCoefficient?: number;
    maximumAttempts?: number;
  };
  startToCloseTimeout?: string;
  condition?: (entity: Record<string, any>, data: StatefulWorkflow['data']) => boolean;
  strategy?: '$set' | '$merge';
  subscriptions?: {
    update?: {
      enabled?: boolean;
      sync?: boolean;
      strategy?: '$set' | '$merge';
      selector?: string;
    };
    delete?: {
      enabled?: boolean;
      sync?: boolean;
      strategy?: '$set' | '$merge';
      selector?: string;
    };
  };
  processData?: (entity: Record<string, any>, data: StatefulWorkflow['data']) => Record<string, any>;
};

/**
 * Defines the configuration structure for managing entity paths and associated workflows.
 *
 * This type specifies the layout and options available for configuring how entities are managed
 * within workflows, capturing details such as entity identifiers, workflow types, and start conditions.
 * @see ManagedPath
 */
export type ManagedPaths = {
  [path: string]: ManagedPath;
};

/**
 * Subscription configuration for workflow state changes.
 *
 * Defines how a workflow subscribes to state changes from another workflow,
 * specifying what signals to receive and under what conditions.
 *
 * ## Usage Example
 * ```typescript
 * const workflowSubscription: Subscription = {
 *   workflowId: "order-processing-workflow",
 *   signalName: "orderUpdated",
 *   selector: "*",
 *   entityName: "Order",
 *   condition: (state) => state.status === "Pending",
 * };
 * ```
 *
 * ## Notes
 * - Subscriptions facilitate complex, event-driven interactions within workflow systems, leveraging properties
 *   such as `signalName` and `selector` to fine-tune reactions.
 * - Optional fields provide flexibility for hierarchical and condition-based designs, enhancing adaptability in various workflows.
 * - Proper subscription management ensures responsive and efficient workflows, enabling precise event handling and state transitions.
 *
 * @property {string} workflowId - The ID of the workflow being subscribed to.
 * @property {string} subscriptionId - Unique identifier for this subscription.
 * @property {'update' | 'delete'} signalName - The type of signal to subscribe to.
 * @property {string} selector - Path selector pattern to filter state changes.
 * @property {string} [parent] - Optional parent entity identifier.
 * @property {string} [child] - Optional child entity identifier.
 * @property {string[]} [ancestorWorkflowIds] - IDs of ancestor workflows to prevent circular updates.
 * @property {(state: any) => boolean} [condition] - Optional function to further filter changes.
 * @property {boolean} [sync] - Whether updates should be processed synchronously.
 * @property {'$set' | '$merge'} [strategy] - Strategy for applying updates to state.
 */
type Subscription = {
  workflowId: string;
  subscriptionId: string;
  signalName: 'update' | 'delete';
  selector: string;
  parent: string;
  child: string;
  ancestorWorkflowIds: string[];
  condition?: (state: any) => boolean;
  sync?: boolean;
  strategy?: '$set' | '$merge';
};

/**
 * Parameters for initializing a stateful workflow, providing configuration and data context.
 *
 * This type captures the essential details and optional settings needed to instantiate and
 * manage a stateful workflow, including entity, API, and subscription configurations.
 *
 * ## Properties
 * - `id`: A string serving as the unique identifier for the workflow instance.
 * - `entityName`: The name of the entity associated with this workflow, used for context and identification.
 * - `data` (optional): A generic parameter `D` representing the data specific to the entity within the workflow.
 * - `state` (optional): The state of entities at the moment of workflow initialization, used for context and processing.
 * - `status`: The current status of the workflow, indicating its operational state.
 * - `apiUrl` (optional): The URL for API interactions related to the workflow, facilitating external communication if needed.
 * - `apiToken` (optional): A token for authenticating API requests, providing secure access to external systems.
 * - `subscriptions` (optional): An array of `Subscription` objects, defining event-driven connections for the workflow.
 * - `autoStart` (optional): A boolean indicating if the workflow should start automatically upon initialization.
 * - `ancestorWorkflowIds` (optional): An array of strings denoting the IDs of ancestor workflows, useful for lineage tracking.
 *
 * ## Usage Example
 * ```typescript
 * const workflowParams: StatefulWorkflowParams = {
 *   id: "workflow-123",
 *   entityName: "Order",
 *   status: "active",
 *   autoStart: true,
 *   subscriptions: [orderSubscription],
 * };
 * ```
 */
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
  startDelay?: Duration;
};

/**
 * Options for configuring a stateful workflow, focusing on schema and execution settings.
 *
 * This type provides configuration options for setting up workflows, emphasizing schema integration
 * and auto-start capabilities for seamless workflow operations.
 *
 * ## Properties
 * - `schema` (optional): A `schema.Entity` object representing the data schema for the workflow,
 *   crucial for data validation and normalization.
 * - `schemaName` (optional): The name of the schema, assisting in referencing and managing various schemas.
 * - `autoStart` (optional): A boolean indicating whether the workflow should initiate automatically.
 * - `apiUrl` (optional): The API endpoint used for workflow-related communications.
 * - `workflowType` (optional): The type of the workflow, identifying the workflow's structure and purpose.
 *
 * ## Usage Example
 * ```typescript
 * const workflowOptions: StatefulWorkflowOptions = {
 *   schemaName: "OrderSchema",
 *   autoStart: true,
 *   workflowType: "order-processing",
 *   apiUrl: "https://api.example.com",
 * };
 * ```
 */
export type StatefulWorkflowOptions = {
  schema?: EnhancedEntity;
  schemaName?: string;
  saveStateToMemo?: boolean;
  apiUrl?: string;
  workflowType?: string;
  children?: {
    autoStart?: boolean;
    update?: {
      enabled?: boolean;
      sync?: boolean;
      strategy?: '$set' | '$merge';
    };
    delete?: {
      enabled?: boolean;
      sync?: boolean;
      strategy?: '$set' | '$merge';
    };
  };
};

/**
 * Represents a pending change awaiting application within a workflow, detailing the modifications and approach.
 *
 * This type specifies pending updates or deletions along with the strategy to apply changes,
 * assisting workflows in maintaining accurate state adjustments.
 *
 * ## Properties
 * - `updates` (optional): A record of fields and values marked for updating, keyed by entity attributes.
 * - `deletions` (optional): A record of fields designated for deletion, identifying which data should be removed.
 * - `entityName`: The name of the entity to which changes are applied, offering context for the modifications.
 * - `strategy` (optional): Specifies the change application strategy, either '$set' or '$merge',
 *   determining overwrite or merge behavior.
 * - `changeOrigin` (optional): A string identifying the source of change, useful for auditing and reverse-tracing.
 * - `sync` (optional): A boolean indicating if the change should be synchronized immediately, emphasizing real-time application.
 * - `action` (optional): An `EntityAction` instance representing any associated actions that arise from the change.
 *
 * ## Usage Example
 * ```typescript
 * const pendingChange: PendingChange = {
 *   updates: { status: "shipped" },
 *   entityName: "Order",
 *   strategy: '$merge',
 *   changeOrigin: "user-update",
 * };
 * ```
 */
export type PendingChange = {
  updates?: Record<string, any>;
  deletions?: Record<string, any>;
  entityName: string;
  strategy?: EntityStrategy;
  changeOrigin?: string;
  sync?: boolean;
  action?: EntityAction;
};

/**
 * Metadata related to an action method within a stateful workflow, including options for execution.
 *
 * This interface defines metadata for action methods, encapsulating execution options
 * accessible via the workflow framework.
 *
 * ## Properties
 * - `method`: A key representing the action method within the `StatefulWorkflow`, indicating what function is being described.
 * - `options` (optional): An `ActionOptions<any, any>` object specifying configuration details or execution modifiers for the method.
 *
 * ## Usage Example
 * ```typescript
 * const actionMetadata: ActionMetadata = {
 *   method: "updateOrderStatus",
 *   options: { retries: 3 },
 * };
 * ```
 */
export interface ActionMetadata {
  method: keyof StatefulWorkflow<any, any>;
  options?: ActionOptions<any, any>;
}

/**
 * Entry detailing a connection to an ancestor workflow, maintaining identification and relationship data.
 *
 * This type manages the association with ancestor workflows, storing identification details
 * and the external workflow handle for effective cross-workflow communication.
 *
 * ## Properties
 * - `entityId`: The ID of the related entity, serving as a primary identifier for association.
 * - `entityName`: The name of the entity, facilitating context and clarity within multiple workflows.
 * - `isParent`: A boolean indicating if the ancestor workflow is directly a parent, clarifying lineage roles.
 * - `handle`: An `ExternalWorkflowHandle` object, affording access to the ancestor workflow's external interface.
 *
 * ## Usage Example
 * ```typescript
 * const ancestorEntry: AncestorHandleEntry = {
 *   entityId: "order-789",
 *   entityName: "Order",
 *   isParent: true,
 *   handle: orderWorkflowHandle,
 * };
 * ```
 */
export type AncestorHandleEntry = {
  entityId: string;
  entityName: string;
  isParent: boolean;
  handle: workflow.ExternalWorkflowHandle;
};

export type StateEventListener = {
  newState: EntitiesState;
  previousState: EntitiesState;
  changeType: 'added' | 'updated' | 'deleted';
  changes: DetailedDiff;
  origins: string[];
};

export type LoadDataResult<T> = {
  data?: Partial<T>;
  updates?: EntitiesState;
  strategy?: EntityStrategy;
};

export abstract class StatefulWorkflow<
  P extends StatefulWorkflowParams = StatefulWorkflowParams,
  O extends StatefulWorkflowOptions = StatefulWorkflowOptions
> extends Workflow<P, O> {
  /**
   * Internal state binding flags
   */
  private _actionsBound: boolean = false;
  protected _eventsBound = false;

  private readonly selectorPatternCache = new Map<string, RegExp>();

  /**
   * Converts a selector string into a regular expression pattern for matching paths.
   *
   * @private
   * @param {string} selector - The selector string to convert.
   * @returns {RegExp} A regular expression that matches paths according to the selector pattern.
   */
  private getSelectorPattern(selector: string): RegExp {
    let pattern = this.selectorPatternCache.get(selector);
    if (!pattern) {
      pattern = new RegExp('^' + selector.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      this.selectorPatternCache.set(selector, pattern);
    }
    return pattern;
  }

  /**
   * Internal reference object to hold the values for memo properties.
   */
  private _memoProperties: Record<string, any> = {};

  /**
   * Internal flag used to determine if there is currently an @Action() running (executeUpdate).
   */
  protected actionRunning: boolean = false;

  /**
   * Determines whether the workflow is a long running continueAsNew type workflow or a short lived one.
   * In the case of workflows extending from StatefulWorkflow, they are considered long running entity workflows.
   */
  protected continueAsNew: boolean = true;

  /**
   * Flag indicating whether the workflow should continue as new in the next iteration.
   *
   * When set to `true`, the workflow will be recreated with a new history after the current
   * iteration completes. This is useful for:
   *
   * - Preventing workflow histories from growing too large
   * - Managing long-running workflows efficiently
   * - Implementing workflow versioning and updates
   * - Clearing accumulated state when needed
   *
   * The workflow will automatically continue as new when:
   * - The history size approaches Temporal's limit (default ~40MB)
   * - The maximum number of iterations is reached
   * - This flag is manually set to true
   *
   * @example
   * ```typescript
   * class MyWorkflow extends Workflow {
   *   async execute() {
   *     // After processing a large batch of data
   *     if (this.processedItemCount > 1000) {
   *       this.shouldContinueAsNew = true;
   *       return this.result;
   *     }
   *   }
   * }
   * ```
   *
   * @default false
   * @see {@link https://docs.temporal.io/workflows#continue-as-new Temporal Continue-as-New Documentation}
   */
  @Property()
  protected shouldContinueAsNew: boolean = false;

  /**
   * Internal reference to the StateManager instance for this workflow.
   */
  protected stateManager!: StateManager;

  /**
   * Internal reference to the StateManager instance for this workflow.
   */
  protected schemaManager = SchemaManager.getInstance();

  /**
   * Current workflow iteration count.
   */
  protected iteration = 0;

  /**
   * Internal reference to the Schema instance for this workflow.
   */
  protected schema: Schema;

  /**
   * The `conditionTimeout` property is utilized in the `StatefulWorkflow` class to manage timeout settings
   * for workflow conditions. This optional parameter allows the developer to define a specific duration
   * for which the workflow should wait for certain conditions to be satisfied before proceeding.
   *
   * Example:
   * ```typescript
   * protected conditionTimeout: Duration = Duration.fromMinutes(1);
   * ```
   *
   * ### Usage:
   * - **Context**: Used within the `executeWorkflow` method to prevent indefinite waits in case certain
   *   conditions are not met in a timely manner.
   *
   * - **Definition**:
   *   ```typescript
   *   protected conditionTimeout?: Duration | undefined = undefined;
   *   ```
   *
   * - **Integration**: Applied in scenarios where `await workflow.condition()` is called, controlling how long
   *   the workflow can pause before proceeding.
   *
   * ### Configuration:
   * - **Default Value**: `undefined`, implying no timeout unless explicitly set.
   * - **Custom Values**: Use the `Duration` type to set a desired wait duration:
   *   ```typescript
   *   this.conditionTimeout = Duration.fromSeconds(30);
   *   ```
   *
   * **Considerations**:
   * - **Performance**: Setting appropriate timeouts ensures the workflow remains responsive and avoids long pauses.
   * - **Scalability**: Timeouts should align with the overall system architecture, especially for systems with
   *   nested or multiple workflows.
   * - **Failure Handling**: Implement retries or alternative paths to handle situations where conditions
   *   remain unmet beyond the timeout.
   */
  protected conditionTimeout: Duration | undefined = undefined;

  /**
   * Optional method that can be implemented by subclasses to define custom continue-as-new behavior.
   * If implemented, this method will be called when the workflow reaches its maximum iterations.
   * @returns A promise that resolves when the continue-as-new process is complete.
   */
  protected onContinue?(): Promise<void>;

  /**
   * Optional method that can be implemented by extending classes to load data from external sources.
   * This method is called automatically when pendingUpdate is true.
   *
   * @returns A promise that resolves to an object containing data and/or updates to be applied to the state
   */
  protected loadData?(): Promise<LoadDataResult<P['data']>>;

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
  protected abstract execute(args?: unknown, options?: TemporalOptions): Promise<unknown>;

  /**
   * Sets the API token for the workflow.
   * This token is used for authenticating API requests made by the workflow.
   *
   * @param apiToken - The API token to set.
   */
  @Property({ set: false, memo: 'apiToken' })
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
    this.log.trace(`setApiToken`);
    if (apiToken && this.apiToken !== apiToken) {
      this.log.debug(`Updating apiToken...`);
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
  @Query('state')
  getState() {
    return this.state;
  }

  get state() {
    return this.stateManager.state;
  }

  @Signal('state')
  async setState(state: EntitiesState) {
    await this.stateManager.setState(state);
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
    return this.stateManager.query(this.entityName, this.id, true);
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
    if (isObject(data) && this.data) {
      Object.assign(this.data, data as P['data']);
    } else {
      this.setState(normalizeEntities(data, this.entityName));
    }
  }

  /**
   * Boolean flag indicating a pending update, setting this to true will result in loadData() being called if it is defined.
   */
  @Property()
  protected pendingUpdate: boolean = true;

  /**
   * An array of pending changes that are in the StateManager queue waiting to be processed.
   */
  @Query('pendingChanges')
  get pendingChanges() {
    return this.stateManager.queue;
  }

  /**
   * An array of workflows that have open subscriptions to this workflows state.
   */
  @Property({ set: false })
  protected subscriptions: Subscription[] = [];

  /**
   * A map to keep track of workflows that have open subscriptions to this workflows state.
   */
  protected subscriptionHandles: LRUCacheWithDelete<string, workflow.ExternalWorkflowHandle> = new LRUCacheWithDelete(
    100
  );

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
  @Property()
  protected managedPaths: ManagedPaths = {};

  /**
   * The apiUrl for this workflows entity.
   */
  @Property()
  protected apiUrl?: string;

  /**
   * An array to keep track of ancestor workflow's ids.
   */
  @Property({ set: false })
  protected ancestorWorkflowIds: string[] = [];

  /**
   * The initial parameters as provided to this workflow when started.
   */
  @Property({ set: false })
  protected params: P;

  /**
   * The initial options as provided to this workflow when started.
   */
  @Property({ set: false })
  protected options: O;

  /**
   * A map to keep track of handles to ancestor workflows.
   */
  protected ancestorHandles: LRUCacheWithDelete<string, AncestorHandleEntry> = new LRUCacheWithDelete(100);

  /**
   * Constructs an instance of the class with the specified parameters and options.
   *
   * @constructor
   * @param {P} params - The parameters for initializing the instance. It may include:
   *   - `ancestorWorkflowIds`: Optional list of ancestor workflow identifiers.
   *   - `id`: Optional identifier for the instance.
   *   - `entityName`: Optional name of the entity associated with this instance.
   *   - `subscriptions`: Optional array of subscriptions to be registered.
   *   - `state`: Optional initial state for the entity.
   *   - `data`: Optional data to update the entity.
   *   - `status`: Optional status of the workflow; defaults to 'running'.
   *   - `apiUrl`: Optional URL for API interactions.
   *   - `apiToken`: Optional token for API authentication.
   * @param {O} options - Configuration options which might include:
   *   - `schemaName`: Optional schema name for the entity.
   *   - `schema`: Schema object for the entity.
   *   - `apiUrl`: Default API URL if not provided in params.
   *
   * Initializes:
   * - The `stateManager` by retrieving it from `StateManager` using the workflow's info.
   * - The `ancestorHandles` map if `ancestorWorkflowIds` are present.
   * - The schema using either the parameters or options.
   * - Subscriptions using the provided parameter subscriptions.
   *
   * Sets up state management by listening for state changes and initializes any pending operations.
   */
  constructor(params: P, options: O) {
    super(params, options);

    this.params = params;
    this.options = options;

    this.options.saveStateToMemo = this.options.saveStateToMemo === true;

    this.stateManager = StateManager.getInstance(workflow.workflowInfo().workflowId);

    if (this.params?.ancestorWorkflowIds) {
      this.ancestorWorkflowIds = this.params.ancestorWorkflowIds;

      for (const workflowId of this.ancestorWorkflowIds) {
        const [entityName, entityId] = workflowId.split(/-(.*)/s).slice(0, 2);
        this.ancestorHandles.set(workflowId, {
          entityId,
          entityName,
          handle: workflow.getExternalWorkflowHandle(workflowId),
          isParent: workflow.workflowInfo().parent?.workflowId === workflowId
        });
      }
    }

    this.id = this.params?.id;
    this.entityName = (this.params?.entityName || options?.schemaName) as string;
    this.schema = this.entityName ? this.schemaManager.getSchema(this.entityName) : (options.schema as schema.Entity);

    this.stateManager.on('stateChange', this.stateChanged.bind(this));
    this.pendingUpdate = typeof (this as any)?.loadData === 'function';
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

    this.status = this.params?.status ?? 'running';

    this.apiUrl = this.params?.apiUrl ?? options?.apiUrl;
    this.apiToken = this.params?.apiToken;
  }

  @On('setup')
  protected async onSetup() {
    if (this.params?.subscriptions) {
      for (const subscription of this.params.subscriptions) {
        await this.subscribe(subscription);
      }
    }

    if (this.params?.state && !isEmpty(this.params?.state)) {
      await this.stateManager.dispatch(setState(this.params.state), false, workflow.workflowInfo().workflowId);
    }

    if (this.params?.data && !isEmpty(this.params?.data)) {
      await this.stateManager.dispatch(
        updateEntity(this.params.data, this.entityName),
        false,
        workflow.workflowInfo().workflowId
      );
    }
  }

  /**
   * Executes the workflow in a controlled and synchronized manner, ensuring thread safety
   * by using a mutex on the 'executeWorkflow' function.
   *
   * @protected
   * @async
   * @returns {Promise<any>} Resolves with the result of the workflow execution, or with any
   *   data processed if terminal state is reached without error. Rejects if an error state is
   *   encountered.
   *
   * Actions:
   * - Configures managed paths based on the schema, if available.
   * - Continuously executes the workflow logic while the current iteration is within the
   *   allowed maximum iterations (`maxIterations`).
   * - Waits for certain conditions to be met using the workflow's condition, pausing and
   *   resuming execution based on the workflow status.
   * - Loads data, executes the primary task, and checks for terminal states, resolving
   *   or rejecting the promise based on the success or failure of the workflow.
   * - Manages iterations, respecting maximum iterations and handling scenarios where
   *   the new state of execution may need to continue based on workflow constraints.
   * - Handles any execution errors appropriately by delegating to a specified error handler.
   *
   * This function logs relevant debug information, including entity details and current
   * execution states, making it suitable for tracing workflow progress through complex stages.
   */
  protected async executeWorkflow(): Promise<any> {
    this.log.trace(`executeWorkflow`);

    if (this.schema) this.configureManagedPaths(this.schema);
    if (this.params?.startDelay) await workflow.sleep(this.params.startDelay);

    try {
      while (this.iteration <= this.maxIterations) {
        if (this.pendingIteration) {
          this.pendingIteration = false;
        }

        await workflow.condition(
          () =>
            (typeof (this as any).condition === 'function' && (this as any).condition()) ||
            this.pendingIteration ||
            this.pendingUpdate ||
            !!this.pendingChanges.length ||
            this.shouldContinueAsNew ||
            this.status !== 'running',
          // @ts-ignore
          !this.conditionTimeout ? undefined : this.conditionTimeout
        );
        this.log.trace(`executeWorkflow: ${this.iteration}`);

        if (this.status === 'paused') {
          await this.emitAsync('paused');
          await this.forwardSignalToChildren('pause');
          await workflow.condition(() => this.status !== 'paused' || this.isInTerminalState());
        }

        if (!this.isInTerminalState() && this.shouldLoadData()) {
          await this.loadDataAndEnqueue();
        }

        if (!this.isInTerminalState()) {
          this.result = await this.execute();
        }

        if (this.pendingUpdate) {
          this.pendingUpdate = false;
        }

        if (!this.isInTerminalState() && this.pendingChanges.length) {
          this.log.warn(`Pending changes after processing: ${this.pendingChanges.length}`);
          await workflow.sleep(2500);
          continue;
        }

        if (this.isInTerminalState()) {
          if (this.status !== 'errored') {
            return this.result || this.data;
          }
          throw this.result;
        }

        if (
          ++this.iteration >= this.maxIterations ||
          workflow.workflowInfo().historyLength >= this.maxIterations ||
          (workflow.workflowInfo().continueAsNewSuggested && workflow.workflowInfo().historySize >= 25000000) ||
          this.shouldContinueAsNew
        ) {
          await this.handleMaxIterations();
          break;
        }

        await this.upsertToMemo();
      }

      return this.result ?? this.data;
    } catch (err) {
      if (err instanceof workflow.ContinueAsNew) {
        throw err;
      }
      await this.handleExecutionError(err, (error) => {
        throw error;
      });
      throw err;
    }
  }

  /**
   * Updates the state of an entity within the system with the given data and updates. This function
   * ensures that changes are dispatched appropriately, either as part of a specific `action` or
   * through a direct update of normalized entities.
   *
   * @param {Object} parameters An object containing all parameters required to perform the update.
   * @param {Record<string, any>} [parameters.data]
   *   Optional. A record containing the raw data to be normalized and used for the update. The data structure
   *   should match the expected schema for the entity being updated.
   * @param {any} [parameters.updates]
   *   Optional. Pre-normalized update data for directly updating the entity's state. If not provided,
   *   and if `data` is specified, `data` will be normalized to create updates.
   * @param {string} parameters.entityName
   *   The name of the entity for which the state update is being applied. This is used to fetch and use the
   *   correct schema for normalization if `data` is provided.
   * @param {any} [parameters.action]
   *   Optional. An action object that encapsulates specific state changes or commands to be dispatched directly.
   *   If provided, the function prioritizes dispatching this action.
   * @param {string} [parameters.strategy='$merge']
   *   Optional. The strategy used when merging updates into the current state. Defaults to '$merge' which
   *   merges new data into existing state.
   * @param {any} [parameters.changeOrigin]
   *   Optional. Indicates the origin of the changes, such as user input or automated system process. This
   *   can be used for logging or conditional logic during dispatch.
   * @param {boolean} [parameters.sync=true]
   *   Optional. A boolean flag indicating whether the state change should be synchronous. Defaults to `true`,
   *   meaning operations are synchronous by default.
   *
   * @returns {void}
   *   This method does not return a value but will log errors or trace information to facilitate debugging.
   *
   * @throws Will log an error if both `data` and `updates` are invalid or cannot be processed.
   *
   * @example
   * // Example usage:
   * update({
   *   data: { id: 1, name: 'John Doe' },
   *   entityName: 'User',
   *   strategy: '$replace',
   *   changeOrigin: 'client',
   *   sync: false
   * });
   *
   * @remark
   *   Ensure that either `data` or `updates` are provided. If neither can be normalised or used,
   *   the method logs an error indicating the failure if no action is supplied.
   */
  @Signal()
  public update({
    data,
    updates,
    entityName,
    action,
    strategy = '$merge',
    changeOrigin,
    sync = true
  }: PendingChange & { data?: Record<string, any> }): void {
    this.log.trace(`update`);

    if (action) {
      this.stateManager.dispatch(action, sync, changeOrigin);
    } else {
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
  }

  /**
   * Deletes entries of a specified entity type from the state, based on given data or predefined deletions.
   * This function facilitates the removal of entities by dispatching the appropriate delete action after
   * optionally normalizing the input data.
   *
   * @param {Object} parameters An object containing all parameters required to perform the deletion.
   * @param {Record<string, any>} [parameters.data]
   *   Optional. A record containing the raw data that specifies the entities to be deleted. This data will
   *   be normalized according to the entity's schema if provided.
   * @param {any} [parameters.deletions]
   *   Optional. Pre-normalized deletion data that directly specifies which entities should be removed.
   *   If not provided, and if `data` is specified, `data` will be normalized to infer deletions.
   * @param {any} [parameters.action]
   *   Optional. An action object that encapsulates specific state changes or commands to be dispatched directly.
   *   If provided, the function prioritizes dispatching this action.
   * @param {string} parameters.entityName
   *   The name of the entity type from which the specified entries should be deleted. This is crucial for
   *   ensuring that the correct schema is used for normalization if `data` is supplied.
   * @param {any} [parameters.changeOrigin]
   *   Optional. An identifier for the origin of the delete request, such as user action or internal mechanic,
   *   used for logging or conditional logic during dispatch.
   * @param {boolean} [parameters.sync=true]
   *   Optional. A boolean indicating whether the deletion operation should be synchronous. Defaults to `true`,
   *   which implies synchronous operations.
   *
   * @returns {void}
   *   This method does not return a value but logs errors or trace information to help diagnose issues.
   *
   * @throws Will log an error if both `data` and `deletions` are invalid or cannot be processed.
   *
   * @example
   * // Example usage:
   * delete({
   *   data: { id: 2 },
   *   entityName: 'User',
   *   changeOrigin: 'admin',
   *   sync: false
   * });
   *
   * @remark
   *   Ensure that either `data` or `deletions` are provided. If neither can be normalised or used,
   *   the method logs an error indicating the failure if no action is supplied.
   */
  @Signal()
  public delete({
    data,
    action,
    deletions,
    entityName,
    changeOrigin,
    sync = true
  }: PendingChange & { data?: Record<string, any> }): void {
    this.log.trace(`delete`);

    if (action) {
      this.stateManager.dispatch(action, sync, changeOrigin);
    } else {
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
  }

  /**
   * Adds a subscription to the current instance, ensuring that it is unique.
   *
   * @signal
   * @public
   * @async
   * @param {Subscription} subscription - The subscription object that contains details
   *   about the workflow and subscription IDs. It has the following properties:
   *   - `workflowId`: The unique identifier of the workflow.
   *   - `subscriptionId`: The unique identifier of the subscription within the workflow.
   * @returns {Promise<void>} A promise that resolves when the subscription handling is complete.
   *
   * Operations:
   * - Logs a trace of the subscription process for debugging, indicating the class, entity, and ID.
   * - Checks if the subscription already exists by comparing both `workflowId` and `subscriptionId`.
   * - If the subscription is unique, it adds the subscription to the `subscriptions` list.
   * - Sets up a handle for interacting with the specified workflow via `subscriptionHandles`.
   */
  @Signal()
  public async subscribe(subscription: Subscription): Promise<void> {
    this.log.trace(`subscribe`);

    const { workflowId, subscriptionId } = subscription;
    if (!this.subscriptions.find((sub) => sub.workflowId === workflowId && sub.subscriptionId === subscriptionId)) {
      this.subscriptions.push(subscription);
      this.subscriptionHandles.set(workflowId, workflow.getExternalWorkflowHandle(workflowId));
    }
  }

  /**
   * Removes a subscription from the current instance based on the given subscription details.
   *
   * @signal
   * @public
   * @async
   * @param {Subscription} subscription - The subscription object that contains details
   *   about the workflow and subscription IDs. It has the following properties:
   *   - `workflowId`: The unique identifier of the workflow.
   *   - `subscriptionId`: The unique identifier of the subscription within the workflow.
   * @returns {Promise<void>} A promise that resolves when the unsubscription process is complete.
   *
   * Operations:
   * - Logs a trace of the unsubscription process for debugging purposes, indicating the class, entity, and ID.
   * - Searches for the subscription in the `subscriptions` list using the `workflowId` and `subscriptionId`.
   * - If a matching subscription is found, it deletes the corresponding workflow handle from `subscriptionHandles`.
   * - Removes the identified subscription from the `subscriptions` list.
   */
  @Signal()
  public async unsubscribe(subscription: Subscription): Promise<void> {
    this.log.trace(`unsubscribe`);

    const { workflowId, subscriptionId } = subscription;
    const index = this.subscriptions.findIndex(
      (sub) => sub.workflowId === workflowId && sub.subscriptionId === subscriptionId
    );
    if (index !== -1) {
      this.subscriptionHandles.delete(workflowId);
      this.subscriptions.splice(index, 1);
    }
  }

  /**
   * Processes the current state of the entity, ensuring all pending changes are applied
   * when no actions are currently running.
   *
   * @before 'execute'
   * @protected
   * @async
   * @returns {Promise<void>} A promise that resolves once the state processing is complete and any pending changes are applied.
   *
   * Operations:
   * - Checks if an action is currently running (`actionRunning`). If so, logs an informational message
   *   and waits for the action to complete using the workflow condition.
   * - Logs a debug message indicating the start of the state processing.
   * - If there are any pending changes, it triggers the `stateManager` to process these changes.
   */
  @Before('execute')
  protected async processState(): Promise<void> {
    this.log.debug(`processState`);

    if (this.actionRunning) {
      this.log.trace(`Action is running, waiting for all changes to be made before processing...`);
      await workflow.condition(() => !this.actionRunning);
    }

    if (this.stateManager.processing) {
      this.log.trace(`State manager is already processing, waiting for it to finish...`);
      await workflow.condition(() => !this.stateManager.processing);
    }

    if (this.pendingChanges.length) {
      await this.stateManager.processChanges();
    }
  }

  /**
   * Handles changes in the entity's state by processing state differences and
   * triggering appropriate events based on the nature of these changes.
   *
   * @mutex 'processState'
   * @protected
   * @async
   * @param {Object} param0 - The object containing state change details, including:
   *   - `newState`: The state of the entities after changes have been applied.
   *   - `previousState`: The state of the entities before changes were applied.
   *   - `differences`: An object detailing the differences between the new and previous states.
   *     Includes `added`, `updated`, and `deleted` properties.
   *   - `changeOrigins`: An array of strings indicating the origins of the changes.
   * @returns {Promise<void>} A promise that resolves when all state change handling is complete.
   *
   * Operations:
   * - Logs a debug message indicating the transition and processing of state changes.
   * - Checks if there are any differences in the state (`added`, `updated`, `deleted`).
   * - Based on the differences:
   *   - Emits a 'created' event if the entity was newly added.
   *   - Emits an 'updated' event if the entity was modified.
   *   - Emits a 'deleted' event if the entity was removed, potentially setting the status to 'cancelled' if the deletion event fails.
   * - Processes the states of child entities and related subscriptions if applicable, triggering further handling mechanisms.
   * - Sets the `pendingIteration` flag to true, signaling readiness for further processing.
   */
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
    this.log.trace(`stateChanged`);

    if (!isEmpty(differences.added) || !isEmpty(differences.updated) || !isEmpty(differences.deleted)) {
      const created = get(differences.added, `${this.entityName}.${this.id}`, false);
      const updated = get(differences.updated, `${this.entityName}.${this.id}`, false);
      const deleted = get(differences.deleted, `${this.entityName}.${this.id}`, false);

      if (created && this.iteration === 0) {
        await this.emitAsync('created', { changes: created, newState, previousState, changeOrigins });
      } else if (created || updated) {
        await this.emitAsync('updated', {
          changes: mergeDeepRight(created || {}, updated || {}),
          newState,
          previousState,
          changeOrigins
        });
      } else if (deleted && this.isItemDeleted(differences, this.entityName, this.id)) {
        if (!(await this.emitAsync('deleted', { changes: deleted, newState, previousState, changeOrigins }))) {
          this.status = 'cancelled';
        }
      }

      await this.processChildState(newState, differences, previousState || {}, changeOrigins);

      let previousStateForSubscriptions: EntitiesState = {};
      if (this.iteration !== 0) {
        previousStateForSubscriptions = previousState || {};
      } else if (this.params.state) {
        previousStateForSubscriptions = this.params.state;
      } else if (this.params.data) {
        previousStateForSubscriptions = normalizeEntities(this.params.data, this.schema);
      }

      await this.processSubscriptions(
        newState,
        previousStateForSubscriptions === previousState
          ? differences
          : detailedDiff(previousStateForSubscriptions, newState),
        previousStateForSubscriptions,
        changeOrigins
      );

      this.pendingIteration = true;
    }
  }

  /**
   * Updates the workflow's memo with the current state, ensuring that any changes are persisted.
   *
   * @protected
   * @async
   * @returns {Promise<void>} A promise that resolves once the current state has been conditionally saved to memo.
   *
   * Operations:
   * - Logs information about the memo update process, including the current workflow ID.
   * - Retrieves the existing memo and flattens the current state and memo properties for comparison.
   * - Compares the existing memo state with the new state:
   *   - Updates the `updatedMemo` object with changes detected between the current and new states.
   *   - Marks the `hasChanges` flag if any changes exist.
   *   - Deletes keys from `updatedMemo` if they exist in the current memo but not in the new state.
   * - If changes are detected (`hasChanges` is true), the method updates the workflow memo with:
   *   - The new state details.
   *   - The current iteration count and workflow status.
   *   - A timestamp representing the last update.
   */
  protected async upsertToMemo(): Promise<void> {
    const memo = (workflow.workflowInfo().memo || {}) as {
      state?: EntitiesState;
      iteration?: number;
      status?: string;
      properties: Record<string, any>;
    };

    const flattenedCurrentMemo: any = flatten({
      status: memo?.status,
      state: memo?.state ?? {},
      properties: memo?.properties ?? {}
    });
    const flattenedNewMemo = flatten({
      status: this.status,
      state: this.options?.saveStateToMemo ? this.state : {},
      properties: this._memoProperties ?? {}
    });

    const updatedMemo: Record<string, any> = {};

    let hasChanges = isEmpty(memo);
    for (const [key, newValue] of Object.entries(flattenedNewMemo)) {
      const currentValue = flattenedCurrentMemo[key];
      if (!isEqual(newValue, currentValue)) {
        updatedMemo[key] = newValue;
        hasChanges = true;
      }
    }
    for (const key of Object.keys(flattenedCurrentMemo)) {
      if (!(key in flattenedNewMemo)) {
        updatedMemo[key] = undefined;
        hasChanges = true;
      }
    }

    if (hasChanges) {
      this.log.info(`Saving state to memo`);
      workflow.upsertMemo({
        ...updatedMemo,
        iteration: this.iteration,
        lastUpdated: new Date().toISOString()
      });
    }
  }

  /**
   * Handles the propagation of changes to subscribed workflows by processing updates and deletions
   * based on the current and previous states and their differences.
   *
   * @protected
   * @async
   * @param {EntitiesState} newState - The current state of the entities after changes have been applied.
   * @param {DetailedDiff} differences - An object detailing the changes between the new and previous states,
   *   including `added`, `updated`, and `deleted` differences.
   * @param {EntitiesState} previousState - The state of the entities prior to changes being applied.
   * @param {string[]} changeOrigins - A list of change origin identifiers.
   * @returns {Promise<void>} A promise that resolves when the subscription processing is complete.
   *
   * Operations:
   * - Logs a trace message to indicate the start of subscription processing.
   * - Iterates over the list of subscriptions, checking each for conditions to propagate changes:
   *   - Extracts relevant changes for each subscription using selectors and conditions.
   *   - If changes should be propagated:
   *     - Retrieves the workflow handle associated with the subscription.
   *     - Sends `update` signals to the workflow with details of the changes if any updates exist.
   *     - Sends `delete` signals if there are deletions.
   *     - Logs traces for each propagated signal to facilitate debugging.
   * - Catches and logs errors encountered during the signaling process to ensure robust error handling.
   */
  protected async processSubscriptions(
    newState: EntitiesState,
    differences: DetailedDiff,
    previousState: EntitiesState,
    changeOrigins: string[]
  ): Promise<void> {
    this.log.trace(`processSubscriptions`);

    for (const subscription of this.subscriptions) {
      const { workflowId, selector, condition, subscriptionId, signalName, sync, strategy } = subscription;

      // Type guard to ensure signalName is either 'update' or 'delete'
      if (signalName !== 'update' && signalName !== 'delete') {
        continue;
      }

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

      const handle = this.subscriptionHandles.get(workflowId);
      if (handle) {
        try {
          if ((signalName === 'update' && !isEmpty(updates)) || (signalName === 'delete' && !isEmpty(deletions))) {
            this.log.trace(`Sending ${signalName} to workflow: ${workflowId}, Subscription ID: ${subscriptionId}`);
            this.log.trace(JSON.stringify({ updates, deletions }, null, 2));

            await handle.signal(signalName, {
              ...(signalName === 'update' ? { updates } : { deletions }),
              changeOrigin: workflow.workflowInfo().workflowId,
              subscriptionId,
              sync,
              strategy
            });
          }
        } catch (err) {
          this.log.error(`Failed to signal workflow '${workflowId}': ${(err as Error).message}`);
        }
      }
    }
  }

  /**
   * Determines whether changes should be propagated to subscriptions based on selectors and conditions.
   *
   * @private
   * @param {EntitiesState} newState - The new state after changes.
   * @param {DetailedDiff} differences - The detailed differences between states.
   * @param {string} selector - The selector pattern to match against changes.
   * @param {Function} [condition] - Optional function to further filter changes.
   * @param {string[]} [changeOrigins] - Origins of the changes to prevent circular updates.
   * @param {string[]} [ancestorWorkflowIds=[]] - IDs of ancestor workflows to prevent circular dependencies.
   * @returns {boolean} True if changes should be propagated, false otherwise.
   */
  private shouldPropagate(
    newState: EntitiesState,
    differences: DetailedDiff,
    selector: string,
    condition?: (state: any) => boolean,
    changeOrigins?: string[],
    ancestorWorkflowIds: string[] = []
  ): boolean {
    if (changeOrigins) {
      for (const origin of changeOrigins) {
        if (origin && ancestorWorkflowIds.includes(origin)) {
          this.log.trace(
            `Skipping propagation for selector ${selector} because the change originated from an ancestor workflow (${origin}).`
          );
          return false;
        }
      }
    }

    const selectorRegex = this.getSelectorPattern(selector);
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
                  this.log.trace(`Custom condition for selector ${selector} not met.`);
                  continue;
                }

                this.log.trace(`Differences detected that match selector ${selector}, propagation allowed.`);
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
                    this.log.trace(`Custom condition for selector ${selector} not met.`);
                    continue;
                  }

                  this.log.trace(`Differences detected within selector ${selector}, propagation allowed.`);
                  return true;
                }
              }
            }
          }
        }
      }
    }

    this.log.trace(
      `No matching differences found, conditions not met, or ancestry conflicts for selector: ${selector}`
    );
    return false;
  }

  /**
   * Extracts changes that match a specific selector from the differences between states.
   *
   * @private
   * @param {DetailedDiff} differences - The detailed differences between states.
   * @param {string} selector - The selector pattern to match against changes.
   * @param {EntitiesState} newState - The new state after changes.
   * @param {EntitiesState} previousState - The previous state before changes.
   * @returns {{ updates: EntitiesState; deletions: EntitiesState }} Object containing filtered updates and deletions.
   */
  private extractChangesForSelector(
    differences: DetailedDiff,
    selector: string,
    newState: EntitiesState,
    previousState: EntitiesState
  ): { updates: EntitiesState; deletions: EntitiesState } {
    const updates: EntitiesState = {};
    const deletions: EntitiesState = {};

    let selectorRegex = this.getSelectorPattern(selector);

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

  /**
   * Processes the child state to handle differences between the new and previous states.
   *
   * This method traces the processing of child states for a given entity by recursively
   * handling managed paths defined in the `managedPaths` object. It processes both array
   * and non-array entities, checking for deletions and triggering appropriate actions.
   *
   * ## Parameters
   * - `newState`: The new state of the entities to be processed.
   * - `differences`: A detailed representation of differences between states that guides processing.
   * - `previousState`: The previous state of the entities before the change.
   * - `changeOrigins`: An array of strings representing the origins of changes triggering the update.
   *
   * ## Return
   * - A `Promise<void>` that resolves when all processing of child states is complete.
   *
   * ## Method Details
   * - Utilizes `limitRecursion` to work with a restricted view of entity states for comparison.
   - Iterates over `managedPaths` to process entities based on their paths configuration.
   * - Handles array and non-array entities through `processArrayItems` and `processItem` methods.
   * - Detects deleted items by checking their presence in differences and invokes `handleDeletion`.
   *
   * ## Usage Example
   * ```typescript
   * await processChildState(newEntityState, detailedDiff, oldEntityState, origins);
   * ```
   *
   * ## Notes
   * - The processing handles complex nested entities and their lifecycle changes.
   * - Ensure `managedPaths` is configured correctly to enable precise state management.
   *
   * ## Logging
   * - Logs trace and debug messages for monitoring the processing flow.
   */
  protected async processChildState(
    newState: EntitiesState,
    differences: DetailedDiff,
    previousState: EntitiesState,
    changeOrigins: string[]
  ): Promise<void> {
    this.log.trace(`processChildState`);

    const newData = limitRecursion(this.id, this.entityName, newState, this.stateManager);
    const oldData = limitRecursion(this.id, this.entityName, previousState);

    for (const [_, config] of Object.entries(this.managedPaths)) {
      const currentValue: any = get(newData, config.path as string);
      const previousValue: any = get(oldData, config.path as string);

      if (!config.autoStart && typeof config.condition !== 'function') {
        continue;
      }

      if (Array.isArray(currentValue)) {
        await this.processArrayItems(
          config,
          newState,
          previousState,
          differences,
          changeOrigins,
          currentValue,
          previousValue
        );
      } else if (currentValue) {
        await this.processItem(
          config,
          newState,
          previousState,
          differences,
          changeOrigins,
          currentValue,
          previousValue
        );
      }

      if (Array.isArray(previousValue)) {
        for (const item of previousValue) {
          const compositeId = Array.isArray(config.idAttribute)
            ? getCompositeKey(item, config.idAttribute)
            : item[config.idAttribute as string];

          if (this.isItemDeleted(differences, String(config.entityName), compositeId)) {
            this.log.trace(`Processing deleted item in ${config.entityName}`);
            await this.handleDeletion(config, compositeId);
          }
        }
      } else if (previousValue) {
        const itemId = previousValue[config.idAttribute as string];
        if (this.isItemDeleted(differences, String(config.entityName), itemId)) {
          this.log.trace(`Processing deleted item in ${config.entityName}`);
          await this.handleDeletion(config, itemId);
        }
      }
    }
  }

  /**
   * Processes a single, non-array item within the entity state.
   *
   * This method is responsible for handling an individual item specified by the managed
   * path configuration, applying necessary processing based on the detected differences
   * between the new and previous states.
   *
   * ## Parameters
   * - `newState`: The current state of all entities, from which the item's new value is derived.
   * - `itemValue`: The item's current value extracted using the managed path.
   * - `config`: An object containing configuration details about the path under management.
   * - `differences`: Details of changes between the new and previous states to direct processing steps.
   * - `previousState`: The state of all entities prior to applying changes.
   * - `changeOrigins`: An array that specifies the origins related to the modifications in state.
   * - `path`: The managed path's string representation, indicating the item's location within the state.
   *
   * ## Return
   * - A `Promise<void>` that resolves once the processing of the individual item is complete.
   *
   * ## Method Details
   * - Determines the composite identifier for the item using `getCompositeKey` if necessary.
   * - Delegates the processing to `processSingleItem`, ensuring that the item is handled
   *   according to the differences and configuration.
   *
   * ## Usage Example
   * ```typescript
   * await processItem(currentEntityState, entityValue, pathConfig, stateDiff, oldEntityState, origins, pathStr);
   * ```
   *
   * ## Notes
   * - Requires proper configuration of the `idAttribute` within `ManagedPath` to uniquely
   *   identify items.
   * - Intended for internal usage in managing state changes specific to one item.
   */
  private async processItem(
    config: ManagedPath,
    newState: EntitiesState,
    previousState: EntitiesState,
    differences: DetailedDiff,
    changeOrigins: string[],
    newItem: any = {},
    previousItem: any = {}
  ): Promise<void> {
    const compositeId = Array.isArray(config.idAttribute)
      ? getCompositeKey(newItem, config.idAttribute)
      : newItem[config.idAttribute as string];

    await this.processSingleItem(
      config,
      compositeId,
      newState,
      previousState,
      differences,
      changeOrigins,
      newItem,
      previousItem
    );
  }

  /**
   * Determines if a specific item has been deleted based on the differences between states.
   *
   * This method checks the `differences` object to see if an item, identified by the
   * `entityName` and `itemId`, is marked as deleted. It looks for the item's presence
   * in the deleted entities section of the detailed differences.
   *
   * ## Parameters
   * - `differences`: A `DetailedDiff` object containing changes between the new and previous entity states.
   * - `entityName`: The name of the entity type to which the item belongs, used to locate the item in the differences.
   * - `itemId`: The unique identifier of the item being checked for deletion.
   *
   * ## Return
   * - Returns a `boolean`:
   *   - `true` if the item is detected as deleted.
   *   - `false` if the item is not marked as deleted.
   *
   * ## Method Details
   * - Retrieves the deleted entities for the specified `entityName` from the differences object.
   * - Checks if the `itemId` exists among these deleted entities.
   * - Considers an item deleted if it exists but its corresponding value is `undefined` in the `deleted` records.
   *
   * ## Usage Example
   * ```typescript
   * const isDeleted = isItemDeleted(stateDiff, 'entityName', 'uniqueItemId');
   * ```
   *
   * ## Notes
   * - Relies on correctly structured `DetailedDiff` where deleted entity records are nested
   *   under a `deleted` key with proper entity name subkeys.
   * - Designed for use in processing state changes that involve detecting and handling deletions.
   */
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

  /**
   * Handles the deletion of an item by canceling associated workflows.
   *
   * This method constructs a unique workflow identifier from the given configuration and
   * composite ID, using it to locate any active workflow handles. If a handle is found,
   * it proceeds to cancel the associated child workflow.
   *
   * ## Parameters
   * - `config`: The `ManagedPath` configuration object containing path and workflow-specific settings.
   * - `compositeId`: A string representing the unique composite identifier for the entity item.
   *
   * ## Return
   * - A `Promise<void>` indicating the completion of the deletion handling process.
   *
   * ## Method Details
   * - Constructs the `workflowId` by potentially incorporating the parent ID based on the
   *   `includeParentId` flag within `config`.
   * - Retrieves the workflow handle from the internal `handles` map using the constructed `workflowId`.
   * - If a valid handle exists, invokes `cancelChildWorkflow` to terminate the workflow associated
   *   with the deleted item.
   *
   * ## Usage Example
   * ```typescript
   * await handleDeletion(pathConfig, 'entityCompositeId');
   * ```
   *
   * ## Notes
   * - Assumes the existence of a `handles` map that associates workflow IDs with their handles.
   * - The cancellation logic and additional side effects, if any, are encapsulated within `cancelChildWorkflow`.
   * - Designed to provide clean-up operations upon detecting entity state deletions.
   */
  private async handleDeletion(config: ManagedPath, compositeId: string): Promise<void> {
    const workflowId = config.includeParentId
      ? `${config.entityName}-${compositeId}-${this.id}`
      : `${config.entityName}-${compositeId}`;

    const handle = this.handles.get(workflowId);
    if (handle) {
      await this.cancelChildWorkflow(handle);
    }
  }

  /**
   * Processes an array of items within the entity state.
   *
   * This method iterates over each item in the provided array, applying necessary processing
   * of individual elements based on differences and configuration specifications, supporting
   * effective state management of array entities.
   *
   * ## Parameters
   * - `newState`: The updated state containing the latest set of entity data.
   * - `items`: An array of items to be processed individually.
   * - `config`: Configuration details from the `ManagedPath` specifying how to manage array items.
   * - `differences`: The detailed differences object used to guide processing actions appropriate to state changes.
   * - `previousState`: The state of entities prior to applying the current updates.
   * - `changeOrigins`: A collection of strings identifying where changes in the state originated.
   *
   * ## Return
   * - A `Promise<void>` indicating that the processing of all items in the array is complete.
   *
   * ## Method Details
   * - Logs the entry into the processing routine for monitoring and traceability.
   * - For each item, determines its unique identifier using either a composite key or a direct attribute value,
   *   as denoted in `config.idAttribute`.
   * - Delegates the processing of each identified item to the `processSingleItem` method, handling the specific
   *   transformation or validation based on detected differences and changes.
   *
   * ## Usage Example
   * ```typescript
   * await processArrayItems(updatedState, entityItems, pathConfig, stateDiffs, priorState, origins);
   * ```
   *
   * ## Notes
   * - It is crucial that `ManagedPath` is set up correctly for accurate identifier extraction, especially when
   *   dealing with composite keys.
   * - Effective for cases where entities and their updates are represented in array form.
   * - The process ensures individual scrutiny and management of each element in the array.
   */
  protected async processArrayItems(
    config: ManagedPath,
    newState: EntitiesState,
    previousState: EntitiesState,
    differences: DetailedDiff,
    changeOrigins: string[],
    items: any[] = [],
    previousItems: any[] = []
  ): Promise<void> {
    this.log.trace(`processArrayItems`);

    for (let i = 0; i < items.length; i++) {
      const newItem = items[i];
      const itemId = Array.isArray(config.idAttribute)
        ? getCompositeKey(newItem, config.idAttribute)
        : newItem[config.idAttribute as string];

      const previousItem = previousItems.find((item) => {
        const previousItemId = Array.isArray(config.idAttribute)
          ? getCompositeKey(item, config.idAttribute)
          : item[config.idAttribute as string];
        return previousItemId === itemId;
      });

      await this.processSingleItem(
        config,
        itemId,
        newState,
        previousState,
        differences,
        changeOrigins,
        newItem,
        previousItem
      );

      // Add a sleep after every 100 items to prevent overwhelming the system
      if ((i + 1) % 100 === 0 && i < items.length - 1) {
        this.log.debug(`Processed 100 items, pausing for 1 second before continuing...`);
        await workflow.sleep(2500);
      }
    }
  }

  /**
   * Processes a single entity item, managing workflows based on its state changes.
   *
   * This method oversees the handling of a specific item within the entity state,
   * determining if workflow actions are required due to state changes or workflow presence.
   *
   * @protected
   * @async
   * @param {ManagedPath} config - Configuration details specific to this entity's path, guiding processing actions.
   * @param {string} itemId - The identifier for the item being processed, which may be part of a composite key.
   * @param {EntitiesState} newState - The state object reflecting current entity data after applying updates.
   * @param {EntitiesState} previousState - The state of the entity before recent changes were applied.
   * @param {DetailedDiff} differences - Object encapsulating differences between the new and previous states to aid decision-making.
   * @param {string[]} changeOrigins - A list of identifiers representing the origin of changes to avoid recursive updates.
   * @param {any} newItem - The current state of the item being processed.
   * @param {any} previousItem - The previous state of the item being processed.
   * @returns {Promise<void>} A promise indicating when the processing of the single item is complete.
   */
  protected async processSingleItem(
    config: ManagedPath,
    itemId: string,
    newState: EntitiesState,
    previousState: EntitiesState,
    differences: DetailedDiff,
    changeOrigins: string[],
    newItem: any,
    previousItem: any
  ): Promise<void> {
    this.log.trace(`processSingleItem(${itemId})`);

    const compositeId = Array.isArray(config.idAttribute)
      ? getCompositeKey(newState[config.entityName as string][itemId], config.idAttribute)
      : itemId;

    if (!itemId) {
      this.log.warn(`No itemId found for ${config.entityName} with id ${compositeId}`);
      return;
    }

    const workflowId = config.includeParentId
      ? `${config.entityName}-${compositeId}-${this.id}`
      : `${config.entityName}-${compositeId}`;

    if (this.ancestorWorkflowIds.includes(workflowId)) {
      this.log.warn(`Circular dependency detected for workflowId: ${workflowId}. Skipping child workflow start.`);
      return;
    }

    if (changeOrigins.includes(workflowId)) {
      this.log.trace(`Skipping recursive update...`);
      return;
    }

    const existingHandle = this.handles.get(workflowId);
    const hasStateChanged = !isEqual(previousItem, newItem);

    if (hasStateChanged || !existingHandle) {
      if (existingHandle && 'result' in existingHandle) {
        await this.updateChildWorkflow(config, existingHandle, newItem, newState, previousState, differences);
      } else if (!existingHandle && !isEmpty(differences)) {
        await this.startChildWorkflow(config, itemId, workflowId, newItem, newState);
      }
    }
  }

  /**
   * Configures the managed paths for entity processing based on a given parent schema.
   *
   * This function initializes the `managedPaths` with details extracted from a defined
   * parent schema, setting up configuration for handling nested entity paths and their
   * associated workflows.
   *
   * ## Parameters
   * - `parentSchema`: The schema object that includes a nested `schema` property specifying child schemas.
   *   Each child schema must define `_idAttribute` and `_key` for configuration.
   *
   * ## Return
   * - This function does not return a value but populates the `managedPaths` property.
   *
   * ## Method Details
   * - Logs a debug message to record the initiation of managed path configuration, providing context on the entity.
   * - Validates the existence of a `schema` property within the `parentSchema`, throwing an error if absent.
   * - Iterates over the child schemas described within `parentSchema.schema`, processing each to populate `managedPaths`:
   *   - Determines if the schema represents an array to set the `isMany` property.
   *   - Configures individual path settings, including the path, identifier attribute, workflow type, auto-start settings,
   *     and entity name, combining these with any pre-existing configurations from `managedPaths`.
   *
   * ## Usage Example
   * ```typescript
   * configureManagedPaths(entityParentSchema);
   * ```
   *
   * ## Notes
   * - Assumes that each child schema provides essential attributes (`_idAttribute` and `_key`) for managing workflows.
   * - The method relies on the structure provided by `parentSchema` to accurately configure management paths
   *   necessary for processing entity states.
   */
  protected configureManagedPaths(
    parentSchema: Schema & { schema?: { [key: string]: Schema & [{ _idAttribute: string; _key: string }] } }
  ): void {
    this.log.trace(`configureManagedPaths`);
    if (!parentSchema.schema) {
      throw new Error("The provided schema does not have 'schema' defined.");
    }

    const defaultSubscriptionConfig = {
      enabled: true,
      sync: false,
      strategy: '$merge' as '$merge' | '$set',
      selector: '*'
    };

    const defaultManagedPathConfig = {
      autoStart: typeof this.options?.children?.autoStart === 'boolean' ? this.options?.children?.autoStart : true,
      strategy: '$merge' as '$merge' | '$set',
      subscriptions: {
        update: defaultSubscriptionConfig,
        delete: defaultSubscriptionConfig
      }
    };

    const childSchemas = parentSchema.schema;
    for (const [path, _schema] of Object.entries(childSchemas)) {
      const schema = _schema instanceof Array ? _schema[0] : _schema;
      this.managedPaths[path] = {
        ...defaultManagedPathConfig,
        path,
        idAttribute: schema._idAttribute,
        workflowType: `${schema._key}Workflow`,
        entityName: schema._key,
        isMany: _schema instanceof Array,
        ...(this.managedPaths[path] || {}), // Allow overrides from existing config
        // Ensure subscriptions are properly merged with defaults
        subscriptions: {
          update: { ...defaultSubscriptionConfig, ...(this.managedPaths[path]?.subscriptions?.update || {}) },
          delete: { ...defaultSubscriptionConfig, ...(this.managedPaths[path]?.subscriptions?.delete || {}) }
        }
      };
    }
  }

  /**
   * Initiates a child workflow based on the provided configuration and state data.
   *
   * This method handles the creation and initialization of child workflows according to the
   * specified managed path configuration. It processes entity data, constructs appropriate
   * workflow parameters, and manages the lifecycle of child workflows within the parent context.
   *
   * @param {ManagedPath} config - Configuration object that defines workflow behavior and entity relationships.
   *   Contains settings such as workflow type, entity name, ID attributes, and execution policies.
   * @param {any} state - The current state of the entity that will be used to initialize the child workflow.
   * @param {any} newState - The complete state context in which the child workflow will operate.
   * @returns {Promise<void>} A promise that resolves when the child workflow has been successfully started
   *   or when the start operation has been appropriately handled (e.g., when autoStart is disabled).
   *
   * @throws Will propagate errors from workflow creation, though these are caught internally
   *   and logged for diagnostic purposes.
   *
   * ## Key Features
   * - Supports conditional workflow initialization based on entity state
   * - Configurable retry policies for resilient workflow execution
   * - Flexible ID generation for workflow instances
   * - Customizable timeout and cancellation behaviors
   * - Automatic parent-child relationship management
   *
   * ## Configuration Options
   * - **workflowType**: Defines the type of workflow to be started
   * - **entityName**: Specifies the entity type being managed
   * - **idAttribute**: Identifies which property(s) to use as the entity's unique identifier
   * - **cancellationType**: Controls how child workflows respond to cancellation requests
   * - **parentClosePolicy**: Determines child workflow behavior when parent closes
   * - **retry**: Configures the retry strategy for workflow execution
   *
   * ## Usage Example
   * ```typescript
   * await startChildWorkflow(managedConfig, itemState, completeState);
   * ```
   *
   * ## Notes
   * - Assumes the presence of entity and workflow management support within the system
   * - Handles asynchronous operations with comprehensive error handling for fault tolerance
   * - Provides detailed logging for workflow initialization and lifecycle events
   * - Respects autoStart and condition configurations to determine execution eligibility
   */
  protected async startChildWorkflow(
    config: ManagedPath,
    id: string,
    workflowId: string,
    newItem: any,
    newState: any
  ): Promise<void> {
    try {
      if (id === undefined && typeof newItem === 'string') {
        id = newItem;
        newItem = newState[config.entityName as string][newItem];
      }

      const {
        workflowType,
        entityName,
        cancellationType = workflow.ChildWorkflowCancellationType.WAIT_CANCELLATION_REQUESTED,
        parentClosePolicy = workflow.ParentClosePolicy.TERMINATE,
        workflowIdConflictPolicy = workflow.WorkflowIdConflictPolicy.TERMINATE_EXISTING,
        workflowIdReusePolicy = workflow.WorkflowIdReusePolicy.ALLOW_DUPLICATE,
        workflowTaskTimeout = 30000,
        startDelay = 1000,
        startToCloseTimeout = '30 days',
        retry = {
          initialInterval: 1000 * 1,
          maximumInterval: 1000 * 20,
          backoffCoefficient: 1.5,
          maximumAttempts: 30
        }
      } = config;

      this.log.trace(
        `startChildWorkflow( path=${config.path}, entityName=${entityName}, id=${id}, workflowType=${workflowType}, data: ${JSON.stringify(newItem, null, 2)} )`
      );

      const data =
        typeof config.processData === 'function'
          ? config.processData(
              limitRecursion(id, String(entityName), newState, this.stateManager),
              limitRecursion(this.id, this.entityName, newState, this.stateManager)
            )
          : newItem;

      if (typeof config.condition === 'function') {
        if (!config.condition.apply(this, [newItem, this])) {
          this.log.trace(`Condition returned false, not starting child.`);
          return;
        }
      }

      // Create subscriptions based on config
      const subscriptions: Subscription[] = [];

      if (config.subscriptions?.update?.enabled) {
        subscriptions.push({
          subscriptionId: `${this.entityName}:${this.id}.${config.path}:${id}`,
          workflowId: workflow.workflowInfo().workflowId,
          signalName: 'update',
          selector: config.subscriptions.update.selector ?? '*',
          parent: `${this.entityName}:${this.id}`,
          child: `${config.entityName}:${id}`,
          ancestorWorkflowIds: [...this.ancestorWorkflowIds],
          sync: config.subscriptions.update.sync,
          strategy: config.subscriptions.update.strategy
        });
      }

      if (config.subscriptions?.delete?.enabled) {
        subscriptions.push({
          subscriptionId: `${this.entityName}:${this.id}.${config.path}:${id}:delete`,
          workflowId: workflow.workflowInfo().workflowId,
          signalName: 'delete',
          selector: config.subscriptions.delete.selector ?? '*',
          parent: `${this.entityName}:${this.id}`,
          child: `${config.entityName}:${id}`,
          ancestorWorkflowIds: [...this.ancestorWorkflowIds],
          sync: config.subscriptions.delete.sync,
          strategy: config.subscriptions.delete.strategy
        });
      }

      const startPayload = {
        workflowId,
        cancellationType,
        parentClosePolicy,
        workflowIdConflictPolicy,
        workflowIdReusePolicy,
        startToCloseTimeout,
        workflowTaskTimeout,
        startDelay,
        args: [
          {
            id,
            state: normalizeEntities(data, SchemaManager.getInstance().getSchema(entityName as string)),
            entityName,
            subscriptions,
            apiToken: this.apiToken,
            ancestorWorkflowIds: [...this.ancestorWorkflowIds, workflow.workflowInfo().workflowId],
            startDelay
          }
        ],
        retry
      };

      const handle = await workflow.startChild(String(workflowType), startPayload);
      this.handles.set(workflowId, handle);

      if (this.listenerCount(`child:${entityName}:started`) > 0) {
        await this.emitAsync(`child:${entityName}:started`, { ...config, workflowId, data, handle });
      }

      Promise.resolve()
        .then(() => handle.result())
        .then(async (result) => {
          await this.emitAsync(`child:${entityName}:completed`, { ...config, workflowId, result });
        })
        .catch(async (error) => {
          if (
            workflow.isCancellation(error) &&
            this.status !== 'cancelled' &&
            this.status !== 'cancelling' &&
            this.handles.has(workflowId)
          ) {
            // Add check to see if handle still exists
            this.log.info(`Restarting child workflow due to cancellation...`);
            Promise.resolve()
              .then(() =>
                this.startChildWorkflow(
                  config,
                  id,
                  workflowId,
                  this.stateManager.query(String(entityName), id, false),
                  this.state
                )
              )
              .catch((retryError) => {
                this.log.error(`Retry failed: ${retryError.message}`);
              });
          } else {
            this.log.error(`Child workflow error: ${error.message}\n${error.stack}`);

            await this.emitAsync(`child:${entityName}:errored`, { ...config, workflowId, error });
          }
        });
    } catch (err) {
      if (err instanceof Error) {
        this.log.error(`Failed to start new child workflow: ${err.message}\n${err.stack}`);
      } else {
        this.log.error(`An unknown error occurred while starting a new child workflow`);
      }
      throw err;
    }
  }

  /**
   * Updates an existing child workflow with new state information.
   *
   * This method handles the propagation of state changes from the parent workflow to its child workflows.
   * It processes the differences between previous and new states, and signals the appropriate updates
   * to the child workflow based on configuration settings.
   *
   * @param {workflow.ChildWorkflowHandle<any>} handle - The handle to the child workflow to update.
   * @param {any} previousItem - The previous state of the item associated with the child workflow.
   * @param {any} previousState - The previous overall state context.
   * @param {any} newItem - The updated state of the item associated with the child workflow.
   * @param {any} newState - The updated overall state context.
   * @param {DetailedDiff} differences - The detailed differences between previous and new states.
   * @param {ManagedPath} config - Configuration for the managed path that defines update behavior.
   * @returns {Promise<void>} A promise that resolves when the update operation is complete.
   *
   * @throws Will propagate errors from workflow signaling operations, though these are caught
   *   internally and logged for diagnostic purposes.
   *
   * ## Key Features
   * - Conditional updates based on configuration settings
   * - Support for different update strategies (merge vs. replace)
   * - Intelligent handling of entity relationships
   * - Detailed logging of update operations
   *
   * ## Update Process
   * 1. Validates update eligibility based on autoStart and condition settings
   * 2. Extracts entity ID and prepares update payload
   * 3. Processes data through optional transformation functions
   * 4. Signals the child workflow with the update
   * 5. Handles any errors that occur during the update process
   *
   * ## Configuration Options
   * - **subscriptions.update.strategy**: Determines how updates are applied ('$set' or '$merge')
   * - **subscriptions.update.sync**: Controls whether updates are processed synchronously
   * - **processData**: Optional function to transform data before sending to child workflow
   *
   * ## Notes
   * - Update operations respect the subscription configuration in the managed path
   * - Provides comprehensive error handling with detailed logging
   * - Supports custom data transformation through the processData function
   */
  protected async updateChildWorkflow(
    config: ManagedPath,
    handle: workflow.ChildWorkflowHandle<any>,
    newItem: any,
    newState: any,
    previousState: any,
    differences: DetailedDiff
  ): Promise<void> {
    this.log.trace(`updateChildWorkflow`);
    try {
      const { entityName } = config;

      const updateConfig = this.options.children?.update || {};
      const deleteConfig = this.options.children?.delete || { enabled: false };

      if (updateConfig.enabled === false && deleteConfig.enabled === false) {
        this.log.debug(
          `Child updates are disabled for workflowId: ${handle.workflowId}. Skipping child workflow update.`
        );
        return;
      }

      if (typeof config.condition === 'function') {
        if (!config.condition.apply(this, [newItem, this])) {
          this.log.trace(`Condition returned false, not updating child.`);
          return;
        }
      }

      const { updates, deletions } = this.extractChangesForSelector(differences, '*', newState, previousState);

      if (!isEmpty(updates) && (updateConfig.enabled || updateConfig.enabled === undefined)) {
        this.log.trace(
          `Signaling update to child workflow: ${handle.workflowId} \n ${JSON.stringify(updates, null, 2)}`
        );

        const updateSignalPayload: any = {
          updates: Object.entries(updates).reduce(
            (acc, [entityName, entities]) => {
              acc[entityName] = Object.entries(entities).reduce(
                (entityAcc, [id, entity]) => {
                  entityAcc[id] = { id, ...entity }; // Add id back into entity
                  return entityAcc;
                },
                {} as Record<string, any>
              );
              return acc;
            },
            {} as Record<string, any>
          ),
          changeOrigin: workflow.workflowInfo().workflowId
        };

        if (typeof updateConfig.strategy === 'string' && updateConfig.strategy !== '$merge') {
          updateSignalPayload.strategy = updateConfig.strategy;
        }
        if (typeof updateConfig.sync === 'boolean') {
          updateSignalPayload.sync = updateConfig.sync;
        }

        await handle.signal('update', updateSignalPayload);
      }

      if (!isEmpty(deletions) && (deleteConfig.enabled || deleteConfig.enabled === undefined)) {
        this.log.trace(
          `Signaling delete to child workflow: ${handle.workflowId}\n ${JSON.stringify(deletions, null, 2)}`
        );
        const deleteSignalPayload: any = {
          deletions,
          changeOrigin: workflow.workflowInfo().workflowId
        };

        if (typeof deleteConfig.sync === 'boolean') {
          deleteSignalPayload.sync = deleteConfig.sync;
        }

        await handle.signal('delete', deleteSignalPayload);
      }

      if (this.listenerCount(`child:${entityName}:updated`) > 0)
        await this.emitAsync(`child:${entityName}:updated`, {
          ...config,
          workflowId: handle.workflowId,
          data: newItem,
          changeOrigin: workflow.workflowInfo().workflowId,
          differences
        });
    } catch (err) {
      if (err instanceof Error) {
        this.log.error(`Failed to signal existing workflow handle: ${err.message}`);
      } else {
        this.log.error(`An unknown error occurred while signaling the child workflow`);
      }
    }
  }

  /**
   * Cancels a running child workflow.
   *
   * This method safely terminates a child workflow by removing its handle from internal tracking
   * and sending a cancellation signal. It includes error handling to ensure the parent workflow
   * continues execution even if cancellation encounters issues.
   *
   * @param {workflow.ChildWorkflowHandle<any>} handle - The handle to the child workflow to be cancelled.
   * @returns {Promise<void>} A promise that resolves when the cancellation operation is complete.
   *
   * @throws Will catch and log any errors that occur during the cancellation process without
   *   propagating them to the caller.
   *
   * ## Key Features
   * - Safe removal of workflow handle from internal tracking
   * - Graceful error handling during cancellation
   * - Detailed logging of cancellation operations
   *
   * ## Cancellation Process
   * 1. Logs the cancellation attempt for traceability
   * 2. Removes the workflow handle from internal tracking to prevent restart attempts
   * 3. Obtains an external workflow handle for the target workflow
   * 4. Sends the cancellation signal to the workflow
   * 5. Catches and logs any errors that occur during the process
   *
   * ## Usage Example
   * ```typescript
   * await cancelChildWorkflow(activeHandle);
   * ```
   *
   * ## Notes
   * - Ensures the workflow handle is valid before attempting cancellation
   * - Removes the handle from tracking before cancellation to prevent restart attempts
   * - Provides detailed error logging to aid in debugging cancellation issues
   * - Uses the external workflow handle mechanism for cancellation operations
   */
  protected async cancelChildWorkflow(handle: workflow.ChildWorkflowHandle<any>) {
    this.log.trace(`Cancelling child workflow: ${handle.workflowId}`);
    try {
      if (handle) {
        // Remove the handle from the handles map before cancellation, so we don't try to restart it
        this.handles.delete(handle.workflowId);

        const extHandle = workflow.getExternalWorkflowHandle(handle.workflowId);
        await extHandle.cancel();
      }
    } catch (error: any) {
      this.log.error(`Failed to cancel from workflow handle: ${(error as Error).message}`);
    }
  }

  /**
   * Handles workflow continuation when maximum iterations are reached.
   *
   * This method manages the transition to a new workflow instance when the current instance
   * reaches its iteration limit. It ensures all handlers have completed their work before
   * initiating the continuation process, and supports both custom and default continuation methods.
   *
   * @returns {Promise<void>} A promise that resolves when the continuation process is complete.
   *
   * @throws May throw errors if the continuation process fails, though these are typically
   *   handled by the Temporal workflow engine.
   *
   * ## Key Features
   * - Supports custom continuation methods via _continueAsNewMethod or continueAsNewHandler
   * - Ensures all handlers have finished before continuation
   * - Preserves workflow state, status, and subscriptions during transition
   * - Maintains workflow metadata such as memo and search attributes
   *
   * ## Continuation Process
   * 1. Identifies the appropriate continuation method (custom or default)
   * 2. Waits for all workflow handlers to complete their execution
   * 3. If a custom continuation method exists, invokes it directly
   * 4. Otherwise, creates a continuation function with the current workflow configuration
   * 5. Executes the continuation with the current workflow state and parameters
   *
   * ## Usage Example
   * ```typescript
   * await handleMaxIterations();
   * ```
   *
   * ## Notes
   * - Uses workflow.condition to ensure all handlers have finished before continuation
   * - Preserves workflow context including state, status, and subscriptions
   * - Maintains workflow metadata such as memo and search attributes
   * - Uses type assertions to access internal properties due to TypeScript limitations
   */
  protected async handleMaxIterations(): Promise<void> {
    await workflow.condition(() => workflow.allHandlersFinished(), '30 seconds');

    const continueFn = workflow.makeContinueAsNewFunc({
      workflowType: String(this.options.workflowType),
      memo: workflow.workflowInfo().memo,
      searchAttributes: workflow.workflowInfo().searchAttributes
    });

    // Default parameters for continue-as-new
    const defaultParams = {
      state: this.state,
      status: this.status,
      subscriptions: this.subscriptions,
      ...Object.keys(this.params).reduce(
        (params, key: string) => ({
          ...params, // @ts-ignore
          [key]: this[key]
        }),
        {}
      )
    };

    // If onContinue is defined, call it to get custom parameters, otherwise use defaults
    if (typeof this.onContinue === 'function') {
      const customParams = await this.onContinue();
      await continueFn(customParams || defaultParams);
    } else {
      await continueFn(defaultParams);
    }
  }

  /**
   * Loads data from an external source and enqueues it for state updates.
   *
   * This method invokes the workflow's loadData method (if defined) to fetch data from external
   * sources, then processes and normalizes that data before dispatching it to the state manager.
   * It supports both direct data objects and pre-normalized updates.
   *
   * @returns {Promise<void>} A promise that resolves when the data loading and enqueueing process is complete.
   *
   * @throws May propagate errors from the loadData method if they occur during data fetching.
   *
   * ## Key Features
   * - Conditional execution based on the existence of a loadData method
   * - Support for both raw data objects and pre-normalized updates
   * - Configurable update strategy ('$merge' by default)
   * - Intelligent handling of empty or missing data
   *
   * ## Data Loading Process
   * 1. Checks if the workflow implements a loadData method
   * 2. Invokes the loadData method to fetch external data
   * 3. Extracts data, updates, and strategy from the result
   * 4. Normalizes raw data into entity updates if needed
   * 5. Dispatches the updates to the state manager with the specified strategy
   *
   * ## Expected loadData Return Format
   * ```typescript
   * {
   *   data?: Record<string, any>,    // Raw data object to be normalized
   *   updates?: EntitiesState,       // Pre-normalized entity updates
   *   strategy?: '$set' | '$merge'   // Update strategy to apply
   * }
   * ```
   *
   * ## Usage Example
   * ```typescript
   * await loadDataAndEnqueue();
   * ```
   *
   * ## Notes
   * - Skips state updates if both data and updates are empty or undefined
   * - Uses the entity's schema for data normalization
   * - Logs debugging information about the data loading process
   * - Uses type assertions to handle TypeScript limitations
   */
  protected async loadDataAndEnqueue(): Promise<void> {
    if (typeof this?.loadData === 'function') {
      let { data, updates, strategy = '$merge' } = await this.loadData();
      if (!data && !updates) {
        this.log.debug(`No data or updates returned from loadData(), skipping state change...`);
        return;
      }
      if (data && !updates) {
        updates = normalizeEntities(data, this.entityName);
      }

      if (updates) {
        await this.stateManager.dispatch(updateNormalizedEntities(updates, strategy), false);
      }
    }
  }

  /**
   * Binds class properties based on metadata decorators.
   *
   * This method configures property accessors (getters and setters) for class properties
   * that have been decorated with metadata. It supports memoization, path-based access,
   * and custom property behaviors defined through decorators.
   *
   * @returns {Promise<void>} A promise that resolves when all properties have been bound.
   *
   * ## Key Features
   * - Metadata-driven property configuration
   * - Support for memoized properties
   * - Path-based property access using dot notation
   * - Configurable property behaviors (get/set/enumerable)
   *
   * ## Property Binding Process
   * 1. Invokes the parent class's bindProperties method
   * 2. Collects property metadata from class decorators
   * 3. Iterates through each property with metadata
   * 4. Configures getters and setters based on metadata options
   * 5. Handles special cases like memoization and path-based access
   *
   * ## Supported Metadata Options
   * - **memo**: Enables property memoization with an optional key
   * - **path**: Specifies a dot-notation path for accessing nested data
   * - **get/set**: Controls whether getters/setters are created
   * - **enumerable**: Controls property visibility during enumeration
   *
   * ## Usage Example
   * ```typescript
   * await bindProperties();
   * ```
   *
   * ## Notes
   * - Uses the dottie library for path-based property access
   * - Stores memoized values in the _memoProperties object
   * - Supports both direct property access and path-based access
   * - Designed to work with the Property decorator from the decorators module
   */
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
              this.pendingIteration = true;
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

  /**
   * Binds action methods to workflow handlers based on metadata decorators.
   *
   * This method configures workflow action handlers for methods that have been decorated
   * with action metadata. It sets up the execution context, validation, and behavior
   * policies for each action method.
   *
   * @returns {Promise<void>} A promise that resolves when all actions have been bound.
   *
   * ## Key Features
   * - Metadata-driven action configuration
   * - Automatic validation of action inputs
   * - Prevention of redundant action binding
   * - Configurable handler unfinished policies
   *
   * ## Action Binding Process
   * 1. Checks if actions have already been bound to prevent redundancy
   * 2. Collects action metadata from class decorators
   * 3. Retrieves associated validators for input validation
   * 4. Iterates through each action with metadata
   * 5. Configures workflow handlers with appropriate execution policies
   * 6. Marks actions as bound to prevent future rebinding
   *
   * ## Handler Configuration
   * - **method**: The class method to be executed when the action is triggered
   * - **validator**: Optional function to validate action inputs
   * - **unfinishedPolicy**: Policy for handling unfinished actions (defaults to ABANDON)
   *
   * ## Usage Example
   * ```typescript
   * await bindActions();
   * ```
   *
   * ## Notes
   * - Triggered automatically during workflow initialization via the @On('init') decorator
   * - Uses the ACTIONS_METADATA_KEY and VALIDATOR_METADATA_KEY for metadata access
   * - Sets the HandlerUnfinishedPolicy.ABANDON as the default unfinished policy
   * - Prevents multiple bindings of the same actions through the _actionsBound flag
   */
  @On('init')
  protected async bindActions() {
    if (this._actionsBound) {
      return;
    }

    const actions: ActionMetadata[] = Reflect.getMetadata(ACTIONS_METADATA_KEY, this.constructor.prototype) || [];
    const validators = Reflect.getMetadata(VALIDATOR_METADATA_KEY, this.constructor.prototype) || {};

    for (const { method } of actions) {
      const methodName = method;
      const updateOptions: UpdateHandlerOptions<any[]> = {};
      const validatorMethod = validators[methodName];
      if (validatorMethod) {
        updateOptions.validator = (this as any)[validatorMethod].bind(this);
      }
      updateOptions.unfinishedPolicy = HandlerUnfinishedPolicy.ABANDON;

      workflow.setHandler(
        workflow.defineUpdate<any, any>(method),
        (input: any) => this.runAction(methodName, input),
        updateOptions
      );
    }

    this._actionsBound = true;
  }

  /**
   * Binds event handlers to workflow and state manager events based on metadata decorators.
   *
   * This method configures event listeners for methods that have been decorated with event
   * metadata. It sets up handlers for both workflow-level events and state manager events,
   * ensuring that decorated methods are called when the corresponding events are emitted.
   *
   * @returns {Promise<void>} A promise that resolves when all event handlers have been bound.
   *
   * ## Key Features
   * - Metadata-driven event handler configuration
   * - Support for both workflow and state manager events
   * - Prevention of redundant event handler binding
   * - Asynchronous event handling with Promise resolution
   *
   * ## Event Binding Process
   * 1. Checks if event handlers have already been bound to prevent redundancy
   * 2. Collects event metadata from class decorators
   * 3. Iterates through each event handler with metadata
   * 4. Determines the appropriate event emitter (workflow or state manager)
   * 5. Registers event listeners with proper event names
   * 6. Marks event handlers as bound to prevent future rebinding
   *
   * ## Event Handler Configuration
   * - **event**: The event name to listen for (prefixed with 'state:' for state manager events)
   * - **method**: The class method to be executed when the event is triggered
   *
   * ## Usage Example
   * ```typescript
   * await bindEventHandlers();
   * ```
   *
   * ## Notes
   * - Events prefixed with 'state:' are bound to the state manager
   * - Other events are bound to the workflow instance itself
   * - Event handlers are executed asynchronously with Promise resolution
   * - Prevents multiple bindings of the same handlers through the _eventsBound flag
   */
  protected async bindEventHandlers() {
    if (this._eventsBound) {
      return;
    }

    const eventHandlers = this.collectMetadata(EVENTS_METADATA_KEY, this.constructor.prototype);
    eventHandlers.forEach((handler: { event: string; method: string }) => {
      (handler.event.startsWith('state:') ? this.stateManager : this).on(
        handler.event.replace(/^state:/, ''),
        async (...args: any[]) => {
          if (typeof (this as any)[handler.method] === 'function') {
            // Use consistent Promise handling
            await Promise.resolve().then(() => (this as any)[handler.method](...args));
          }
        }
      );
    });

    this._eventsBound = true;
  }

  /**
   * Executes an action method within the workflow with concurrency control.
   *
   * This method provides a controlled execution environment for workflow actions,
   * ensuring that actions don't overlap and that the workflow state is properly
   * managed before, during, and after action execution.
   *
   * @param {keyof StatefulWorkflow<any, any>} methodName - The name of the method to execute.
   * @param {any} input - The input data to pass to the action method.
   * @returns {Promise<any>} A promise that resolves with the result of the action method
   *   or rejects with any error that occurred during execution.
   *
   * @throws Will propagate any errors thrown by the action method after logging them.
   *
   * ## Key Features
   * - Concurrency control to prevent overlapping action executions
   * - Comprehensive error handling and logging
   * - Automatic state management before and after execution
   * - Support for any action method defined on the workflow
   *
   * ## Execution Process
   * 1. Sets the actionRunning flag to prevent concurrent executions
   * 2. Attempts to execute the specified method with the provided input
   * 3. Logs any errors that occur during execution
   * 4. Sets the pendingUpdate flag to trigger state processing
   * 5. Resets the actionRunning flag when execution completes
   *
   * ## Usage Example
   * ```typescript
   * const result = await runAction('processItem', itemData);
   * ```
   *
   * ## Notes
   * - Used internally by the workflow handler system
   * - Ensures actions are executed in a controlled manner
   * - Provides consistent error handling for all action methods
   * - Sets pendingUpdate to true to ensure state is processed after action execution
   */
  protected async runAction(methodName: keyof StatefulWorkflow<any, any>, input: any): Promise<any> {
    this.actionRunning = true;
    let result: any;
    let error: any;

    try {
      result = await (this[methodName] as (input: any) => any).call(this, input);
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
      return Promise.reject(!(error instanceof Error) ? new Error(error) : error);
    }
    return result !== undefined ? result : this.data;
  }

  /**
   * Cleans up event listeners to prevent memory leaks in the shared V8 VM.
   *
   * This method should be called before a workflow completes or during continueAsNew
   * to ensure that event listeners don't persist between workflow executions in the
   * shared VM environment.
   *
   * ## Cleanup actions:
   * - Removes the stateChanged listener from the stateManager
   * - Cleans up the StateManager (cache, state, event listeners)
   * - Calls the parent class cleanup method
   * - Resets StatefulWorkflow-specific flags
   *
   * @returns {void}
   */
  protected cleanup(): void {
    try {
      this._actionsBound = false;

      if (this.stateManager) {
        this.stateManager.removeListener('stateChange', this.stateChanged.bind(this));
        this.stateManager.cleanup();
      }

      this.selectorPatternCache.clear();
      this.subscriptionHandles.clear();
      this.ancestorHandles.clear();

      super.cleanup();
    } catch (error) {
      this.log.error(`Error cleaning up event listeners: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
