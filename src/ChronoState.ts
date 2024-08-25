import * as workflow from '@temporalio/workflow';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { normalizeEntities, reducer, EntitiesState, UPDATE_ENTITIES, DELETE_ENTITIES } from './utils/entities';
import { detailedDiff, DetailedDiff } from 'deep-object-diff';
import { denormalize, Schema } from 'normalizr';
import { get, set } from 'dottie';
import { isEmpty, isEqual } from 'lodash';
import { startChildPayload } from './utils/startChildPayload';

export {
  Workflow,
  Signal,
  Query,
  Hook,
  Before,
  After,
  Property,
  Condition,
  Step
} from './ChronoState';

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

export type WorkflowStatus = 'running' | 'paused' | 'complete' | 'cancelled' | 'errored';

export type StatefulWorkflowParams = {
  pid?: string;
  state?: EntitiesState;
  status?: WorkflowStatus;
  entityName?: string;
  subscriptions?: Subscription[];
  url?: string;
  token?: string;
};

abstract class StatefulWorkflowClass extends WorkflowClass {
  protected MAX_ITERATIONS = 10000;
  protected state: EntitiesState = {};
  protected pendingChanges: any[] = [];
  protected subscriptions: Subscription[] = [];
  protected managedPaths: ManagedPath[] = [];
  protected status: WorkflowStatus = 'running';
  protected token?: string;
  protected iteration: number = 0;

  constructor(params?: StatefulWorkflowParams, private options?: { schema?: Schema }) {
    super();
    Object.assign(this, params);
    this.options = options;
    if (this.options?.schema) {
      this.configureManagedPaths(this.options.schema);
    }
  }

  protected initializeState(params: any): void {
    if (this.options?.schema && params.data) {
      this.state = normalizeEntities(params.data, this.options.schema);
    } else if (params.data) {
      this.state = params.data;
    }
  }

  @Query('state')
  public getState(path?: string): EntitiesState {
    return path ? this.state[path] : this.state;
  }

  @Query('status')
  public getStatus(): WorkflowStatus {
    return this.status;
  }

  @Query('iteration')
  public getIteration(): number {
    return this.iteration;
  }

  @Query('pendingChanges')
  public getPendingChanges(): any[] {
    return this.pendingChanges;
  }

  @Query('subscriptions')
  public getSubscriptions(): Subscription[] {
    return this.subscriptions;
  }

  @Query('managedPaths')
  public getManagedPaths(): ManagedPath[] {
    return this.managedPaths;
  }

  @Query('token')
  public getToken(): string {
    return this.token || '';
  }

  @Signal('status')
  public setStatus({ status }: { status: WorkflowStatus }): void {
    this.status = status;
  }

