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

const workflowCoverage = new WorkflowCoverage();

describe('StatefulWorkflow', () => {
  let testEnv: TestWorkflowEnvironment;
  let worker: Worker;
  let client: WorkflowClient;
  let nativeConnection;
  let shutdown;
  let getClient;
  let execute: (workflowName: string, params: StatefulWorkflowParams, timeout: number) => ReturnType<client.workflow.start>;

  jest.setTimeout(30000 * 1);

  const mockActivities = {
    makeHTTPRequest: async () => '99'
  };

  beforeAll(async () => {
    // @ts-ignore
    logger.trace = (...args) => logger.debug(...args);

    Runtime.install({
      telemetryOptions: {
        metrics: {
          prometheus: { bindAddress: '0.0.0.0:8889' }
          // otel: { url: "grpc://localhost:4317" },
        },
        logging: {}
      }, //@ts-ignore
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

  // describe('State Management', () => {
  it('Should use state provided in params', async () => {
    const userId = uuid4();
    const data = {
      id: userId,
      listings: [
        {
          id: uuid4(),
          name: 'Awesome test listing'
        }
      ]
    };
    const normalizedData = {
      Listing: {
        [data.listings[0].id]: {
          id: data.listings[0].id,
          name: 'Awesome test listing'
        }
      },
      User: {
        [data.id]: {
          id: data.id,
          listings: [data.listings[0].id]
        }
      }
    };

    const handle = await execute(workflows.ShouldExecuteStateful, {
      id: data.id,
      entityName: 'User',
      state: normalizedData
    });

    await new Promise(async (resolve) => {
      const state = await handle.query('state');
      expect(state).toEqual(normalizedData);
      await handle.cancel();
      await resolve();
    });
  });

  describe('Workflow State Management', () => {
    it('Should initialise state from data params', async () => {
      const data = {
        id: uuid4(),
        listings: [
          {
            id: uuid4(),
            name: 'Awesome test listing'
          }
        ]
      };

      const handle = await execute(workflows.ShouldExecuteStateful, {
        id: data.id,
        entityName: 'User',
        data
      });

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

    it('Should update state and child workflow correctly', async () => {
      const data = {
        id: uuid4(),
        listings: [
          {
            id: uuid4(),
            name: 'Awesome test listing'
          }
        ]
      };

      const handle = await execute(workflows.ShouldExecuteStateful, {
        id: data.id,
        entityName: 'User',
        data
      });

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
      const expectedUpdated = normalizeEntities(
        {
          ...data,
          update: 'fromUpdate',
          listings: [{ ...data.listings[0], update: 'fromUpdate' }]
        },
        SchemaManager.getInstance().getSchema('User')
      );

      await handle.signal('update', {
        data: { ...data, update: 'fromUpdate', listings: [{ ...data.listings[0], update: 'fromUpdate' }] },
        entityName: 'User'
      });

      await new Promise((resolve) => {
        setTimeout(async () => {
          const updatedData = await handle.query('state');
          expect(updatedData).toEqual(expectedUpdated);
          resolve();
        }, 2000);
      });

      // Verify child workflow state
      const client = getClient();
      const childHandle = await client.workflow.getHandle(`Listing-${data.listings[0].id}`);
      const updatedListingData = await childHandle.query('state');
      expect(updatedListingData).toEqual({
        Listing: expectedUpdated.Listing
      });

      await childHandle.signal('update', {
        data: {
          id: data.listings[0].id,
          updated: 'directly'
        },
        entityName: 'Listing',
        strategy: '$merge'
      });

      await new Promise((resolve) => {
        setTimeout(async () => {
          const childUpdatedParentData = await handle.query('state');
          expect(childUpdatedParentData).toEqual(expectedUpdated);
          resolve();
        }, 2500);
      });

      // Cleanup
      await handle.cancel();
    });
  });
});
