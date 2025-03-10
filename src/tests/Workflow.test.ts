/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { v4 as uuid4 } from 'uuid';
import * as workflows from './testWorkflows';

describe('Workflow', () => {
  let execute;
  let signalWithStart;

  jest.setTimeout(30000);

  beforeEach(() => {
    const client = getClient();

    execute = (workflowName: string, exec = 'start', ...args) =>
      client.workflow[exec](workflowName, {
        taskQueue: 'test',
        workflowExecutionTimeout: 30000,
        workflowId: `test-${uuid4()}`,
        [exec === 'signalWithStart' ? 'signalArgs' : 'args']: args
      });

    signalWithStart = (workflowName: string, options) =>
      client.workflow.signalWithStart(workflowName, {
        taskQueue: 'test',
        workflowExecutionTimeout: 30000,
        workflowId: `test-${uuid4()}`,
        ...options
      });
  });

  afterAll(() => {
    // @ts-ignore
    global.workflowCoverage.mergeIntoGlobalCoverage();
  });

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

    it('Should call the execute() method each iteration of continueAsNew workflow', async () => {
      const args = ['one', 'two', 'three'];
      const result = await execute(workflows.ShouldExecuteWithArguments, 'execute', ...args);

      expect(result).toBe(args.join(','));
    });
  });

  describe('Property Decorators', () => {
    it('Should automatically create signals and queries for properties with default get/set', async () => {
      const handle = await execute(workflows.ShouldCreateDefaultPropertyAccessors);

      // Test setting a value
      await handle.signal('status', 'updated status');
      await sleep(2500);

      // Test getting the value
      const queryResult = await handle.query('status');

      expect(queryResult).toBe('updated status');
      expect(await handle.result()).toBe('updated status');
    });

    it('Should create signals and queries with custom names', async () => {
      const handle = await execute(workflows.ShouldCreateCustomPropertyAccessors);
      await sleep();

      // Test setting a value via custom signal
      await handle.signal('customSetSignal', 'custom value');
      await sleep();

      // Test getting the value via custom query
      const queryResult = await handle.query('customGetQuery');

      expect(queryResult).toBe('custom value');
      expect(await handle.result()).toBe('custom value');
    });

    it('Should disable setting a value when set is false', async () => {
      const handle = await execute(workflows.ShouldDisableSetForProperty);
      await sleep();

      // Test setting a value via custom signal
      await handle.signal('readonlyProperty', 'new value');
      await sleep();

      // Test getting the value via custom query
      const queryResult = await handle.query('readonlyProperty');

      expect(queryResult).toBe('readonly');
      expect(await handle.result()).toBe('readonly');
    });
  });

  describe('Signal Handling', () => {
    it('Should bind signals correctly', async () => {
      const handle = await execute(workflows.ShouldBindSignalsCorrectly);
      await handle.signal('setStatus', 'updated');

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
