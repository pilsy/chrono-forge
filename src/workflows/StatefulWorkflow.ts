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
import { isEmpty, isEqual } from 'lodash';
import { Workflow, ChronoFlowOptions } from './Workflow';
import { Signal, Query, Before, Property, ACTIONS_METADATA_KEY, VALIDATOR_METADATA_KEY, ActionOptions, On, After } from '../decorators';
import { SchemaManager } from '../SchemaManager';
import { limitRecursion } from '../utils/limitRecursion';
import { getCompositeKey } from '../utils/getCompositeKey';
import { PROPERTY_METADATA_KEY } from '../decorators';
import { UpdateHandlerOptions, Handler } from '@temporalio/workflow/lib/interfaces';
import { HandlerUnfinishedPolicy } from '@temporalio/common';

export type ManagedPath = {
  entityName?: string;
  path?: string;
  workflowType?: string;
  idAttribute?: string | string[];
  isMany?: boolean;
  includeParentId?: boolean;
  autoStartChildren?: boolean;
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
  private _actionRunning: boolean = false;
  protected continueAsNew: boolean = true;
  protected schemaManager: SchemaManager;
  protected schema: Schema;
  protected iteration = 0;

  protected condition(): boolean {
    return this.pendingUpdate || !!this.pendingChanges.length || this.status !== 'running';
  }

  protected shouldLoadData(): boolean {
    return typeof (this as any)?.loadData === 'function' && this.pendingUpdate;
  }
  protected abstract execute(args?: unknown, options?: ChronoFlowOptions): Promise<unknown>;

  @Property({ set: false })
  protected apiToken?: string;

  @Signal('apiToken')
  public setApiToken(apiToken: string): void {
    this.log.debug(`[${this.constructor.name}]:${this.entityName}:${this.id}.setApiToken`);
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

  @Property()
  get state() {
    return this.schemaManager.getState();
  }

  set state(state: EntitiesState) {
    this.schemaManager.setState(state);
  }

  @Property()
  protected get data(): P['data'] {
    return this.schemaManager.query(this.entityName, this.id);
  }

  protected set data(data: any) {
    this.update({ data, entityName: this.entityName, changeOrigin: workflow.workflowInfo().workflowId });
  }

  @Property()
  protected pendingUpdate: boolean = true;

  @Query('pendingChanges')
  get pendingChanges() {
    return this.schemaManager.pendingChanges;
  }

  @Property({ set: false })
  protected subscriptions: Subscription[] = [];

  protected subscriptionHandles: { [workflowId: string]: workflow.ExternalWorkflowHandle } = {};

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

    this.schemaManager = SchemaManager.getInstance(workflow.workflowInfo().workflowId);

    this.id = this.params?.id;
    this.entityName = (this.params?.entityName || options?.schemaName) as string;
    this.schema = this.entityName ? (this.schemaManager.getSchema(this.entityName) as schema.Entity) : (options.schema as schema.Entity);
    this.apiUrl = this.params?.apiUrl || options?.apiUrl;
    this.apiToken = this.params?.apiToken;

    if (this.params?.subscriptions) {
      for (const subscription of this.params.subscriptions) {
        this.subscribe(subscription);
      }
    }

    this.schemaManager.on('stateChange', this.stateChanged.bind(this));
    this.schemaManager.on('stateChange', this.upsertStateToMemo.bind(this));
    this.pendingUpdate = true;

    const memo = (workflow.workflowInfo().memo || {}) as { state?: EntitiesState; iteration?: number; status?: string };
    if (memo?.iteration !== undefined) {
      this.iteration = Number(memo.iteration);
    }

    if (this.params?.state && !isEmpty(this.params?.state)) {
      this.schemaManager.setState(this.params.state);
    } else if (memo?.state && !isEmpty(memo.state)) {
      this.schemaManager.setState(memo.state);
    }

    if (this.params?.data && !isEmpty(this.params?.data)) {
      this.schemaManager.dispatch(updateEntity(this.params.data, this.entityName), false);
    }

    this.status = memo?.status ?? this.params?.status ?? 'running';
  }

  protected async executeWorkflow(): Promise<any> {
    this.log.debug(`[${this.constructor.name}]:${this.entityName}:${this.id}.executeWorkflow`);

    return new Promise(async (resolve, reject) => {
      try {
        if (this.schema) this.configureManagedPaths(this.schema);
        while (this.iteration <= this.maxIterations) {
          this.log.debug(`[${this.constructor.name}]:${this.entityName}:${this.id}:execute`);

          await workflow.condition(this.condition.bind(this), this.conditionTimeout);

          if (this.status === 'paused') {
            await this.emitAsync('paused');
            await this.forwardSignalToChildren('pause');
            await workflow.condition(() => this.status !== 'paused');
          }

          if (this.status === 'cancelled') {
            break;
          }

          if (this.shouldLoadData()) {
            await this.loadDataAndEnqueueChanges();
          }

          if (!this.isInTerminalState()) {
            this.result = await this.execute();
          }

          if (this.isInTerminalState()) {
            return this.status !== 'errored' ? resolve(this.result || this.data) : reject(this.result);
          }

          if (++this.iteration >= this.maxIterations) {
            await this.handleMaxIterations();
            break;
          } else {
            this.pendingUpdate = false;
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
    this.log.debug(
      `[${this.constructor.name}]:${this.entityName}:${this.id}.update(${JSON.stringify({ data, updates, entityName, changeOrigin }, null, 2)})`
    );

    if (data !== null && !isEmpty(data)) {
      updates = normalizeEntities(data, entityName === this.entityName ? this.schema : SchemaManager.getInstance().getSchema(entityName));
    }
    if (updates) {
      this.schemaManager.dispatch(updateNormalizedEntities(updates, strategy), sync, changeOrigin);
    } else {
      this.log.error(`Invalid Update: ${JSON.stringify(data, null, 2)}, \n${JSON.stringify(updates, null, 2)}`);
    }
  }

  @Signal()
  public delete({ data, deletions, entityName }: PendingChange & { data?: Record<string, any> }): void {
    this.log.debug(`[${this.constructor.name}]:${this.entityName}:${this.id}.delete`);
    if (!isEmpty(data)) {
      deletions = normalizeEntities(data, entityName === this.entityName ? this.schema : SchemaManager.getInstance().getSchema(entityName));
    }
    if (deletions) {
      this.schemaManager.dispatch(deleteNormalizedEntities(deletions), false);
    }
  }

  @Signal()
  public async subscribe(subscription: Subscription): Promise<void> {
    this.log.debug(`[${this.constructor.name}]:${this.entityName}:${this.id}.subscribe`);

    const { workflowId, subscriptionId } = subscription;
    if (!this.subscriptions.find((sub) => sub.workflowId === workflowId && sub.subscriptionId === subscriptionId)) {
      this.subscriptions.push(subscription);
      this.subscriptionHandles[workflowId] = await workflow.getExternalWorkflowHandle(workflowId);
    }
  }

  @Signal()
  public async unsubscribe(subscription: Subscription): Promise<void> {
    this.log.debug(`[${this.constructor.name}]:${this.entityName}:${this.id}.unsubscribe`);

    const { workflowId, subscriptionId } = subscription;
    const index = this.subscriptions.findIndex((sub) => sub.workflowId === workflowId && sub.subscriptionId === subscriptionId);
    if (index !== -1) {
      delete this.subscriptionHandles[workflowId];
      this.subscriptions.splice(index, 1);
    }
  }

  private async unsubscribeHandle(handle: workflow.ExternalWorkflowHandle | workflow.ChildWorkflowHandle<any>) {
    this.log.debug(
      `[${this.constructor.name}]:${this.entityName}:${this.id}: Successfully Unsubscribing from workflow handle: ${handle.workflowId}`
    );
    try {
      if ('cancel' in handle && typeof handle.cancel === 'function') {
        await handle.cancel();
      }
      this.log.debug(`Successfully unsubscribed from workflow handle: ${handle.workflowId}`);
    } catch (error: any) {
      this.log.error(`Failed to unsubscribe from workflow handle: ${(error as Error).message}`);
    }
  }

  @Before('execute')
  protected async processState(): Promise<void> {
    if (this._actionRunning) {
      this.log.debug(
        `[${this.constructor.name}]:${this.entityName}:${this.id}: Action is running, waiting for all changes to be made before processing...`
      );
      await workflow.condition(() => !this._actionRunning);
    }

    this.log.debug(`[${this.constructor.name}]:${this.entityName}:${this.id}.processState`);
    if (this.pendingChanges.length) {
      await this.schemaManager.processChanges();
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
      } else if (deleted) {
        if (!(await this.emit('deleted', deleted, newState, previousState, changeOrigins))) {
          this.status = 'cancelled';
        }
      }

      await this.processChildState(newState, differences, previousState || {}, changeOrigins);
      if (this.iteration !== 0) {
        await this.processSubscriptions(newState, differences, previousState || {}, changeOrigins);
      }

      this.upsertStateToMemo();
      this.pendingUpdate = false;
    }
  }

  protected upsertStateToMemo(): void {
    this.log.debug(`[StatefulWorkflow]: Checking if we should upsertStateToMemo: ${workflow.workflowInfo().workflowId}`);
    workflow.upsertMemo({
      iteration: this.iteration,
      status: this.status,
      state: this.schemaManager.getState(),
      lastUpdated: new Date().toISOString()
    });
  }

  protected async processSubscriptions(
    newState: EntitiesState,
    differences: DetailedDiff,
    previousState: EntitiesState,
    changeOrigins: string[]
  ): Promise<void> {
    this.log.debug(`[${this.constructor.name}]:${this.entityName}:${this.id}.processSubscriptions`);

    for (const subscription of this.subscriptions) {
      const { workflowId, signalName, selector, parent, child, condition, entityName, subscriptionId } = subscription;

      const shouldUpdate = this.shouldPropagateUpdate(newState, differences, selector, condition, changeOrigins, this.ancestorWorkflowIds);
      if (!shouldUpdate) {
        continue;
      }

      const relevantChanges = this.extractChangesForSelector(differences, selector, newState);
      if (isEmpty(relevantChanges)) {
        continue;
      }

      const handle = this.subscriptionHandles[workflowId];
      if (handle) {
        try {
          this.log.debug(
            `[${this.constructor.name}]:${this.entityName}:${this.id}.Sending update to workflow: ${workflowId}, Subscription ID: ${subscriptionId}`
          );

          await handle.signal(signalName, {
            updates: relevantChanges,
            entityName: entityName,
            changeOrigin: workflow.workflowInfo().workflowId,
            subscriptionId,
            sync: true
          });
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
  private shouldPropagateUpdate(
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
          this.log.debug(`Skipping propagation for selector ${selector} because the change originated from an ancestor workflow (${origin}).`);
          return false;
        }
      }
    }

    const selectorRegex = new RegExp('^' + selector.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
    for (const diffType of ['added', 'updated'] as const) {
      const entities = differences[diffType] as EntitiesState;
      if (!entities) continue;

      for (const [entityName, entityChanges] of Object.entries(entities)) {
        for (const [entityId, entityData] of Object.entries(entityChanges)) {
          // Iterate through the keys in entityData
          for (const key in entityData) {
            if (Object.prototype.hasOwnProperty.call(entityData, key)) {
              const path = `${entityName}.${entityId}.${key}`;

              if (selectorRegex.test(path)) {
                const selectedData = get(newState, path);

                // If a custom condition is provided, use it
                if (condition && !condition(selectedData)) {
                  this.log.debug(`Custom condition for selector ${selector} not met.`);
                  continue; // Skip propagation if condition fails
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
                    continue; // Wildcard matches any segment
                  }
                  if (selectorParts[i] !== keyParts[i]) {
                    isParent = false;
                    break;
                  }
                }

                if (isParent) {
                  const parentKey = selector.split('.').slice(-1)[0]; // last segment of selector
                  const selectedData = get(newState, `${entityName}.${entityId}.${parentKey}`);

                  // If a custom condition is provided, use it
                  if (condition && !condition(selectedData)) {
                    this.log.debug(`Custom condition for selector ${selector} not met.`);
                    continue; // Skip propagation if condition fails
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

    this.log.debug(`No matching differences found, conditions not met, or ancestry conflicts for selector: ${selector}`);
    return false;
  }

  /**
   * Extracts only the changed entities that match the given selector.
   * @param differences - The DetailedDiff object containing changes.
   * @param selector - The selector string to match changes against.
   * @param newState - The new state after changes.
   * @returns A subset of EntitiesState containing only the relevant changes.
   */
  private extractChangesForSelector(differences: DetailedDiff, selector: string, newState: EntitiesState): EntitiesState {
    const changedEntities: EntitiesState = {};

    const selectorRegex = new RegExp('^' + selector.replace(/\*/g, '.*') + '$');
    const traverseDifferences = (diffType: 'added' | 'updated') => {
      const entities = differences[diffType] as EntitiesState;
      if (!entities) return;

      for (const [entityName, entityChanges] of Object.entries(entities)) {
        const schema = this.schemaManager.getSchema(entityName);
        for (const [entityId, entityData] of Object.entries(entityChanges)) {
          if (!changedEntities[entityName]) {
            changedEntities[entityName] = {};
          }

          for (const key in entityData) {
            if (Object.prototype.hasOwnProperty.call(entityData, key)) {
              const value = entityData[key];
              const currentPath = key;

              if (!changedEntities[entityName][entityId]) {
                changedEntities[entityName][entityId] = {};
              }

              // @ts-ignore
              if (!Array.isArray(schema.schema[currentPath])) {
                changedEntities[entityName][entityId][key] = value;
              } else {
                // Assign the entire array from newState
                changedEntities[entityName][entityId][currentPath] = get(newState, `${entityName}.${entityId}.${currentPath}`);
              }
            }
          }
        }
      }
    };

    // Process 'added' and 'updated' differences
    traverseDifferences('added');
    traverseDifferences('updated');

    return changedEntities;
  }

  protected async processChildState(
    newState: EntitiesState,
    differences: DetailedDiff,
    previousState: EntitiesState,
    changeOrigins: string[]
  ): Promise<void> {
    this.log.debug(`[${this.constructor.name}]:${this.entityName}:${this.id}.processChildState`);

    const newData = limitRecursion(this.id, this.entityName, newState);
    const oldData = limitRecursion(this.id, this.entityName, previousState);

    for (const [path, config] of Object.entries(this.managedPaths)) {
      const currentValue = get(newData, config.path as string, null);
      const previousValue = get(oldData, config.path as string, null);

      if (Array.isArray(currentValue)) {
        await this.processArrayItems(newState, currentValue, config, differences, previousState, changeOrigins);
      } else if (currentValue) {
        await this.processSingleItem(newState, currentValue, config, differences, previousState, changeOrigins);
      }

      if (Array.isArray(previousValue)) {
        for (const item of previousValue as any[]) {
          if (get(differences, `deleted.${config.entityName}.${item}`)) {
            this.log.debug(`Processing subscription for deleted item in ${config.entityName}`);

            const compositeId = Array.isArray(config.idAttribute)
              ? getCompositeKey(newState[config.entityName as string][item], config.idAttribute)
              : item;
            const workflowId = config.includeParentId ? `${config.entityName}-${compositeId}-${this.id}` : `${config.entityName}-${compositeId}`;
            const handle = this.handles[workflowId];
            if (handle) {
              await this.unsubscribeHandle(handle);
            } else {
              await this.unsubscribe({ workflowId, signalName: 'update', selector: '*' });
            }
          }
        }
      } else if (previousValue) {
        const itemId = previousValue[config.idAttribute as string];
        if (get(differences, `deleted.${config.entityName}.${itemId}`)) {
          this.log.debug(`Processing subscription for deleted item in ${config.entityName}`);

          const compositeId = Array.isArray(config.idAttribute)
            ? getCompositeKey(newState[config.entityName as string][itemId], config.idAttribute)
            : itemId;
          const workflowId = config.includeParentId ? `${config.entityName}-${compositeId}-${this.id}` : `${config.entityName}-${compositeId}`;

          const handle = this.handles[workflowId];
          if (handle) {
            await this.unsubscribeHandle(handle);
          } else {
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
    previousState: EntitiesState,
    changeOrigins: string[]
  ): Promise<void> {
    this.log.debug(`[${this.constructor.name}]:${this.entityName}:${this.id}.processArrayItems`);

    const currentItems = get(previousState, config.path as string, []);

    for (const newItem of items) {
      const itemId = Array.isArray(config.idAttribute) ? getCompositeKey(newItem, config.idAttribute) : newItem[config.idAttribute as string];

      const difference =
        (get(differences, `added.${config.entityName as string}.${itemId}`) as DetailedDiff) ||
        (get(differences, `updated.${config.entityName as string}.${itemId}`) as DetailedDiff);

      await this.processSingleItem(newState, itemId, config, difference, previousState, changeOrigins);
    }

    for (const currentItem of currentItems) {
      const itemId = Array.isArray(config.idAttribute)
        ? getCompositeKey(currentItem, config.idAttribute)
        : currentItem[config.idAttribute as string];

      if (itemId && get(differences, `deleted.${config.entityName as string}.${itemId}`)) {
        // @TODO need to fix this
        await this.processDeletion(itemId, config);
      }
    }
  }

  protected async processSingleItem(
    newState: EntitiesState,
    item: string,
    config: ManagedPath,
    differences: DetailedDiff,
    previousState: EntitiesState,
    changeOrigins: string[]
  ): Promise<void> {
    this.log.debug(`[${this.constructor.name}]:${this.entityName}:${this.id}.processSingleItem`);

    const compositeId = Array.isArray(config.idAttribute)
      ? getCompositeKey(newState[config.entityName as string][item], config.idAttribute)
      : item;
    const workflowId = config.includeParentId ? `${config.entityName}-${compositeId}-${this.id}` : `${config.entityName}-${compositeId}`;

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
        parentClosePolicy = workflow.ParentClosePolicy.PARENT_CLOSE_POLICY_REQUEST_CANCEL,
        autoStartChildren
      } = config;

      if (!autoStartChildren) {
        this.log.warn(
          `${workflowType} with entityName ${entityName} not configured to autoStartChildren...\n${JSON.stringify(config, null, 2)}`
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
        this.log.warn(
          `[${this.constructor.name}]:${this.entityName}:${this.id} Circular dependency detected for workflowId: ${workflowId}. Skipping child workflow start.`
        );
        return;
      }

      if (typeof config.condition === 'function') {
        this.log.info(`[${this.constructor.name}]:${this.entityName}:${this.id}: Calling condition function before starting child...`);
        if (!config.condition.apply(this, [rawData, this])) {
          this.log.info(`[${this.constructor.name}]:${this.entityName}:${this.id}: Condition returned false, not starting child.`);
          return;
        }
      }

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
        ]
      };

      this.log.debug(
        `[${this.constructor.name}]:${this.entityName}:${this.id}.startChildWorkflow( workflowType=${workflowType}, startPayload=${JSON.stringify(startPayload, null, 2)}\n)`
      );
      this.handles[workflowId] = await workflow.startChild(String(workflowType), startPayload);
      this.emit(`child:${entityName}:started`, { ...config, workflowId, data });
      this.handles[workflowId]
        .result()
        .then((result) => this.emit(`child:${entityName}:completed`, { ...config, workflowId, result }))
        .catch(async (error) => {
          this.log.error(`[${this.constructor.name}]:${this.entityName}:${this.id} Child workflow error: ${error.message}\n${error.stack}`);
          if (workflow.isCancellation(error) && this.status !== 'cancelled') {
            this.log.info(`[${this.constructor.name}]:${this.entityName}:${this.id} Restarting child workflow due to cancellation.`);
            await this.startChildWorkflow(config, this.schemaManager.query(String(entityName), compositeId, false), this.state);
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
        this.log.error(`[${this.constructor.name}]:${this.entityName}:${this.id} An unknown error occurred while starting a new child workflow`);
      }
      throw err;
    }
  }

  protected async updateChildWorkflow(handle: workflow.ChildWorkflowHandle<any>, state: any, newState: any, config: ManagedPath): Promise<void> {
    this.log.debug(`[${this.constructor.name}]:${this.entityName}:${this.id}.updateChildWorkflow`);
    try {
      const { workflowType, entityName, idAttribute, includeParentId, autoStartChildren } = config;

      if (!autoStartChildren) {
        this.log.warn(
          `${workflowType} with entityName ${entityName} not configured to autoStartChildren...\n${JSON.stringify(config, null, 2)}`
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
        this.log.warn(
          `[${this.constructor.name}]:${this.entityName}:${this.id} Circular update detected for workflowId: ${workflowId}. Skipping child workflow update.`
        );
        return;
      }

      if (typeof config.condition === 'function') {
        this.log.info(`[${this.constructor.name}]:${this.entityName}:${this.id}: Calling condition function before starting child...`);
        if (!config.condition.apply(this, [rawData, this])) {
          this.log.info(`[${this.constructor.name}]:${this.entityName}:${this.id}: Condition returned false, not starting child.`);
          return;
        }
      }

      await handle.signal('update', {
        data,
        entityName: config.entityName,
        strategy: '$merge',
        sync: false,
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
        this.log.error(`[${this.constructor.name}]:${this.entityName}:${this.id} Failed to signal existing workflow handle: ${err.message}`);
      } else {
        this.log.error(`[${this.constructor.name}]:${this.entityName}:${this.id} An unknown error occurred while signaling the child workflow`);
      }
    }
  }

  protected async processDeletion(id: string, config: ManagedPath): Promise<void> {
    try {
      const workflowId = `${config.entityName}-${id}`;
      const handle = this.handles[workflowId];

      if (this.ancestorWorkflowIds.includes(workflowId)) {
        this.log.warn(
          `[${this.constructor.name}]:${this.entityName}:${this.id} Circular stop detected for workflowId: ${workflowId}. Skipping child workflow cancellation.`
        );
        return;
      }

      if (handle && 'cancel' in handle && typeof handle.cancel === 'function') {
        this.log.debug(
          `[${this.constructor.name}]:${this.entityName}:${this.id}.Cancelling child workflow for ${config.entityName} with ID ${id}`
        );
        await handle.cancel();
      }
      this.emit(`child:${config.entityName}:deleted`, { ...config, workflowId, id });
      delete this.handles[workflowId];
    } catch (err) {
      this.log.error(`[${this.constructor.name}]:${this.entityName}:${this.id} Failed to cancel child workflow: ${(err as Error).message}`);
    }
  }

  protected async handleMaxIterations(): Promise<void> {
    // @ts-ignore
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

  protected async loadDataAndEnqueueChanges(): Promise<void> {
    // @ts-ignore
    if (typeof this?.loadData === 'function') {
      // @ts-ignore
      let { data, updates } = await this.loadData();
      if (!data && !updates) {
        console.log(`No data or updates returned from loadData(), skipping state change...`);
        return;
      }
      if (data && !updates) {
        updates = normalizeEntities(data, this.entityName);
      }
      this.schemaManager.dispatch(updateNormalizedEntities(updates, '$merge'), false);
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
        autoStartChildren: typeof this.options?.autoStartChildren === 'boolean' ? this.options?.autoStartChildren : true,
        entityName: schema._key,
        ...(this.managedPaths[path] || {})
      };
    }
  }

  protected async bindProperties() {
    await super.bindProperties();

    const properties = this.collectMetadata(PROPERTY_METADATA_KEY, this.constructor.prototype);
    properties.forEach(({ propertyKey, path }) => {
      if (typeof path === 'string') {
        Object.defineProperty(this, propertyKey, {
          get: () => dottie.get(this.data || {}, path),
          set: (value) => {
            dottie.set(this.data || (this.data = {}), path, value);
            // setWithProxy(this.data || (this.data = {}), path, value);
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
        async (input: any): Promise<any> => {
          this._actionRunning = true;
          let result: any;
          let error: any;
          try {
            result = await (this[methodName] as (input: any) => any)(input);
          } catch (err: any) {
            error = err;
            this.log.error(error);
          } finally {
            this._actionRunning = false;
          }

          await workflow.condition(() => !this.schemaManager.processing);
          return result !== undefined ? result : this.data;
        },
        updateOptions
      );
    }

    this._actionsBound = true;
  }
}
