/* eslint-disable @typescript-eslint/ban-ts-comment */
import * as workflow from '@temporalio/workflow';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { normalizeEntities, reducer, EntitiesState, UPDATE_ENTITIES, DELETE_ENTITIES } from '../utils/entities';
import { detailedDiff, DetailedDiff, diff } from 'deep-object-diff';
import { schema, denormalize, Schema } from 'normalizr';
import dottie, { get, set, flatten, transform } from 'dottie';
import isEmpty from 'lodash.isempty';
import isEqual from 'lodash.isequal';
import { startChildPayload } from '../utils/startChildPayload';
import { Workflow, Signal, Query, Hook, Before, After, Property, Condition, Step, ContinueAsNew } from './Workflow';
import { SchemaManager } from '../SchemaManager';

export type ManagedPath = {
  entityName?: string;
  path?: string;
  workflowType?: string;
  idAttribute?: string;
  autoStartChildren?: boolean;
};

export type ManagedPaths = {
  [path: string]: ManagedPath;
};

export type Subscription = {
  workflowId: string; // ID of the subscribing workflow
  signalName: string; // Signal name to be triggered on matching change
  selector: string; // Selector for matching state changes; can contain wildcards
  parent?: string; // Workflow ID of the parent workflow, if applicable
  child?: string; // Workflow ID of the child workflow, if applicable
  ancestorWorkflowIds?: string[]; // List of ancestor workflow IDs to avoid recursive loops
  condition?: (state: any) => boolean; // Optional: A custom condition function that decides whether to propagate the signal.
  entityName?: string; // Optional: The entity name related to this subscription.
  subscriptionId?: string; // Unique identifier for this subscription to distinguish multiple subscriptions to the same workflow.
};

export type Entities = {
  [entityName: string]: Schema;
};

export type StatefulWorkflowParams = {
  id: string;
  entityName: string;
  data?: Record<string, any>;
  state?: EntitiesState;
  status: string;
  apiUrl?: string;
  apiToken?: string;
  subscriptions?: Subscription[];
};

export type PendingChange = {
  updates?: Record<string, any>;
  deletions?: Record<string, any>;
  entityName: string;
  strategy?: '$set' | '$merge';
};

export abstract class StatefulWorkflow extends Workflow {
  private schema: Schema;

