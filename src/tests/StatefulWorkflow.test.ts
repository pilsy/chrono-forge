/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import path from 'path';
import { WorkflowCoverage } from '@temporalio/nyc-test-coverage';
import { Workflow, ChronoFlow, Signal, Query, StatefulWorkflowParams } from '../index';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker, Runtime, DefaultLogger, LogEntry } from '@temporalio/worker';
import { WorkflowClient } from '@temporalio/client';
import { v4 as uuid4 } from 'uuid';
import { SchemaManager } from '../SchemaManager';
import * as workflows from './testWorkflows';
import { schema } from 'normalizr';
import { logger } from '../utils/logger';
import { OpenTelemetryActivityInboundInterceptor, makeWorkflowExporter } from '@temporalio/interceptors-opentelemetry/lib/worker';
import { normalizeEntities } from '../utils/entities';
import { getExternalWorkflowHandle } from '@temporalio/workflow';
import { cloneDeep } from 'lodash';
import { get, set } from 'dottie';

const workflowCoverage = new WorkflowCoverage();

describe('StatefulWorkflow', () => {
  let testEnv: TestWorkflowEnvironment;
  let worker: Worker;
  let client: WorkflowClient;
  let nativeConnection;
  let shutdown;
  let getClient;
  let execute: (workflowName: string, params: StatefulWorkflowParams, timeout: number) => ReturnType<client.workflow.start>;

  jest.setTimeout(30000);

  const mockActivities = {
    makeHTTPRequest: async () => '99'
  };

  beforeAll(async () => {
    Runtime.install({
      telemetryOptions: {
        metrics: { prometheus: { bindAddress: '0.0.0.0:8889' } },
        logging: {}
      },
      logger
    });

    testEnv = await TestWorkflowEnvironment.createLocal();
    const { client: workflowClient, nativeConnection: nc } = testEnv;
    client = workflowClient;
    nativeConnection = nc;
    worker = await Worker.create(
      workflowCoverage.augmentWorkerOptions({
        connection: nativeConnection,
        taskQueue: 'test',
        workflowsPath: path.resolve(__dirname, './testWorkflows'),
        activities: mockActivities,
        debugMode: true
      })
    );

    const runPromise = worker.run();
    shutdown = async () => {
      worker.shutdown();
      await runPromise;
      await testEnv.teardown();
    };
    getClient = () => testEnv.client;
  }, 45000);

  beforeEach(() => {
    const client = getClient();

    execute = (workflowName: string, params: StatefulWorkflowParams, workflowExecutionTimeout = 30000) => {
      console.log(`Starting workflow: ${params.entityName}-${params.id}`);
      return client.workflow.start(workflowName, {
        taskQueue: 'test',
        workflowExecutionTimeout,
        workflowId: `${params.entityName}-${params.id}`,
        args: [params]
      });
    };
  });

  afterAll(async () => {
    await shutdown();
  });

  describe('Workflow State Management', () => {
    it('Should use state provided in params', async () => {
      const userId = uuid4();
      const data = {
        id: userId,
        listings: [{ id: uuid4(), name: 'Awesome test listing' }]
      };
      const normalizedData = normalizeEntities(data, SchemaManager.getInstance().getSchema('User'));

      const handle = await execute(workflows.ShouldExecuteStateful, { id: data.id, entityName: 'User', state: normalizedData });

      await new Promise(async (resolve) => {
        const state = await handle.query('state');
        expect(state).toEqual(normalizedData);
        await handle.cancel();
        resolve();
      });
    });

    it('Should initialise state from data params', async () => {
      const data = { id: uuid4(), listings: [{ id: uuid4(), name: 'Awesome test listing' }] };
      const handle = await execute(workflows.ShouldExecuteStateful, { id: data.id, entityName: 'User', data });
      const expectedInitial = normalizeEntities(data, SchemaManager.getInstance().getSchema('User'));

      await new Promise((resolve) => {
        setTimeout(async () => {
          const state = await handle.query('state');
          expect(state).toEqual(expectedInitial);
          await handle.cancel();
          resolve();
        }, 2000);
      });
    });

    it('Should update state and child workflow and maintain state in parent and child correctly', async () => {
      const data = { id: uuid4(), listings: [{ id: uuid4(), name: 'Awesome test listing' }] };
      const handle = await execute(workflows.ShouldExecuteStateful, { id: data.id, entityName: 'User', data });
      const expectedInitial = normalizeEntities(data, SchemaManager.getInstance().getSchema('User'));

      // Initial state verification
      await new Promise((resolve) => {
        setTimeout(async () => {
          const state = await handle.query('state');
          expect(state).toEqual(expectedInitial);
          resolve();
        }, 2000);
      });

      // Update state
      const updatedData = { ...data, update: 'fromUpdate', listings: [{ ...data.listings[0], update: 'fromUpdate' }] };
      const expectedUpdated = normalizeEntities(updatedData, SchemaManager.getInstance().getSchema('User'));

      await handle.signal('update', { data: updatedData, entityName: 'User' });

      await new Promise((resolve) => {
        setTimeout(async () => {
          const updatedState = await handle.query('state');
          expect(updatedState).toEqual(expectedUpdated);
          resolve();
        }, 2000);
      });

      // Verify child workflow state
      const client = getClient();
      const childHandle = await client.workflow.getHandle(`Listing-${data.listings[0].id}`);
      const updatedListingState = await childHandle.query('state');
      expect(updatedListingState).toEqual({ Listing: expectedUpdated.Listing });

      await new Promise((resolve) => {
        setTimeout(async () => {
          await childHandle.signal('update', {
            data: { id: data.listings[0].id, update: 'directly' },
            entityName: 'Listing',
            strategy: '$merge'
          });
          setTimeout(async () => {
            const parentData = await handle.query('state');
            const childData = await childHandle.query('state');

            expect(parentData).toEqual(
              normalizeEntities(
                { ...data, update: 'fromUpdate', listings: [{ ...data.listings[0], update: 'directly' }] },
                SchemaManager.getInstance().getSchema('User')
              )
            );
            expect(childData).toEqual({
              Listing: {
                [data.listings[0]?.id]: {
                  ...data.listings[0],
                  update: 'directly'
                }
              }
            });

            resolve();
          }, 2500);
        }, 2500);
      });

      // Cleanup
      await handle.cancel();
    });

    it('Should correctly handle deep nested updates in the state', async () => {
      const data = { id: uuid4(), listings: [{ id: uuid4(), nested: { id: uuid4(), name: 'Nested Item' } }] };
      const handle = await execute(workflows.ShouldExecuteStateful, { id: data.id, entityName: 'User', data });

      await handle.signal('update', {
        data: { ...data, listings: [{ ...data.listings[0], nested: { ...data.listings[0].nested, name: 'Updated Nested' } }] },
        entityName: 'User'
      });

      const updatedState = await handle.query('state');
      expect(updatedState.User[data.id].listings).toContainEqual(
        expect.objectContaining({ nested: { id: data.listings[0].nested.id, name: 'Updated Nested' } })
      );

      await handle.cancel();
    });

    it('Should handle child workflow cancellation and reflect in parent state', async () => {
      const data = { id: uuid4(), listings: [{ id: uuid4(), name: 'Awesome test listing' }] };
      const handle = await execute(workflows.ShouldExecuteStateful, { id: data.id, entityName: 'User', data });

      const client = getClient();
      const childHandle = await client.workflow.getHandle(`Listing-${data.listings[0].id}`);
      await childHandle.cancel();

      const parentState = await handle.query('state');
      expect(parentState.Listing).not.toHaveProperty(data.listings[0].id);

      await handle.cancel();
    });

    it('Should propagate updates correctly with multiple child workflows', async () => {
      const data = {
        id: uuid4(),
        listings: [
          { id: uuid4(), name: 'Listing One' },
          { id: uuid4(), name: 'Listing Two' }
        ]
      };
      const handle = await execute(workflows.ShouldExecuteStateful, { id: data.id, entityName: 'User', data });

      const update = { id: data.listings[1].id, name: 'Updated Listing Two' };
      await handle.signal('update', { data: { ...data, listings: [{ ...data.listings[0] }, update] }, entityName: 'User' });

      const updatedState = await handle.query('state');
      expect(updatedState.Listing[data.listings[1].id]).toEqual(update);

      await handle.cancel();
    });

    it('Should manage circular relationships without causing infinite loops', async () => {
      const userId = uuid4();
      const postId = uuid4();
      const data = {
        id: userId,
        posts: [{ id: postId, content: 'Hello World', author: { id: userId } }]
      };
      const handle = await execute(workflows.ShouldExecuteStateful, { id: data.id, entityName: 'User', data });

      const client = getClient();
      const childHandle = await client.workflow.getHandle(`Post-${postId}`);

      await childHandle.signal('update', { data: { id: postId, content: 'Updated Content' }, entityName: 'Post' });

      const parentData = await handle.query('state');
      expect(parentData.User[userId].posts[0].content).toEqual('Updated Content');

      await handle.cancel();
    });

    it('Should handle rapid succession of updates correctly', async () => {
      const data = { id: uuid4(), listings: [{ id: uuid4(), name: 'Listing' }] };
      const handle = await execute(workflows.ShouldExecuteStateful, { id: data.id, entityName: 'User', data });

      for (let i = 0; i < 5; i++) {
        await handle.signal('update', { data: { ...data, update: `update-${i}` }, entityName: 'User' });
      }

      const finalState = await handle.query('state');
      expect(finalState.User[data.id].update).toEqual('update-4');

      await handle.cancel();
    });

    it('Should manage workflow state consistency during failure and retry scenarios', async () => {
      const data = { id: uuid4(), listings: [{ id: uuid4(), name: 'Listing' }] };
      const handle = await execute(workflows.ShouldExecuteStateful, { id: data.id, entityName: 'User', data });

      try {
        await handle.signal('update', { data: null, entityName: 'User' }); // Simulate error with invalid data
      } catch (error) {
        expect(error).toBeDefined();
      }

      const stateAfterFailure = await handle.query('state');
      expect(stateAfterFailure.User).toBeDefined();

      await handle.cancel();
    });

    it('Should support dynamic subscription management and state propagation', async () => {
      const data = { id: uuid4(), listings: [{ id: uuid4(), name: 'Listing' }] };
      const handle = await execute(workflows.ShouldExecuteStateful, { id: data.id, entityName: 'User', data });

      // Add subscription dynamically
      const childHandle = await client.workflow.getHandle(`Listing-${data.listings[0].id}`);
      await childHandle.signal('subscribe', { selector: 'User.*', signalName: 'update' });

      // Trigger state update
      await handle.signal('update', { data: { ...data, update: 'new-update' }, entityName: 'User' });

      const updatedChildState = await childHandle.query('state');
      expect(updatedChildState.Listing[data.listings[0].id].update).toEqual('new-update');

      await handle.cancel();
    });

    it('Should correctly handle batch updates and state synchronization across workflows', async () => {
      const data = {
        id: uuid4(),
        listings: [
          { id: uuid4(), name: 'Listing 1' },
          { id: uuid4(), name: 'Listing 2' }
        ]
      };
      const handle = await execute(workflows.ShouldExecuteStateful, { id: data.id, entityName: 'User', data });

      const batchUpdate = { listings: data.listings.map((listing) => ({ ...listing, updated: 'batch' })) };
      await handle.signal('update', { data: { ...data, ...batchUpdate }, entityName: 'User' });

      const stateAfterBatchUpdate = await handle.query('state');
      data.listings.forEach((listing) => {
        expect(stateAfterBatchUpdate.Listing[listing.id].updated).toEqual('batch');
      });

      await handle.cancel();
    });
  });
});
