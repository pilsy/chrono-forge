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

const workflowCoverage = new WorkflowCoverage();

describe('Workflow', () => {
  let testEnv: TestWorkflowEnvironment;
  let worker: Worker;
  let client: WorkflowClient;
  let nativeConnection;
  let shutdown;
  let getClient;
  let execute;

  jest.setTimeout(30000);

  const mockActivities = {
    makeHTTPRequest: async () => '99'
  };

  beforeAll(async () => {
    Runtime.install({
      logger: new DefaultLogger('WARN', (entry: LogEntry) => console.log(`[${entry.level}]`, entry.message))
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
        activities: mockActivities
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

    execute = (workflowName: string, exec = true, ...args) =>
      client.workflow[exec ? 'execute' : 'start'](workflowName, {
        taskQueue: 'test',
        workflowExecutionTimeout: 10000,
        workflowId: `test-${uuid4()}`,
        args
      });
  });

  afterAll(async () => {
    await shutdown();
    // await new Promise(resolve => {
    //   setTimeout(() => {
    //     workflowCoverage.mergeIntoGlobalCoverage();
    //     resolve();
    //   }, 10000);
    // })
  });

  describe('Workflow Execution', () => {
    it('Should call the execute() method with provided arguments', async () => {
      const args = ['one', 'two', 'three'];
      const result = await execute(workflows.ShouldExecuteWithArguments, true, ...args);

      expect(result).toBe(args.join(','));
    });
  });

  describe('Property Decorators', () => {
    it.skip('Should automatically create signals and queries for properties with default get/set', async () => {
      const handle = await execute(workflows.ShouldCreateDefaultPropertyAccessors, false);

      // Test setting a value
      await handle.signal('status', 'updated status');

      // Test getting the value
      const queryResult = await handle.query('status');

      expect(queryResult).toBe('updated status');
      expect(await handle.result()).toBe('updated status');
    });

    it.skip('Should create signals and queries with custom names', async () => {
      const handle = await execute(workflows.ShouldCreateCustomPropertyAccessors, false);

      // Test setting a value via custom signal
      await handle.signal('customSetSignal', 'custom value');

      // Test getting the value via custom query
      const queryResult = await handle.query('customGetQuery');

      expect(queryResult).toBe('custom value');
      expect(await handle.result()).toBe('custom value');
    });

    it.skip('Should disable setting a value when set is false', async () => {
      const handle = await execute(workflows.ShouldDisableSetForProperty, false);

      // Attempting to set a value should throw an error
      await expect(handle.signal('signalReadonlyProperty', 'new value')).rejects.toThrowError();
    });

    it.skip('Should invoke @Set decorated method when setting a value', async () => {
      const handle = await execute(workflows.ShouldInvokeSetMethodOnPropertySet, false);

      // Set a value using the signal
      await handle.signal('signalValue', 'setting via @Set decorator');

      // Ensure the method decorated with @Set was called
      expect(await handle.result()).toBe('Processed by @Set decorator');
    });

    it.skip('Should invoke @Get decorated method when getting a value', async () => {
      const handle = await execute(workflows.ShouldInvokeGetMethodOnPropertyGet, false);

      // Get a value using the query
      const queryResult = await handle.query('queryValue');

      // Ensure the method decorated with @Get was called
      expect(queryResult).toBe('Processed by @Get decorator');
      expect(await handle.result()).toBe('Processed by @Get decorator');
    });
  });

  describe('Signal Handling', () => {
    it('Should bind signals correctly', async () => {
      const handle = await execute(workflows.ShouldBindSignalsCorrectly, false);
      await handle.signal('setStatus', 'updated');

      expect(await handle.result()).toBe('updated');
    });

    it('Should bind named signals correctly', async () => {
      const handle = await execute(workflows.ShouldBindNamedSignalsCorrectly, false);
      await handle.signal('status', 'updated');

      expect(await handle.result()).toBe('updated');
    });

    it('Should emit an event on signal invocation', async () => {
      const handle = await execute(workflows.ShouldEmitEventOnSignal, false);
      await handle.signal('setStatus', 'updated');

      expect(await handle.result()).toBe('updatedByEvent');
    });
  });

  describe('Query Handling', () => {
    it('Should bind queries correctly', async () => {
      const handle = await execute(workflows.ShouldBindQueriesCorrectly, false);
      const queryResult = await handle.query('getStatus');

      expect(queryResult).toBe('initial');
      expect(await handle.result()).toBe('initial');
    });
  });

  describe('Hook Handling', () => {
    it('Should apply @Before hook correctly', async () => {
      const result = await execute(workflows.ShouldApplyBeforeHooksCorrectly);
      expect(result).toBe('beforeHookApplied');
    });

    it('Should apply before @Hook correctly', async () => {
      const result = await execute(workflows.ShouldApplyBeforeHooksCorrectly);
      expect(result).toBe('beforeHookApplied');
    });

    it('Should apply @After hook correctly', async () => {
      const result = await execute(workflows.ShouldApplyAfterHooksCorrectly);
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
