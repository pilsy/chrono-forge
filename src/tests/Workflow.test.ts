/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import path from 'path';
import { WorkflowCoverage } from '@temporalio/nyc-test-coverage';
import { Workflow, ChronoFlow, Signal, Query } from '../index';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker, Runtime, DefaultLogger, LogEntry } from '@temporalio/worker';
import { WorkflowClient } from '@temporalio/client';
import { v4 as uuid4 } from 'uuid';
import * as workflows from './testWorkflows';
import { makeWorkflowExporter, OpenTelemetryActivityInboundInterceptor } from '@temporalio/interceptors-opentelemetry/lib/worker';
import { getExporter, getResource, getTracer } from '../utils/instrumentation';

const sleep = async (duration = 2000) =>
  new Promise((resolve) => {
    setTimeout(async () => {
      resolve();
    }, duration);
  });

const workflowCoverage = new WorkflowCoverage();
const tracer = getTracer('temporal_worker');
const exporter = getExporter('temporal_worker');
const resource = getResource('temporal_worker');

describe('Workflow', () => {
  let testEnv: TestWorkflowEnvironment;
  let worker: Worker;
  let client: WorkflowClient;
  let nativeConnection;
  let shutdown;
  let getClient;
  let execute;
  let signalWithStart;

  jest.setTimeout(30000);

  const mockActivities = {
    makeHTTPRequest: async () => '99'
  };

  beforeAll(async () => {
    // Runtime.install({
    //   logger: new DefaultLogger('WARN', (entry: LogEntry) => console.log(`[${entry.level}]`, entry.message))
    // });

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
        debugMode: true,
        sinks: {
          exporter: makeWorkflowExporter(exporter, resource)
        },
        interceptors: {
          workflowModules: [require.resolve('./testWorkflows'), require.resolve('../workflows')],
          activityInbound: [(ctx) => new OpenTelemetryActivityInboundInterceptor(ctx)]
        }
      })
    );

    const runPromise = worker.run();
    shutdown = async () => {
      worker.shutdown();
      await runPromise;
      await testEnv.teardown();
    };
    getClient = () => testEnv.client;
  }, 20000);

  beforeEach(() => {
    const client = getClient();

    execute = (workflowName: string, exec = 'start', ...args) =>
      client.workflow[exec](workflowName, {
        taskQueue: 'test',
        workflowExecutionTimeout: 10000,
        workflowId: `test-${uuid4()}`,
        [exec === 'signalWithStart' ? 'signalArgs' : 'args']: args
      });

    signalWithStart = (workflowName: string, options) =>
      client.workflow.signalWithStart(workflowName, {
        taskQueue: 'test',
        workflowExecutionTimeout: 10000,
        workflowId: `test-${uuid4()}`,
        ...options
      });
  });

  afterAll(async () => {
    await shutdown();
    await exporter.forceFlush();
  }, 30000);

  describe('SignalWithStart', () => {
    it('Should call the execute() method with provided arguments', async () => {
      const args = [];
      const handle = await signalWithStart('ShouldSignalWithStartAndArguments', {
        workflowType: 'ShouldSignalWithStartAndArguments',
        workflowId: uuid4(),
        signal: 'start',
        signalArgs: [{ a: 1 }],
        workflowArgs: [{ a: 1 }]
      });
      await sleep();
      const result = await handle.query('data');

      expect(result).toEqual({ a: 1 });
    });
  });

  describe('Workflow Execution', () => {
    it('Should call the execute() method with provided arguments', async () => {
      const args = ['one', 'two', 'three'];
      const result = await execute(workflows.ShouldExecuteWithArguments, 'execute', ...args);

      expect(result).toBe(args.join(','));
    });
  });

  describe('Property Decorators', () => {
    it.skip('Should automatically create signals and queries for properties with default get/set', async () => {
      const handle = await execute(workflows.ShouldCreateDefaultPropertyAccessors);

      // Test setting a value
      await handle.signal('status', 'updated status');

      // Test getting the value
      const queryResult = await handle.query('status');

      expect(queryResult).toBe('updated status');
      expect(await handle.result()).toBe('updated status');
    });

    it.skip('Should create signals and queries with custom names', async () => {
      const handle = await execute(workflows.ShouldCreateCustomPropertyAccessors);

      // Test setting a value via custom signal
      await handle.signal('customSetSignal', 'custom value');

      // Test getting the value via custom query
      const queryResult = await handle.query('customGetQuery');

      expect(queryResult).toBe('custom value');
      expect(await handle.result()).toBe('custom value');
    });

    it.skip('Should disable setting a value when set is false', async () => {
      const handle = await execute(workflows.ShouldDisableSetForProperty);

      // Attempting to set a value should throw an error
      await expect(handle.signal('signalReadonlyProperty', 'new value')).rejects.toThrowError();
    });

    it.skip('Should invoke @Set decorated method when setting a value', async () => {
      const handle = await execute(workflows.ShouldInvokeSetMethodOnPropertySet);

      // Set a value using the signal
      await handle.signal('signalValue', 'setting via @Set decorator');

      // Ensure the method decorated with @Set was called
      expect(await handle.result()).toBe('Processed by @Set decorator');
    });

    it.skip('Should invoke @Get decorated method when getting a value', async () => {
      const handle = await execute(workflows.ShouldInvokeGetMethodOnPropertyGet);

      // Get a value using the query
      const queryResult = await handle.query('queryValue');

      // Ensure the method decorated with @Get was called
      expect(queryResult).toBe('Processed by @Get decorator');
      expect(await handle.result()).toBe('Processed by @Get decorator');
    });
  });

  describe('Signal Handling', () => {
    it('Should bind signals correctly', async () => {
      const handle = await execute(workflows.ShouldBindSignalsCorrectly);
      await handle.signal('status', 'updated');

      expect(await handle.result()).toBe('updated');
    });

    it('Should bind named signals correctly', async () => {
      const handle = await execute(workflows.ShouldBindNamedSignalsCorrectly);
      await handle.signal('status', 'updated');

      expect(await handle.result()).toBe('updated');
    });

    it('Should emit an event on signal invocation', async () => {
      const handle = await execute(workflows.ShouldEmitEventOnSignal);
      await handle.signal('status', 'updatedByEvent');

      expect(await handle.result()).toBe('updatedByEvent');
    });
  });

  describe('Query Handling', () => {
    it('Should bind queries correctly', async () => {
      const handle = await execute(workflows.ShouldBindQueriesCorrectly);
      const queryResult = await handle.query('getStatus');

      expect(queryResult).toBe('initial');
      expect(await handle.result()).toBe('initial');
    });
  });

  describe('Hook Handling', () => {
    it('Should apply @Before hook correctly', async () => {
      const result = await execute(workflows.ShouldApplyBeforeHooksCorrectly, 'execute');
      expect(result).toBe('beforeHookApplied');
    });

    it('Should apply before @Hook correctly', async () => {
      const result = await execute(workflows.ShouldApplyBeforeHooksCorrectly, 'execute');
      expect(result).toBe('beforeHookApplied');
    });

    it('Should apply @After hook correctly', async () => {
      const result = await execute(workflows.ShouldApplyAfterHooksCorrectly, 'execute');
      expect(result).toBe('afterHookApplied');
    });
  });
});

/*
Test Case Descriptions for Decorators
Property Decorator with Default Get/Set Behavior:

Ensure that properties decorated with @Property without specific get or set options have automatically generated signals and queries for getting and setting values.
Test that setting the value via signal correctly updates the property.
Property Decorator with Custom Get/Set Names:

Test that when @Property is used with custom get and set options, the signals and queries are registered under the provided names and invoke the correct methods.
Property Decorator with Disabled Set or Get:

Test that when @Property is used with get: false or set: false, the respective signal or query is not available, and attempts to access them should fail gracefully.
Set Decorator:

Ensure that methods decorated with @Set are correctly invoked when setting a value via signal.
Get Decorator:

Ensure that methods decorated with @Get are correctly invoked when querying a value via query.
*/
