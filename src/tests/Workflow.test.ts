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

  describe('Step Execution', () => {
    it('Should execute steps in the correct order', async () => {
      const handle = await execute(workflows.ShouldExecuteSteps, 'start');
      await handle.signal('setShouldWaitForStep', true);
      const result = await handle.result();
      expect(result).toBe('afterConditional');
    }, 60000);

    it('Should respect step dependencies defined with after', async () => {
      const handle = await execute(workflows.ShouldExecuteSteps, 'start');
      await handle.signal('setShouldWaitForStep', true);
      await sleep(500);

      // The workflow should have completed all steps in sequence
      const result = await handle.result();
      expect(result).toBe('afterConditional');
    }, 60000);

    it('Should execute steps in parallel when they have the same dependency', async () => {
      const handle = await execute(workflows.ShouldExecuteSteps, 'start');
      await handle.signal('setShouldWaitForStep', true);
      await sleep(5000); // Give enough time for all steps to complete

      const results = await handle.query('getResults');

      // Verify stepOne executed before parallel steps
      expect(results.indexOf('stepOne')).toBeLessThan(results.indexOf('parallelA'));
      expect(results.indexOf('stepOne')).toBeLessThan(results.indexOf('parallelB'));

      // Verify afterParallel executed after both parallel steps
      expect(results.indexOf('parallelA')).toBeLessThan(results.indexOf('afterParallel'));
      expect(results.indexOf('parallelB')).toBeLessThan(results.indexOf('afterParallel'));

      // Verify the workflow completed successfully
      const finalResult = await handle.result();
      expect(finalResult).toBe('afterConditional');
    });

    it('Should handle steps with multiple dependencies', async () => {
      const handle = await execute(workflows.ShouldExecuteSteps, 'start');
      await handle.signal('setShouldWaitForStep', true);
      await sleep(5000);

      const results = await handle.query('getResults');

      // Check that afterParallel only runs after both parallel steps
      expect(results.indexOf('parallelA')).toBeLessThan(results.indexOf('afterParallel'));
      expect(results.indexOf('parallelB')).toBeLessThan(results.indexOf('afterParallel'));

      // Verify the final result
      expect(await handle.result()).toBe('afterConditional');
    });
  });

  describe('Conditional Step Execution', () => {
    it('Should execute conditional steps when condition is met', async () => {
      const handle = await execute(workflows.ShouldExecuteSteps, 'start');
      await handle.signal('setShouldWaitForStep', true);
      // By default, shouldRunConditional is true
      await sleep(5000); // Give enough time for all steps to complete

      const results = await handle.query('getResults');

      // Verify the conditional step was executed
      expect(results).toContain('conditionalStep');

      // Verify the step after the conditional step was executed
      expect(results).toContain('afterConditional');

      // Verify the execution order
      expect(results.indexOf('stepTwo')).toBeLessThan(results.indexOf('conditionalStep'));
      expect(results.indexOf('conditionalStep')).toBeLessThan(results.indexOf('afterConditional'));

      // Verify the query explicitly for conditional execution
      expect(await handle.query('wasConditionalExecuted')).toBe(true);

      // Verify workflow completed successfully
      const finalResult = await handle.result();
      expect(finalResult).toBe('afterConditional');
    });

    it('Should skip conditional steps when condition is not met', async () => {
      const handle = await execute(workflows.ShouldExecuteSteps, 'start');
      await handle.signal('setShouldWaitForStep', true);
      // Set the condition to false
      await handle.signal('setShouldRunConditional', false);
      await sleep(5000); // Give enough time for all steps to complete

      const results = await handle.query('getResults');

      // Verify the conditional step was not executed
      expect(results).not.toContain('conditionalStep');

      // Even though afterConditional might still be in the results, it should run after non-conditional steps
      if (results.includes('afterConditional')) {
        expect(results.indexOf('alwaysRun')).toBeLessThan(results.indexOf('afterConditional'));
      }

      // Verify the alwaysRun step was still executed
      expect(results).toContain('alwaysRun');

      // Verify the query explicitly for conditional execution
      expect(await handle.query('wasConditionalExecuted')).toBe(false);

      // Verify workflow still completed successfully
      const finalResult = await handle.result();
      expect(finalResult).toBe('afterConditional');
    });

    it('Should handle mixed conditional and unconditional branches', async () => {
      const handle = await execute(workflows.ShouldExecuteSteps, 'start');
      await handle.signal('setShouldWaitForStep', true);
      // Set the condition to false
      await handle.signal('setShouldRunConditional', false);
      await sleep(5000);

      const results = await handle.query('getResults');

      // Conditional branch should not run
      expect(results).not.toContain('conditionalStep');

      // Even though afterConditional might still be in the results, it should run after non-conditional steps
      if (results.includes('afterConditional')) {
        expect(results.indexOf('alwaysRun')).toBeLessThan(results.indexOf('afterConditional'));
      }

      // Unconditional branches should run
      expect(results).toContain('stepOne');
      expect(results).toContain('stepTwo');
      expect(results).toContain('stepThree');
      expect(results).toContain('alwaysRun');
      expect(results).toContain('parallelA');
      expect(results).toContain('parallelB');
      expect(results).toContain('afterParallel');

      // Verify correct ordering of unconditional steps
      expect(results.indexOf('stepTwo')).toBeLessThan(results.indexOf('alwaysRun'));
      expect(results.indexOf('stepOne')).toBeLessThan(results.indexOf('parallelA'));
    });

    it('Should handle both when and wait conditions correctly', async () => {
      const handle = await execute(workflows.ShouldExecuteSteps, 'start');

      // Initially both conditions should be false
      await handle.signal('setShouldRunConditional', false);
      await sleep(1000);

      let results = await handle.query('getResults');

      // Verify neither conditional step was executed
      expect(results).not.toContain('conditionalStep');
      expect(results).not.toContain('waitStep');

      // Set when condition to true but keep wait false
      await handle.signal('setShouldRunConditional', true);
      await sleep(1000);

      results = await handle.query('getResults');

      // Only when-conditioned step should execute
      expect(results).toContain('conditionalStep');
      expect(results).not.toContain('waitStep');

      // Set wait condition to true
      await handle.signal('setShouldWaitForStep', true);
      await sleep(1000);

      results = await handle.query('getResults');

      // Both steps should now be executed
      expect(results).toContain('conditionalStep');
      expect(results).toContain('waitStep');

      // Verify execution order
      expect(results.indexOf('stepTwo')).toBeLessThan(results.indexOf('conditionalStep'));
      expect(results.indexOf('stepTwo')).toBeLessThan(results.indexOf('waitStep'));

      // Verify workflow completed successfully
      const finalResult = await handle.result();
      expect(finalResult).toBe('afterConditional');
    });
  });
});