  protected async condition(): Promise<any> {
    this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:awaitCondition`);
    return await workflow.condition(() => this.pendingUpdate || !!this.pendingChanges.length || this.status !== 'running', '1 day');
  }

  protected loadData?: () => Promise<any>;
  protected shouldLoadData(): boolean {
    return typeof this.loadData === 'function';
  }
  protected abstract execute(...args: unknown[]): Promise<unknown>;

  protected continueAsNew: boolean = true;
  protected async continueAsNewHandler(): Promise<void> {}

  @Property({ set: false })
  protected apiToken?: string;

  @Signal('apiToken')
  public setApiToken(apiToken: string): void {
    this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:setApiToken`);
    if (apiToken && this.apiToken !== apiToken) {
      this.log.info(`Updating apiToken...`);
      this.apiToken = apiToken;
      this.pendingUpdate = true;
    }
  }

  @Property({ set: false })
  protected id: string;

  @Property({ set: false })
  protected entityName: string;

  @Property({ set: false })
  protected state: EntitiesState = {};

  @Property({ set: false })
  protected pendingChanges: PendingChange[] = [];

  @Property({ set: false })
  protected subscriptions: Subscription[] = [];

  @Property({ set: false })
  protected managedPaths: ManagedPaths = {};

  @Property()
  protected apiUrl?: string;

  protected ancestorWorkflowIds: string[] = []; // Keeps track of ancestor workflows to prevent circular relationships

  constructor(
    protected params: StatefulWorkflowParams,
    protected options: { schema?: schema.Entity } = {}
  ) {
    super(params);

    this.state = params?.state as EntitiesState;
    this.status = params?.status ?? 'running';
    this.id = params.id;
    this.entityName = params.entityName;

    this.schema = params.entityName
      ? (SchemaManager.getInstance().getSchema(params.entityName) as schema.Entity)
      : (options.schema as schema.Entity);

    if (params?.data && !isEmpty(params?.data)) {
      this.pendingChanges.push({
        updates: normalizeEntities(params.data, this.schema),
        entityName: this.entityName,
        strategy: '$merge'
      });
      this.pendingUpdate = true;
    }

    this.apiUrl = params.apiUrl;
    this.apiToken = params.apiToken;

    if (params?.subscriptions) {
      for (const subscription of params.subscriptions) {
        this.subscribe(subscription);
      }
    }
  }

  protected async executeWorkflow(): Promise<any> {
    this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:executeWorkflow`);
    return new Promise(async (resolve, reject) => {
      await this.tracer.startActiveSpan(`[StatefulWorkflow]:${this.constructor.name}:executeWorkflow`, async (span) => {
        if (this.schema) this.configureManagedPaths(this.schema);
        try {
          span.setAttributes({ workflowId: workflow.workflowInfo().workflowId, workflowType: workflow.workflowInfo().workflowType });

          while (this.iteration <= this.maxIterations) {
            this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:executeWorkflow:execute`);
            await this.tracer.startActiveSpan(`[StatefulWorkflow]:${this.constructor.name}:executeWorkflow:execute`, async (executeSpan) => {
              executeSpan.setAttributes({
                workflowId: workflow.workflowInfo().workflowId,
                workflowType: workflow.workflowInfo().workflowType,
                iteration: this.iteration
              });

              await this.condition();

              if (this.status === 'paused') {
                await this.handlePause();
              } else if (this.status === 'cancelled') {
                throw new Error(`Cancelled`);
              }

              if (this.shouldLoadData()) {
                await this.loadDataAndEnqueueChanges();
              }

              this.result = await this.execute();

              if (this.isInTerminalState()) {
                executeSpan.end();
                span.end();
                return this.status !== 'errored' ? resolve(this.result) : reject(this.result);
              } else if (++this.iteration >= this.maxIterations) {
                await this.handleMaxIterations();
                executeSpan.end();
                span.end();
                resolve('Continued as a new workflow execution...');
              } else {
                this.pendingUpdate = false;
              }

              executeSpan.end();
            });
          }
        } catch (err) {
          await this.handleExecutionError(err, span, reject);
        }
        resolve(this.result);
      });
    });
  }

  @Signal()
  public update({ data, updates, entityName, strategy = '$merge' }: PendingChange & { data?: Record<string, any> }): void {
    this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:update`);

    if (!isEmpty(data)) {
      updates = normalizeEntities(data, entityName === this.entityName ? this.schema : SchemaManager.getInstance().getSchema(entityName));
    }
    this.pendingChanges.push({ updates, entityName, strategy });
    this.pendingUpdate = true;
  }

  @Signal()
  public delete({ deletions, entityName }: PendingChange): void {
    this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:delete`);
    this.pendingChanges.push({ deletions, entityName });
  }

  @Signal()
  public async subscribe(subscription: Subscription): Promise<void> {
    this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:subscribe`);
    const { workflowId, subscriptionId } = subscription;

    // Ensure unique subscription
    if (!this.subscriptions.find((sub) => sub.workflowId === workflowId && sub.subscriptionId === subscriptionId)) {
      this.subscriptions.push(subscription);
      this.handles[workflowId] = await workflow.getExternalWorkflowHandle(workflowId);
    }
  }

  @Signal()
  public async unsubscribe(subscription: Subscription): Promise<void> {
    this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:unsubscribe`);
    const { workflowId, subscriptionId } = subscription;

    // Remove the specific subscription
    const index = this.subscriptions.findIndex((sub) => sub.workflowId === workflowId && sub.subscriptionId === subscriptionId);
    if (index !== -1) {
      delete this.handles[workflowId];
      this.subscriptions.splice(index, 1);
    }
  }

  private async unsubscribeHandle(handle: workflow.ExternalWorkflowHandle | workflow.ChildWorkflowHandle<any>) {
    try {
      if ('cancel' in handle && typeof handle.cancel === 'function') {
        // Handle is an ExternalWorkflowHandle
        await handle.cancel();
      } else if ('terminate' in handle && typeof handle.terminate === 'function') {
        // Handle is a ChildWorkflowHandle
        await handle.terminate();
      }
      this.log.debug(`Successfully unsubscribed from workflow handle: ${handle.workflowId}`);
    } catch (error: any) {
      this.log.error(`Failed to unsubscribe from workflow handle: ${(error as Error).message}`);
    }
  }

  @Before('execute')
  protected async processState(): Promise<void> {
    this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:processState`);

    while (this.pendingChanges.length > 0) {
      const change = this.pendingChanges.shift();

      const previousState = this.state;
      const newState = reducer(this.state, {
        type: change?.deletions ? DELETE_ENTITIES : UPDATE_ENTITIES,
        entities: change?.deletions || change?.updates
      });

      if (newState) {
        const differences = detailedDiff(previousState, newState);

        if (!isEmpty(differences.added) || !isEmpty(differences.updated) || !isEmpty(differences.deleted)) {
          await this.processChildState(newState, differences, previousState || {});
          await this.processSubscriptions(newState, differences, previousState || {});

          this.state = newState;
          this.pendingUpdate = false;
        }
      }
    }
  }

  protected async processSubscriptions(newState: EntitiesState, differences: DetailedDiff, previousState: EntitiesState): Promise<void> {
    this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:processSubscriptions`);

    const flattenedState = dottie.flatten(newState);

    for (const { workflowId, signalName, selector, parent, child, condition, entityName, subscriptionId } of this.subscriptions) {
      // **First Check**: Ensure the current subscription should propagate updates (e.g., prevent circular propagation)
      if (!this.shouldPropagateUpdate(flattenedState, differences, selector, condition, workflowId, this.ancestorWorkflowIds)) {
        continue;
      }

      const handle = this.handles[workflowId];
      if (handle) {
        try {
          this.log.debug(
            `[StatefulWorkflow]:${this.constructor.name}:Sending update to workflow: ${workflowId}, Subscription ID: ${subscriptionId}`
          );
          await handle.signal(signalName, {
            updates: dottie.transform(flattenedState),
            entityName: entityName,
            subscriptionId: subscriptionId
          });
        } catch (err) {
          this.log.error(`Failed to signal workflow '${workflowId}': ${(err as Error).message}`);
        }
      }
    }
  }

  protected async handleUpdateSubscription(newState: EntitiesState, config: ManagedPath, item: any, itemDiff: any): Promise<void> {
    this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:handleUpdateSubscription`);

    const workflowId = `${config.entityName}-${item[config.idAttribute as string]}`;
    const handle = this.handles[workflowId];

    if (handle && 'result' in handle) {
      await this.updateChildWorkflow(handle as workflow.ChildWorkflowHandle<any>, item, config);
    }
  }

  protected getUpdatedDataForSubscription(newState: EntitiesState, selector: string): any {
    // Implement logic to extract updated data from the new state based on the selector
    return get(newState, selector);
  }

  protected async sendSubscriptionUpdate(workflowId: string, signalName: string, updatedData: any): Promise<void> {
    if (!this.handles[workflowId]) {
      this.handles[workflowId] = await workflow.getExternalWorkflowHandle(workflowId); // Fetch handle if not cached
    }

    // Send signal with the updated data to the workflow
    await this.handles[workflowId].signal(signalName, updatedData);
  }

  private isPathMatchingSelector(path: string, selector: string): boolean {
    const regex = new RegExp(`^${selector.replace(/\*/g, '.*')}$`); // Convert wildcard to regex
    return regex.test(path);
  }

  private shouldPropagateUpdate(
    flattenedState: Record<string, any>,
    differences: DetailedDiff,
    selector: string,
    condition?: (state: any) => boolean,
    sourceWorkflowId?: string,
    ancestorWorkflowIds: string[] = []
  ): boolean {
    this.log.debug(`[StatefulWorkflow]: Checking if we should propagate update for selector: ${selector}`);

    // Use RegExp to handle wildcard selectors
    const selectorRegex = new RegExp('^' + selector.replace(/\*/g, '.*') + '$');

    // Check if any flattened key matches the selector
    for (const key of Object.keys(flattenedState)) {
      if (selectorRegex.test(key)) {
        const selectedData = flattenedState[key];

        // If a custom condition is provided, use it
        if (condition && !condition(selectedData)) {
          this.log.debug(`Custom condition for selector ${selector} not met.`);
          continue; // Skip propagation if condition fails
        }

        // Check for ancestor workflow paths to prevent redundant loops
        if (sourceWorkflowId && ancestorWorkflowIds.includes(sourceWorkflowId)) {
          this.log.debug(`Skipping propagation for selector ${selector} because source workflow ${sourceWorkflowId} is an ancestor.`);
          return false;
        }

        // Otherwise, check if there are any differences in this path
        const diffPath = key.replace(/\./g, '.');
        if (get(differences.added, diffPath) || get(differences.updated, diffPath) || get(differences.deleted, diffPath)) {
          this.log.debug(`Differences detected at path ${diffPath}, propagation allowed.`);
          return true;
        }
      }
    }

    this.log.debug(`No matching differences found, conditions not met, or ancestry conflicts for selector: ${selector}`);
    return false;
  }

  protected async processChildState(newState: EntitiesState, differences: DetailedDiff, previousState: EntitiesState): Promise<void> {
    this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:processChildState`);

    // Denormalize the current state and the previous state for easier comparison
    const newData = denormalize(get(newState, `${this.entityName}.${this.id}`), SchemaManager.getInstance().getSchemas() as Entities, newState);
    const oldData = denormalize(
      get(previousState, `${this.entityName}.${this.id}`),
      SchemaManager.getInstance().getSchemas() as Entities,
      previousState
    );

    // Iterate over managed paths to handle child workflows for nested and complex entities
    for (const [path, config] of Object.entries(this.managedPaths)) {
      const currentValue = get(newData, config.path as string, null);
      const previousValue = get(oldData, config.path as string, null);

      // Handle Array-based entities (e.g., one-to-many relationships)
      if (Array.isArray(currentValue)) {
        await this.processArrayItems(newState, currentValue, config, differences, previousState);
      }
      // Handle Object-based entities (e.g., one-to-one relationships)
      else if (currentValue && typeof currentValue === 'object') {
        await this.processSingleItem(newState, currentValue, config, differences, previousState);
      }

      // Handle deletions of entities (if the previous value exists but is missing in the new state)
      if (Array.isArray(previousValue)) {
        for (const item of previousValue as any[]) {
          // Ensure previousValue is treated as an array
          if (get(differences, `deleted.${config.entityName}.${item}`)) {
            this.log.debug(`Processing subscription for deleted item in ${config.entityName}`);

            const workflowId = `${config.entityName}-${item}`; // Compute the workflowId

            // Attempt to find the handle or create a subscription object
            const handle = this.handles[workflowId];
            if (handle) {
              // If it's a handle, call a separate method to handle unsubscription
              await this.unsubscribeHandle(handle);
            } else {
              // If not found in handles, create a subscription object and unsubscribe
              await this.unsubscribe({ workflowId, signalName: 'update', selector: '*' });
            }
          }
        }
      } else if (previousValue && typeof previousValue === 'object') {
        const itemId = previousValue[config.idAttribute as string];
        if (get(differences, `deleted.${config.entityName}.${itemId}`)) {
          this.log.debug(`Processing subscription for deleted item in ${config.entityName}`);

          const workflowId = `${config.entityName}-${itemId}`; // Compute the workflowId

          // Attempt to find the handle or create a subscription object
          const handle = this.handles[workflowId];
          if (handle) {
            // If it's a handle, call a separate method to handle unsubscription
            await this.unsubscribeHandle(handle);
          } else {
            // If not found in handles, create a subscription object and unsubscribe
            await this.unsubscribe({ workflowId, signalName: 'update', selector: '*' });
          }
        }
      }
    }
  }

  protected async processArrayItems(
    newState: EntitiesState,
    items: any[],
    config: ManagedPath,
    differences: DetailedDiff,
    previousState: EntitiesState
  ): Promise<void> {
    this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:processArrayItems`);

    const currentItems = get(previousState, config.path as string, []);

    for (const newItem of items) {
      const difference =
        (get(differences, `added.${config.entityName as string}.${newItem}`) as DetailedDiff) ||
        (get(differences, `updated.${config.entityName as string}.${newItem}`) as DetailedDiff);

      await this.processSingleItem(newState, newItem, config, difference, previousState);
    }

    for (const currentItem of currentItems) {
      const itemId = currentItem[config.idAttribute as string];
      if (itemId && get(differences, `deleted.${config.entityName as string}.${itemId}`)) {
        await this.processDeletion(itemId, config);
      }
    }
  }

  protected async processSingleItem(
    newState: EntitiesState,
    item: string, // item is the itemId directly
    config: ManagedPath,
    differences: DetailedDiff,
    previousState: EntitiesState
  ): Promise<void> {
    this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:processSingleItem`);

    const itemId = item; // item is already the itemId
    const existingHandle = this.handles[`${config.entityName}-${itemId}`];
    const previousItem = get(previousState, `${config.entityName}.${itemId}`, {});
    const newItem = get(newState, `${config.entityName}.${itemId}`, {});
    const hasStateChanged = !isEqual(previousItem, newItem);
    this.log.debug(`hasStateChanged: ${hasStateChanged}`);
    console.log(differences);

    if (hasStateChanged) {
      if (existingHandle && 'result' in existingHandle) {
        this.log.debug(`update child`);
        await this.updateChildWorkflow(existingHandle as workflow.ChildWorkflowHandle<any>, newItem, config);
      } else if (!existingHandle && !isEmpty(differences)) {
        this.log.debug(`start child`);
        await this.startChildWorkflow(config, newItem);
      }
    }
  }

  protected async startChildWorkflow(config: ManagedPath, state: any): Promise<void> {
    this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:startChildWorkflow`);
    try {
      const { workflowType, entityName, idAttribute } = config;
      const entitySchema = SchemaManager.getInstance().getSchema(entityName as string);
      const { [idAttribute as string]: id } = state;
      const workflowId = `${entityName}-${id}`;
      const data = denormalize(state, entitySchema, this.state);

      // Prepare start payload with ancestor workflow IDs
      const startPayload = {
        workflowId,
        args: [
          {
            id,
            data,
            entityName,
            subscriptions: [
              {
                workflowId: workflow.workflowInfo().workflowId,
                signalName: 'update',
                selector: '*'
              }
            ],
            ancestorWorkflowIds: [...this.ancestorWorkflowIds, workflow.workflowInfo().workflowId] // Include current workflowId
          }
        ]
      };

      this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:startChildWorkflow:payload ${JSON.stringify(startPayload)}`);
      this.handles[workflowId] = await workflow.startChild(workflowType as string, startPayload);
      this.emit(`childStarted:${workflowType}`, workflowId, data);
    } catch (err) {
      if (err instanceof Error) {
        this.log.error(`[${this.constructor.name}] Failed to start new child workflow: ${err.message}`);
      } else {
        this.log.error(`[${this.constructor.name}] An unknown error occurred while starting a new child workflow`);
      }
    }
  }

  protected async updateChildWorkflow(handle: workflow.ChildWorkflowHandle<any>, item: any, config: ManagedPath): Promise<void> {
    this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:updateChildWorkflow`);
    try {
      const normalizedState = normalizeEntities({ ...item }, config.entityName as string).entities;
      await handle.signal('update', { data: item, entityName: config.entityName, strategy: '$merge' });

      this.emit(`childUpdated:${config.workflowType}`, handle.workflowId, item);
    } catch (err) {
      if (err instanceof Error) {
        this.log.error(`[${this.constructor.name}] Failed to signal existing workflow handle: ${err.message}`);
      } else {
        this.log.error(`[${this.constructor.name}] An unknown error occurred while signaling the child workflow`);
      }
    }
  }

  protected async processDeletion(id: string, config: ManagedPath): Promise<void> {
    try {
      const handle = this.handles[`${config.entityName}-${id}`];
      if (handle && 'cancel' in handle && typeof handle.cancel === 'function') {
        this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:Cancelling child workflow for ${config.entityName} with ID ${id}`);
        await handle.cancel();
      }
      this.emit(`childCancelled:${config.workflowType}`, id);
      delete this.handles[`${config.entityName}-${id}`];
    } catch (err) {
      this.log.error(`[${this.constructor.name}] Failed to cancel child workflow: ${(err as Error).message}`);
    }
  }

  protected async handleMaxIterations(): Promise<void> {
    const continueAsNewMethod = (this as any)._continueAsNewMethod || this.continueAsNewHandler;

    if (continueAsNewMethod && typeof (this as any)[continueAsNewMethod] === 'function') {
      return await (this as any)[continueAsNewMethod]();
    } else {
      // @ts-ignore
      await workflow.continueAsNew<typeof this>({
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

  protected async handlePause(): Promise<void> {
    await Promise.all(
      this.subscriptions.map(async (sub) => {
        try {
          await this.handles[sub.workflowId].signal('pause');
        } catch (err) {
          this.log.error(err as string);
        }
      })
    );
    await workflow.condition(() => this.status !== 'paused');
  }

  protected async loadDataAndEnqueueChanges(): Promise<void> {
    if (typeof this.loadData === 'function') {
      const updates = await this.loadData();
      this.pendingChanges.push({ updates, entityName: this.entityName, strategy: '$merge' });
    }
  }

  protected configureManagedPaths(
    parentSchema: Schema & { schema?: { [key: string]: Schema & [{ _idAttribute: string; _key: string }] } }
  ): void {
    this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:configureManagedPaths`);
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
        autoStartChildren: true,
        entityName: schema._key,
        ...(this.managedPaths[path] || {})
      };
    }
  }
}
