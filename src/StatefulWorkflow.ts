/* eslint-disable @typescript-eslint/ban-ts-comment */
import * as workflow from '@temporalio/workflow';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { normalizeEntities, reducer, EntitiesState, UPDATE_ENTITIES, DELETE_ENTITIES } from './utils/entities';
import { detailedDiff, DetailedDiff } from 'deep-object-diff';
import { schema, denormalize, Schema } from 'normalizr';
import { get, set } from 'dottie';
import { isEmpty, isEqual } from 'lodash';
import { startChildPayload } from './utils/startChildPayload';
import { Workflow, WorkflowStatus, Signal, Query, Hook, Before, After, Property, Condition, Step, ContinueAsNew } from './Workflow';
import { getSchema } from "./SchemaConfig";


export type ManagedPath = {
  schemaName?: string;
  path?: string;
  workflowType?: string;
  idAttribute?: string;
  autoStartChildren?: boolean;
};

export type Subscription = {
  workflowId: string;
  signalName: string;
  selector: string;
};

export type StatefulWorkflowParams = {
  pid?: string;
  state?: EntitiesState;
  status?: WorkflowStatus;
  entityName?: string;
  subscriptions?: Subscription[];
  url?: string;
  token?: string;
};

export abstract class StatefulWorkflow extends Workflow {
  // @ts-ignore
  protected schema: Schema;

  @Property({ set: false })
  protected state: EntitiesState = {};

  @Property({ set: false })
  protected pendingChanges: any[] = [];

  @Property({ set: false })
  protected subscriptions: Subscription[] = [];

  @Property({ set: false })
  protected managedPaths: ManagedPath[] = [];

  @Property({ set: false })
  protected token?: string;

  @Property({ set: false })
  protected id?: string;

  @Property({ set: false })
  protected pid?: string;

  @Property({ set: false })
  protected entityName?: string;

  @Property({ set: false })
  protected url?: string;

  @Signal('token')
  public setToken(token: string): void {
    if (token && this.token !== token) {
      this.log.info(`Updating token...`);
      this.token = token;
      this.pendingUpdate = true;
    }
  }

  protected abstract loadData?: () => Promise<any>;

  constructor(params?: StatefulWorkflowParams, protected options?: { schema?: Schema; schemaName?: string; [key: string]: any }) {
    super(params, options);
    Object.assign(this, params);
    this.options = options;
    if (this.options?.schema) {
      this.schema = this.options.schema;
      this.configureManagedPaths(this.options.schema);
    } else if (this.options?.schemaName) {
      const schemas = options?.schemas ?? getSchema();
      if (schemas) {
        this.schema = schemas[this.options?.schemaName as string];
        if (this.schema) { // @ts-ignore
          this.configureManagedPaths(this.schema);
        }
      }
    }
  }

  @Signal()
  public update({ updates, entityName, strategy = '$merge' }: { updates: any; entityName: string; strategy?: string }): void {
    this.pendingChanges.push({ updates, entityName, strategy });
  }

  @Signal()
  public delete({ deletions, entityName }: { deletions: any; entityName: string }): void {
    this.pendingChanges.push({ deletions, entityName });
  }

  @Signal()
  public async subscribe(subscription: Subscription): Promise<void> {
    const { workflowId, signalName, selector } = subscription;
    if (!this.subscriptions.find(sub => sub.workflowId === workflowId && sub.selector === selector && sub.signalName === signalName)) {
      this.subscriptions.push(subscription);
      this.handles[workflowId] = await workflow.getExternalWorkflowHandle(workflowId);
    }
  }

  @Signal()
  public async unsubscribe(subscription: Subscription): Promise<void> {
    const index = this.subscriptions.findIndex(sub => sub.workflowId === subscription.workflowId && sub.selector === subscription.selector && sub.signalName === subscription.signalName);
    if (index !== -1) {
      delete this.handles[subscription.workflowId];
      this.subscriptions.splice(index, 1);
    }
  }