  @Signal('token')
  public setToken({ token }: { token: string }): void {
    if (token && this.token !== token) {
      this.token = token;
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
  public pause(): void {
    this.status = 'paused';
  }

  @Signal()
  public resume(): void {
    this.status = 'running';
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

  protected async processState(): Promise<void> {
    while (this.pendingChanges.length > 0) {
      const change = this.pendingChanges.shift();
      const newState = reducer(this.state, {
        type: change?.deletions ? DELETE_ENTITIES : UPDATE_ENTITIES,
        entities: normalizeEntities(change?.deletions || change?.updates, this.options?.schema),
      });

      if (newState) {
        const differences = detailedDiff(this.state, newState);
        if (!isEmpty(differences.added) || !isEmpty(differences.updated) || !isEmpty(differences.deleted)) {
          await this.processChildState(newState, differences);
          this.state = newState;
        }
      }
    }
  }

  protected async processChildState(newState: EntitiesState, differences: DetailedDiff): Promise<void> {
    const denormalizedState = denormalize(get(newState, `${this.entityName}.${this.id || this.pid}`), this.options?.schema, newState);
    for (const config of this.managedPaths) {
      const value = get(denormalizedState, config.path, false);

      if (Array.isArray(value)) {
        await this.processArrayItems(value, config, differences);
      } else if (value && typeof value === 'object') {
        await this.processItem(value, config, get(differences, `added.${config.schemaName}.${value[config.idAttribute]}`) || get(differences, `updated.${config.schemaName}.${value[config.idAttribute]}`));
      }
    }
  }

  private async processArrayItems(items: any[], config: ManagedPath, differences: DetailedDiff): Promise<void> {
    const currentItems = get(this.state, config.path, []);
    for (const newItem of items) {
      const difference = get(differences, `added.${config.schemaName}.${newItem[config.idAttribute]}`) || get(differences, `updated.${config.schemaName}.${newItem[config.idAttribute]}`);
      await this.processItem(newItem, config, difference);
    }

    for (const currentItem of currentItems) {
      if (get(differences, `deleted.${config.schemaName}.${currentItem[config.idAttribute]}`)) {
        await this.processDeletion(currentItem[config.idAttribute], config);
      }
    }
  }

  private async processItem(item: any, config: ManagedPath, difference: DetailedDiff): Promise<void> {
    const id = item[config.idAttribute];
    const existingHandle = this.handles[id];

    if (existingHandle && difference) {
      await this.updateChildWorkflow(existingHandle, item, config);
    } else if (!existingHandle && difference) {
      await this.startChildWorkflow(config.workflowType!, id, item, config.schemaName!);
    }
  }

  private async processDeletion(id: string, config: ManagedPath): Promise<void> {
    try {
      await this.handles[id]?.cancel();
      this.emit(`childCancelled:${config.workflowType}`, id);
    } catch (err) {
      console.error(`[${this.constructor.name}] Failed to cancel child workflow: ${err.message}`);
    }
  }

  private async updateChildWorkflow(handle: any, item: any, config: ManagedPath): Promise<void> {
    try {
      await handle.signal('update', { state: normalizeEntities({ ...item }, config.schemaName).entities });
      this.emit(`childUpdated:${config.workflowType}`, handle.workflowId, item);
    } catch (err) {
      console.error(`[${this.constructor.name}] Failed to signal existing workflow handle: ${err.message}`);
    }
  }

  protected async startChildWorkflow(workflowType: string, workflowId: string, item: any, schemaName: string): Promise<void> {
    try {
      const childHandle = await workflow.startChild(workflowType, startChildPayload(workflowId, [item])).result();
      this.handles[workflowId] = childHandle;
      this.emit(`childStarted:${workflowType}`, childHandle.workflowId, item);
    } catch (err) {
      console.error(`[${this.constructor.name}] Failed to start new child workflow: ${err.message}`);
    }
  }

  protected configureManagedPaths(parentSchema: Schema): void {
    const childSchemas = parentSchema.entitySchema;
    for (const [path, schema] of Object.entries(childSchemas || {})) {
      this.managedPaths.push({
        path,
        idAttribute: schema._idAttribute,
        workflowType: `${schema._key}Workflow`,
        autoStartChildren: true,
        schemaName: schema._key,
      });
    }
  }

  protected abstract execute(...args: unknown[]): Promise<unknown>;

  protected async executeWorkflow(params: StatefulWorkflowParams): Promise<any> {
    const tracer = trace.getTracer('chrono-forge');

    return tracer.startActiveSpan(`[Workflow]:${this.constructor.name}`, async (span) => {
      try {
        span.setAttributes({ workflowId: workflow.workflowInfo().workflowId, workflowType: workflow.workflowInfo().workflowType });

        while (this.iteration <= this.MAX_ITERATIONS) {
          await this.awaitCondition();

          if (this.status === 'paused') {
            await this.handlePause();
          }

          if (this.shouldLoadData()) {
            await this.loadDataAndEnqueueChanges();
          }

          await this.processState();

          const result = await this.execute(params);
          if (this.isInTerminalState()) {
            span.end();
            return result;
          } else if (++this.iteration >= this.MAX_ITERATIONS) {
            await this.handleMaxIterations();
          } else {
            this.pendingUpdate = false;
          }
        }
      } catch (err) {
        await this.handleExecutionError(err, span);
      }
    });
  }

  private async awaitCondition(): Promise<void> {
    await workflow.condition(() => this.pendingUpdate || this.pendingChanges.length > 0 || this.status !== 'running');
  }

  private shouldLoadData(): boolean {
    return (this.id || this.pid) && this.entityName && this.token && this.url && this.loadData;
  }

  private async loadDataAndEnqueueChanges(): Promise<void> {
    const updates = await this.loadData();
    this.pendingChanges.push({ updates, entityName: this.entityName, strategy: '$merge' });
  }

  private isInTerminalState(): boolean {
    return ['complete', 'cancelled', 'errored'].includes(this.status);
  }

  private async handleMaxIterations(): Promise<void> {
    await workflow.continueAsNew<StatefulWorkflowClass>({
      state: this.state,
      status: this.status,
      subscriptions: this.subscriptions,
      id: this.id,
      pid: this.pid,
      entityName: this.entityName,
      token: this.token,
      url: this.url,
    });
  }

  private async handlePause(): Promise<void> {
    await Promise.all(this.subscriptions.map(async (sub) => {
      try {
        await this.handles[sub.workflowId].signal('pause');
      } catch (err) {
        console.error(err);
      }
    }));
    await workflow.condition(() => this.status !== 'paused');
  }

  private async handleExecutionError(err: any, span: any): Promise<void> {
    if (workflow.isCancellation(err)) {
      span.setAttribute('cancelled', true);
      await workflow.CancellationScope.nonCancellable(async () => {
        for (const handle of Object.values(this.handles)) {
          try {
            await handle.cancel();
          } catch (error) {
            console.error(error);
          }
        }
        throw err;
      });
    } else {
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      throw err;
    }
  }
}

export { On, Query, Signal };
