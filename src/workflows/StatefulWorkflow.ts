/* eslint-disable @typescript-eslint/ban-ts-comment */
import * as workflow from '@temporalio/workflow';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { normalizeEntities, reducer, EntitiesState, UPDATE_ENTITIES, DELETE_ENTITIES } from '../utils/entities';
import { detailedDiff, DetailedDiff, diff } from 'deep-object-diff';
import { schema, denormalize, Schema } from 'normalizr';
import { get, set } from 'dottie';
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
  workflowId: string;
  signalName: string;
  selector: string;
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
    const { workflowId, signalName, selector } = subscription;
    if (!this.subscriptions.find((sub) => sub.workflowId === workflowId && sub.selector === selector && sub.signalName === signalName)) {
      this.subscriptions.push(subscription);
      this.handles[workflowId] = await workflow.getExternalWorkflowHandle(workflowId);
    }
  }

  @Signal()
  public async unsubscribe(subscription: Subscription): Promise<void> {
    this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:unsubscribe`);
    const index = this.subscriptions.findIndex(
      (sub) => sub.workflowId === subscription.workflowId && sub.selector === subscription.selector && sub.signalName === subscription.signalName
    );
    if (index !== -1) {
      delete this.handles[subscription.workflowId];
      this.subscriptions.splice(index, 1);
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
          await this.processChildState(newState, differences, previousState);

          await this.processSubscriptions(newState, differences, previousState);

          this.state = newState;
          this.pendingUpdate = false;
        }
      }
    }
  }

  protected async processChildState(newState: EntitiesState, differences: DetailedDiff, previousState: EntitiesState): Promise<void> {
    this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:processChildState`);
    const newData = denormalize(get(newState, `${this.entityName}.${this.id}`), SchemaManager.getInstance().getSchemas() as Entities, newState);

    const oldData = denormalize(
      get(previousState, `${this.entityName}.${this.id}`),
      SchemaManager.getInstance().getSchemas() as Entities,
      previousState
    );

    for (const [path, config] of Object.entries(this.managedPaths)) {
      const value = get(newData, config.path as string, false);
      if (Array.isArray(value)) {
        await this.processArrayItems(newState, value, config, differences, previousState);
      } else if (value && typeof value === 'object') {
        await this.processItem(
          newState,
          value,
          config,
          get(differences, `added.${config.entityName}.${value[config.idAttribute as string]}`) ||
            get(differences, `updated.${config.entityName}.${value[config.idAttribute as string]}`),
          previousState
        );
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
    this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:processArrayItem`);
    const currentItems = get(previousState, config.path as string, []);

    for (const newItem of items) {
      const difference =
        (get(differences, `added.${config.entityName as string}.${newItem}`) as DetailedDiff) ||
        (get(differences, `updated.${config.entityName as string}.${newItem}`) as DetailedDiff);

      await this.processItem(
        get(newState, `${config.entityName}.${newItem}`, {}),
        newItem,
        config,
        difference,
        get(previousState, config.path as string, {})
      );
    }

    for (const currentItem of currentItems) {
      if (get(differences, `deleted.${config.entityName as string}.${currentItem[config.idAttribute as string]}`)) {
        await this.processDeletion(currentItem[config.idAttribute as string], config);
      }
    }
  }

  protected async processItem(
    newState: EntitiesState,
    id: string,
    config: ManagedPath,
    difference: DetailedDiff,
    previousState: EntitiesState
  ): Promise<void> {
    this.log.debug(`[StatefulWorkflow]:${this.constructor.name}:processItem`);

    const existingHandle = this.handles[`${config.entityName}-${id}`];
    const previousItem = previousState;
    const newItem = newState;
    const hasStateChanged = !isEqual(previousItem, newItem);

    if (hasStateChanged) {
      if (existingHandle && difference) {
        this.log.debug(`Updating a child process for ${config.entityName}...`);
        // @ts-ignore
        await this.updateChildWorkflow(existingHandle, newItem, config);
      } else if (!existingHandle && difference) {
        if (config.autoStartChildren) {
          this.log.debug(`Starting a new child process for ${config.entityName}...`);
          await this.startChildWorkflow(config, newItem);
        } else {
          this.log.debug(`Not starting a new child process for ${config.entityName}...`);
        }
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
            ]
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
      // Normalize the item using the provided entityName
      const normalizedState = normalizeEntities({ ...item }, config.entityName as string).entities;

      // Send the update signal to the child workflow
      await handle.signal('update', { data: item, entityName: config.entityName, strategy: '$merge' });

      // Emit an event indicating that the child workflow has been updated
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
      const handle = this.handles[id];
      if ('cancel' in handle && typeof handle.cancel === 'function') {
        await handle.cancel();
      }
      this.emit(`childCancelled:${config.workflowType}`, id);
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