  protected initializeState(params: any): void {
    if (this.options?.schema && params.data) {
      this.state = normalizeEntities(params.data, this.options.schema as schema.Entity);
    } else if (params.data) {
      this.state = params.data;
    }
  }

  @Before("execute")
  protected async processState(): Promise<void> {
    while (this.pendingChanges.length > 0) {
      const change = this.pendingChanges.shift();
      const previousState = this.state;
      const newState = reducer(this.state, {
        type: change?.deletions ? DELETE_ENTITIES : UPDATE_ENTITIES,
        entities: normalizeEntities(change?.deletions || change?.updates, this.schema as schema.Entity),
      });

      if (newState) {
        const differences = detailedDiff(previousState, newState);
        if (!isEmpty(differences.added) || !isEmpty(differences.updated) || !isEmpty(differences.deleted)) {
          await this.processChildState(newState, differences, previousState);
          this.state = newState;
        }
      }
    }
  }

  protected async processChildState(newState: EntitiesState, differences: DetailedDiff, previousState: EntitiesState): Promise<void> {
    const denormalizedState = denormalize(
      get(newState, `${this.entityName}.${this.id || this.pid}`),
      this?.schema as Schema,
      newState
    );

    console.log(this.schema);
    console.log(`denormalized`);
    console.log(denormalizedState);
    console.log(`differences`);
    console.log(differences);

    for (const config of this.managedPaths) {
      const value = get(denormalizedState, config.path as string, false);
      if (Array.isArray(value)) {
        await this.processArrayItems(value, config, differences, previousState);
      } else if (value && typeof value === 'object') {
        await this.processItem(value, config,
          get(differences, `added.${config.schemaName}.${value[config.idAttribute as string]}`)
          || get(differences, `updated.${config.schemaName}.${value[config.idAttribute as string]}`), previousState
        );
      }
    }
  }

  protected async processArrayItems(items: any[], config: ManagedPath, differences: DetailedDiff, previousState: EntitiesState): Promise<void> {
    const currentItems = get(previousState, config.path as string, []);
    for (const newItem of items) {
      const difference = get(differences, `added.${config.schemaName as string}.${newItem[config.idAttribute as string]}`) as DetailedDiff ||
        get(differences, `updated.${config.schemaName as string}.${newItem[config.idAttribute as string]}`) as DetailedDiff;

      await this.processItem(newItem, config, difference, previousState);
    }

    for (const currentItem of currentItems) {
      if (get(differences, `deleted.${config.schemaName as string}.${currentItem[config.idAttribute as string]}`)) {
        await this.processDeletion(currentItem[config.idAttribute as string], config);
      }
    }
  }

