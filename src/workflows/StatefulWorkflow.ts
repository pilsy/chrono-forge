/* eslint-disable @typescript-eslint/ban-ts-comment */
import * as workflow from '@temporalio/workflow';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import {
  normalizeEntities,
  reducer,
  EntitiesState,
  UPDATE_ENTITIES,
  DELETE_ENTITIES,
  updateNormalizedEntities,
  deleteNormalizedEntities
} from '../utils/entities';
import { detailedDiff, DetailedDiff, diff } from 'deep-object-diff';
import { schema, denormalize, Schema } from 'normalizr';
import dottie, { get, set, flatten, transform } from 'dottie';
import isEmpty from 'lodash.isempty';
import isEqual from 'lodash.isequal';
import isObject from 'lodash.isobject';
import { startChildPayload } from '../utils/startChildPayload';
import { Workflow, Signal, Query, Hook, Before, After, Property, Condition, Step, ContinueAsNew, ChronoFlowOptions } from './Workflow';
import { SchemaManager } from '../SchemaManager';
import { limitRecursion } from '../utils/limitRecursion';

export type ManagedPath = {
  entityName?: string;
  path?: string;
  workflowType?: string;
  idAttribute?: string;
  autoStartChildren?: boolean;
  cancellationType?: workflow.ChildWorkflowCancellationType;
  parentClosePolicy?: workflow.ParentClosePolicy;
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

export type StatefulWorkflowParams = {
  id: string;
  entityName: string;
  data?: Record<string, any>;
  state?: EntitiesState;
  status: string;
  apiUrl?: string;
  apiToken?: string;
  subscriptions?: Subscription[];
  autoStartChildren?: boolean;
  ancestorWorkflowIds?: string[];
};

export type StatefulWorkflowOptions = {
  schema?: schema.Entity;
  schemaName?: string;
  autoStartChildren?: boolean;
  apiUrl?: string;
};

export type PendingChange = {
  updates?: Record<string, any>;
  deletions?: Record<string, any>;
  entityName: string;
  strategy?: '$set' | '$merge';
};

export abstract class StatefulWorkflow extends Workflow {
  private schemaManager = SchemaManager.getInstance();
  private schema: Schema;

  protected async condition(): Promise<any> {
    this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:awaitCondition`);
    return await workflow.condition(() => this.pendingUpdate || !!this.pendingChanges.length || this.status !== 'running', '1 day');
  }

  protected shouldLoadData(): boolean {
    // @ts-ignore
    return typeof this?.loadData === 'function';
  }
  protected abstract execute(args?: unknown, options?: ChronoFlowOptions): Promise<unknown>;

  protected continueAsNew: boolean = true;
  protected async continueAsNewHandler(): Promise<void> {}

  protected iteration = 0;

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

  @Property()
  get state() {
    return this.schemaManager.getState();
  }

  set state(state: EntitiesState) {
    this.schemaManager.setState(state);
  }

  @Property()
  protected pendingUpdate: boolean = true;

  @Query('pendingChanges')
  get pendingChanges() {
    return this.schemaManager.pendingChanges;
  }

  @Property({ set: false })
  protected subscriptions: Subscription[] = [];

  @Property({ set: false })
  protected managedPaths: ManagedPaths = {};

  @Property()
  protected apiUrl?: string;

  @Property()
  protected ancestorWorkflowIds: string[] = [];

  @Property({ set: false })
  protected params: StatefulWorkflowParams;

  @Property({ set: false })
  protected options: StatefulWorkflowOptions;

  constructor(args: any[], options: StatefulWorkflowOptions) {
    super(args, options);

    this.params = args[0];
    this.options = options;
    this.entityName = (this.params?.entityName || options?.schemaName) as string;
    this.schema = this.entityName ? (this.schemaManager.getSchema(this.params.entityName) as schema.Entity) : (options.schema as schema.Entity);

    this.id = this.params?.id;
    // this.state = (this.params?.state as EntitiesState) || {};
    this.status = this.params?.status ?? 'init';

    if (this.params?.ancestorWorkflowIds) {
      this.ancestorWorkflowIds = this.params.ancestorWorkflowIds;
    }

    this.apiUrl = this.params?.apiUrl || options?.apiUrl;
    this.apiToken = this.params?.apiToken;

    if (this.params?.subscriptions) {
      for (const subscription of this.params.subscriptions) {
        this.subscribe(subscription);
      }
    }

    this.schemaManager.on('stateChange', this.stateChanged.bind(this));
    this.pendingUpdate = true;

    if (this.params?.state && !isEmpty(this.params?.state)) {
      this.schemaManager.setState(this.params.state);
    }

    if (this.params?.data && !isEmpty(this.params?.data)) {
      this.schemaManager.dispatch(updateNormalizedEntities(normalizeEntities(this.params.data, this.schema), '$merge'), false);
    }
  }

  protected async executeWorkflow(): Promise<any> {
    this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:executeWorkflow`);
    return new Promise(async (resolve, reject) => {
      if (this.schema) this.configureManagedPaths(this.schema);
      try {
        while (this.iteration <= this.maxIterations) {
          this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:executeWorkflow:execute`);
          await this.tracer.startActiveSpan(`[StatefulWorkflow]:${this.constructor.name}:executeWorkflow:execute`, async (executeSpan) => {
            try {
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
                return this.status !== 'errored' ? resolve(this.result) : reject(this.result);
              } else if (++this.iteration >= this.maxIterations) {
                await this.handleMaxIterations();
                resolve('Continued as a new workflow execution...');
              } else {
                this.pendingUpdate = false;
              }
            } catch (e: any) {
              throw e;
            } finally {
              executeSpan.end();
            }
          });
        }
      } catch (err) {
        await this.handleExecutionError(err, reject);
      }
    });
  }

  @Signal()
  public update({ data, updates, entityName, strategy = '$merge' }: PendingChange & { data?: Record<string, any> }): void {
    this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:update`);

    if (!isEmpty(data)) {
      updates = normalizeEntities(data, entityName === this.entityName ? this.schema : SchemaManager.getInstance().getSchema(entityName));
    }
    if (updates) {
      this.pendingUpdate = true;
      this.schemaManager.dispatch(updateNormalizedEntities(updates, strategy), false);
    }
  }

  @Signal()
  public delete({ data, deletions, entityName }: PendingChange & { data?: Record<string, any> }): void {
    this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:delete`);
    if (!isEmpty(data)) {
      deletions = normalizeEntities(data, entityName === this.entityName ? this.schema : SchemaManager.getInstance().getSchema(entityName));
    }
    if (deletions) {
      this.pendingUpdate = true;
      this.schemaManager.dispatch(deleteNormalizedEntities(deletions), false);
    }
  }

  @Signal()
  public async subscribe(subscription: Subscription): Promise<void> {
    this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:subscribe`);
    const { workflowId, subscriptionId } = subscription;

    if (this.ancestorWorkflowIds.includes(workflowId)) {
      this.log.warn(`[${this.constructor.name}] Circular subscription detected for workflowId: ${workflowId}. Skipping subscription.`);
      return;
    }

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
    if (this.pendingChanges.length) {
      await this.schemaManager.processChanges();
    }
  }

  protected async stateChanged({
    newState,
    previousState,
    differences
  }: {
    newState: EntitiesState;
    previousState: EntitiesState;
    differences: DetailedDiff;
  }): Promise<void> {
    this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:stateChanged`);

    if (!isEmpty(differences.added) || !isEmpty(differences.updated) || !isEmpty(differences.deleted)) {
      const created = get(differences.added, `${this.entityName}.${this.id}`, false);
      const updated = get(differences.updated, `${this.entityName}.${this.id}`, false);
      const deleted = get(differences.deleted, `${this.entityName}.${this.id}`, false);

      if (created) {
        await this.emit('created', created, newState, previousState);
      } else if (updated) {
        await this.emit('updated', updated, newState, previousState);
      } else if (deleted) {
        if (!(await this.emit('deleted', deleted, newState, previousState))) {
          return await this.cancel();
        }
      }

      await this.processChildState(newState, differences, previousState || {});
      if (this.iteration !== 0) {
        await this.processSubscriptions(newState, differences, previousState || {});
      }

      this.pendingUpdate = false;

      // we need to only call this once, but directly after the very first time the stack changes are calculated...
      this.emit('ready');
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

    if (sourceWorkflowId && ancestorWorkflowIds.includes(sourceWorkflowId)) {
      this.log.debug(`Skipping propagation for selector ${selector} because source workflow ${sourceWorkflowId} is an ancestor.`);
      return false;
    }

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

    if (hasStateChanged) {
      if (existingHandle && 'result' in existingHandle) {
        await this.updateChildWorkflow(existingHandle as workflow.ChildWorkflowHandle<any>, newItem, newState, config);
      } else if (!existingHandle && !isEmpty(differences)) {
        await this.startChildWorkflow(config, newItem, newState);
      }
    }
  }

  protected async startChildWorkflow(config: ManagedPath, state: any, newState: any): Promise<void> {
    this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:startChildWorkflow`);
    try {
      const {
        workflowType,
        entityName,
        idAttribute,
        cancellationType = workflow.ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
        parentClosePolicy = workflow.ParentClosePolicy.PARENT_CLOSE_POLICY_REQUEST_CANCEL,
        autoStartChildren
      } = config;

      if (!config.autoStartChildren) {
        this.log.warn(
          `${workflowType} with entityName ${entityName} not configured to autoStartChildren...\n${JSON.stringify(config, null, 2)}`
        );
        return;
      }

      const entitySchema = SchemaManager.getInstance().getSchema(entityName as string);
      const { [idAttribute as string]: id } = state;
      const workflowId = `${entityName}-${id}`;
      const data = limitRecursion(denormalize(state, entitySchema, newState), entitySchema);

      if (this.ancestorWorkflowIds.includes(workflowId)) {
        this.log.warn(`[${this.constructor.name}] Circular dependency detected for workflowId: ${workflowId}. Skipping child workflow start.`);
        return;
      }

      // Prepare start payload with ancestor workflow IDs
      const startPayload = {
        workflowId,
        cancellationType,
        parentClosePolicy,
        startToCloseTimeout: '1 minute',
        args: [
          {
            id,
            data,
            entityName,
            subscriptions: [
              {
                workflowId: workflow.workflowInfo().workflowId,
                signalName: 'update',
                selector: '*',
                ancestorWorkflowIds: [...this.ancestorWorkflowIds, workflow.workflowInfo().workflowId]
              }
            ],
            apiToken: this.apiToken
            // ancestorWorkflowIds: this.ancestorWorkflowIds
          }
        ]
      };

      this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:startChildWorkflow(${workflowType})`);
      this.handles[workflowId] = await workflow.startChild(String(workflowType), startPayload);
      this.emit(`childStarted:${workflowType}`, workflowId, data);
    } catch (err) {
      if (err instanceof Error) {
        this.log.error(`[${this.constructor.name}] Failed to start new child workflow: ${err.message}\n${err.stack}`);
      } else {
        this.log.error(`[${this.constructor.name}] An unknown error occurred while starting a new child workflow`);
      }
      throw err;
    }
  }

  protected async updateChildWorkflow(handle: workflow.ChildWorkflowHandle<any>, state: any, newState: any, config: ManagedPath): Promise<void> {
    this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:updateChildWorkflow`);
    try {
      const {
        workflowType,
        entityName,
        idAttribute,
        cancellationType = workflow.ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
        parentClosePolicy = workflow.ParentClosePolicy.PARENT_CLOSE_POLICY_REQUEST_CANCEL,
        autoStartChildren
      } = config;

      if (!config.autoStartChildren) {
        this.log.warn(
          `${workflowType} with entityName ${entityName} not configured to autoStartChildren...\n${JSON.stringify(config, null, 2)}`
        );
        return;
      }

      const entitySchema = SchemaManager.getInstance().getSchema(entityName as string);
      const { [idAttribute as string]: id } = state;
      const workflowId = `${entityName}-${id}`;
      const data = limitRecursion(denormalize(state, entitySchema, newState), entitySchema);

      if (this.ancestorWorkflowIds.includes(workflowId)) {
        this.log.warn(`[${this.constructor.name}] Circular update detected for workflowId: ${workflowId}. Skipping child workflow update.`);
        return;
      }

      await handle.signal('update', { data, entityName: config.entityName, strategy: '$merge' });
      this.emit(`childUpdated:${config.workflowType}`, handle.workflowId, data);
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
      const workflowId = `${config.entityName}-${id}`;
      const handle = this.handles[workflowId];

      if (this.ancestorWorkflowIds.includes(workflowId)) {
        this.log.warn(`[${this.constructor.name}] Circular stop detected for workflowId: ${workflowId}. Skipping child workflow cancellation.`);
        return;
      }

      if (handle && 'cancel' in handle && typeof handle.cancel === 'function') {
        this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:Cancelling child workflow for ${config.entityName} with ID ${id}`);
        await handle.cancel();
      }
      this.emit(`childCancelled:${config.workflowType}`, id);
      delete this.handles[workflowId];
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
    // @ts-ignore
    if (typeof this?.loadData === 'function') {
      // @ts-ignore
      let { data, updates } = await this.loadData();
      if (data && !updates) {
        updates = normalizeEntities(data, this.entityName);
      } else if (!updates) {
        console.log(`No data or updates returned from loadData(), skipping state change...`);
      }
      this.schemaManager.dispatch(updateNormalizedEntities(updates, '$merge'), false);
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
        autoStartChildren: typeof this.options?.autoStartChildren === 'boolean' ? this.options?.autoStartChildren : true,
        entityName: schema._key,
        ...(this.managedPaths[path] || {})
      };
    }
  }
}