  protected async processItem(
    item: any,
    config: ManagedPath,
    difference: DetailedDiff,
    previousState: EntitiesState
  ): Promise<void> {
    const id = item[config.idAttribute as string];
    const existingHandle = this.handles[id];

    // Extract the relevant part of the state to compare
    const previousItem = get(previousState, `${config.schemaName as string}.${id}`);
    const newItem = get(this.state, `${config.schemaName as string}.${id}`);

    console.log(previousItem);
    console.log(newItem);

    // Compare the previous and current state
    const hasStateChanged = !isEqual(previousItem, newItem);

    // Proceed only if the state has changed
    if (hasStateChanged) {
      if (existingHandle && difference) {
        console.log(`Updating a child process for ${config.schemaName}...`);
        // @ts-ignore
        await this.updateChildWorkflow(existingHandle, item, config);
      } else if (!existingHandle && difference) {
        console.log(`Starting a new child process for ${config.schemaName}...`);
        await this.startChildWorkflow(config.workflowType!, id, item, config.schemaName!);
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
      console.error(`[${this.constructor.name}] Failed to cancel child workflow: ${(err as Error).message}`);
    }
  }

  protected async startChildWorkflow(
    workflowType: string,
    workflowId: string,
    item: any,
    schemaName: string
  ): Promise<void> {
    try {
      const childHandle = await workflow.startChild(workflowType, {
        workflowId,
        args: [item],
      });

      this.handles[workflowId] = childHandle;
      this.emit(`childStarted:${workflowType}`, childHandle.workflowId, item);
    } catch (err) {
      // Improved error handling
      if (err instanceof Error) {
        console.error(
          `[${this.constructor.name}] Failed to start new child workflow: ${err.message}`
        );
      } else {
        console.error(
          `[${this.constructor.name}] An unknown error occurred while starting a new child workflow`
        );
      }
    }
  }

  protected async updateChildWorkflow(
    handle: workflow.ChildWorkflowHandle<any>,
    item: any,
    config: ManagedPath
  ): Promise<void> {
    try {
      // Normalize the item using the provided schemaName
      const normalizedState = normalizeEntities({ ...item }, config.schemaName as string).entities;

      // Send the update signal to the child workflow
      await handle.signal('update', { state: normalizedState });

      // Emit an event indicating that the child workflow has been updated
      this.emit(`childUpdated:${config.workflowType}`, handle.workflowId, item);
    } catch (err) {
      if (err instanceof Error) {
        console.error(
          `[${this.constructor.name}] Failed to signal existing workflow handle: ${err.message}`
        );
      } else {
        console.error(
          `[${this.constructor.name}] An unknown error occurred while signaling the child workflow`
        );
      }
    }
  }

  protected configureManagedPaths(parentSchema: Schema & { schema?: { [key: string]: Schema & [{ _idAttribute: string; _key: string; }]; }; }): void {
    this.log.debug(`[Workflow]:${this.constructor.name}:configureManagedPaths`);
    if (!parentSchema.schema) {
      throw new Error("The provided schema does not have 'schema' defined.");
    }
    const childSchemas = parentSchema.schema;
    for (const [path, schema] of Object.entries(childSchemas)) {
      this.managedPaths.push({
        path,
        idAttribute: schema[0]._idAttribute,
        workflowType: `${schema[0]._key}Workflow`,
        autoStartChildren: true,
        schemaName: schema[0]._key,
      });
    }
  }

  protected abstract execute(...args: unknown[]): Promise<unknown>;

  protected async executeWorkflow(): Promise<any> {
    const tracer = trace.getTracer('temporal-worker');
    return tracer.startActiveSpan(`[StatefulWorkflow]:${this.constructor.name}`, async (span) => {
      try {
        span.setAttributes({ workflowId: workflow.workflowInfo().workflowId, workflowType: workflow.workflowInfo().workflowType });

        while (this.iteration <= this.maxIterations) {
          await this.awaitCondition();

          if (this.status === 'paused') {
            await this.handlePause();
          }

          if (this.shouldLoadData()) {
            await this.loadDataAndEnqueueChanges();
          }

          const result = await this.execute();
          if (this.isInTerminalState()) {
            span.end();
            return result;
          } else if (++this.iteration >= this.maxIterations) {
            await this.handleMaxIterations();
          } else {
            this.pendingUpdate = false;
          }
        }
      } catch (err) {
        await this.handleExecutionError(err, span);
      }
      return;
    });
  }

  // @ContinueAsNew()
  // protected async continueAsNewHandler(): Promise<void> {
  //   // @ts-ignore
  //   await workflow.continueAsNew<typeof this>({
  //     state: this.state,
  //     status: this.status,
  //     subscriptions: this.subscriptions,
  //     id: this.id,
  //     pid: this.pid,
  //     entityName: this.entityName,
  //     token: this.token,
  //     url: this.url,
  //   });
  // }

  protected async handlePause(): Promise<void> {
    await Promise.all(this.subscriptions.map(async (sub) => {
      try {
        await this.handles[sub.workflowId].signal('pause');
      } catch (err) {
        console.error(err);
      }
    }));
    await workflow.condition(() => this.status !== 'paused');
  }

  protected shouldLoadData(): boolean {
    return typeof this.loadData === "function";
  }

  protected async loadDataAndEnqueueChanges(): Promise<void> {
    if (typeof this.loadData === "function") {
      const updates = await this.loadData();
      this.pendingChanges.push({ updates, entityName: this.entityName, strategy: '$merge' });
    }
  }
}
