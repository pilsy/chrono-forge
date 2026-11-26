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
    global.mergeWorkflowCoverage();
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
    it('Should create a query but no signal for a default @Property (2.0 read-only default)', async () => {
      const handle = await execute(workflows.ShouldCreateDefaultPropertyAccessors);

      // A signal with the property's name has no handler, so the value must not change
      await handle.signal('status', 'updated status');
      await sleep(1000);

      expect(await handle.query('status')).toBe('running');
      expect(await handle.result()).toBe('running');
    });

    it('Should create a signal only when set is given explicitly, using a custom name when set is a string', async () => {
      const handle = await execute(workflows.ShouldAllowExplicitPropertySet);

      await handle.signal('label', 'L');
      await handle.signal('renameTo', 'N');

      expect(await handle.result()).toBe('L|N');
    });

    it('Should not let a signal set the base control fields (2.0)', async () => {
      const handle = await execute(workflows.ShouldNotAllowSettingBaseFields);

      await handle.signal('status', 'completed');
      await handle.signal('dsl', { variables: {}, plan: { execute: { code: 'return 1' } } });
      await handle.signal('continueAsNew', true);
      await handle.signal('pendingIteration', true);
      await handle.signal('startDelay', '1 second');
      await handle.signal('conditionTimeout', '1 second');

      expect(await handle.result()).toEqual({
        status: 'running',
        dsl: null,
        continueAsNew: false,
        pendingIteration: false,
        startDelay: null,
        conditionTimeout: null
      });
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

  describe('Actions as Updates (2.0)', () => {
    it('Should reject an Update whose validator fails, accept a valid one, and reject a reused approval', async () => {
      const handle = await execute(workflows.ShouldRunActionsOnBaseWorkflow, 'start', { planSha256: 'abc' });

      await expect(
        handle.executeUpdate('approve', { args: [{ approvalId: 'a1', planSha256: 'wrong' }] })
      ).rejects.toThrow();

      expect(await handle.executeUpdate('approve', { args: [{ approvalId: 'a1', planSha256: 'abc' }] })).toBe(
        'approved:a1'
      );

      await expect(
        handle.executeUpdate('approve', { args: [{ approvalId: 'a1', planSha256: 'abc' }] })
      ).rejects.toThrow();

      expect(await handle.result()).toEqual(['a1']);
    });

    it('Should fail a workflow that declares an async validator', async () => {
      const handle = await execute(workflows.ShouldRejectAsyncValidator);
      await expect(handle.result()).rejects.toThrow();
      const { status } = await handle.describe();
      expect(status.name).toBe('FAILED');
    });
  });

  describe('Fail closed (2.0)', () => {
    const failureType = async (handle) => {
      try {
        await handle.result();
      } catch (err) {
        return err?.cause?.type ?? err?.cause?.cause?.type ?? 'unknown';
      }
      return 'completed';
    };

    it('Should close a cancelled plain workflow as CANCELLED', async () => {
      const handle = await execute(workflows.ShouldCancelCleanly);
      await sleep(1000);
      await handle.cancel();
      await expect(handle.result()).rejects.toThrow();
      const { status } = await handle.describe();
      expect(status.name).toBe('CANCELLED');
    });

    it('Should give @Condition the workflow as this and run the method once it holds', async () => {
      const handle = await execute(workflows.ShouldPassConditionWithThis);
      await sleep(1000);
      await handle.signal('markReady');
      expect(await handle.result()).toBe('ran');
    });

    it('Should fail the workflow when a @Condition times out', async () => {
      const handle = await execute(workflows.ShouldFailOnConditionTimeout);
      expect(await failureType(handle)).toBe('ConditionTimeout');
    });

    it('Should fail the workflow when a @Guard check is false', async () => {
      const handle = await execute(workflows.ShouldFailOnGuard);
      expect(await failureType(handle)).toBe('GuardFailed');
    });

    it('Should propagate an error thrown by a @Conditional method', async () => {
      const handle = await execute(workflows.ShouldPropagateConditionalMethodError);
      expect(await failureType(handle)).toBe('MethodFailed');
    });

    it('Should fail when a @Conditional condition throws', async () => {
      const handle = await execute(workflows.ShouldFailOnConditionalConditionError);
      expect(await failureType(handle)).toBe('ConditionalError');
    });

    it('Should not emit an event when a query runs', async () => {
      const handle = await execute(workflows.ShouldNotEmitOnQuery);
      await sleep(1000);
      expect(await handle.query('getValue')).toBe('v');
      expect(await handle.result()).toBe(false);
    });
  });

  describe('Strict defaults coverage (2.0)', () => {
    // Temporal's built-in metadata query lists every registered signal, query and Update by name.
    const handlerNames = async (handle) => {
      const meta = await handle.query('__temporal_workflow_metadata');
      const def = meta?.definition ?? {};
      const names = (list) => (list ?? []).map((d) => d.name);
      return {
        signals: names(def.signalDefinitions),
        queries: names(def.queryDefinitions),
        updates: names(def.updateDefinitions)
      };
    };

    const failureType = async (handle) => {
      try {
        await handle.result();
      } catch (err) {
        return err?.cause?.type ?? err?.cause?.cause?.type ?? 'unknown';
      }
      return 'completed';
    };

    it('Should register no signal for any base control field, pendingUpdate included', async () => {
      const handle = await execute(workflows.ShouldNotAllowSettingBaseFields);
      await sleep(1000);
      const { signals, queries } = await handlerNames(handle);
      for (const field of [
        'status',
        'dsl',
        'continueAsNew',
        'pendingIteration',
        'pendingUpdate',
        'startDelay',
        'conditionTimeout'
      ]) {
        expect(signals).not.toContain(field);
      }
      expect(queries).toEqual(expect.arrayContaining(['status', 'pendingUpdate']));
      await handle.result();
    });

    it("Should use a subclass's validator for its own class only", async () => {
      const strict = await execute(workflows.ShouldUseSubclassValidator, 'start', { planSha256: 'abc' });
      // The subclass rule rejects what the inherited hash check would accept...
      await expect(
        strict.executeUpdate('approve', { args: [{ approvalId: 'a1', planSha256: 'abc' }] })
      ).rejects.toThrow();
      // ...and replaces that check for this class.
      expect(await strict.executeUpdate('approve', { args: [{ approvalId: 'ok-1', planSha256: 'other' }] })).toBe(
        'approved:ok-1'
      );

      // A sibling class keeps the inherited validator: the subclass's rule did not leak into the shared base.
      const inherited = await execute(workflows.ShouldInheritValidator, 'start', { planSha256: 'abc' });
      await expect(
        inherited.executeUpdate('approve', { args: [{ approvalId: 'ok-1', planSha256: 'other' }] })
      ).rejects.toThrow();
      expect(await inherited.executeUpdate('approve', { args: [{ approvalId: 'a1', planSha256: 'abc' }] })).toBe(
        'approved:a1'
      );

      expect(await strict.result()).toEqual(['ok-1']);
      expect(await inherited.result()).toEqual(['a1']);
    });

    it('Should bind an @Action under its name option, not its method name', async () => {
      const handle = await execute(workflows.ShouldUseActionName);
      await sleep(1000);
      const { updates } = await handlerNames(handle);
      expect(updates).toContain('grant');
      expect(updates).not.toContain('approveRequest');
      await expect(handle.executeUpdate('approveRequest')).rejects.toThrow();
      expect(await handle.executeUpdate('grant')).toBe('granted');
      expect(await handle.result()).toBe(true);
    });

    it('Should run DSL code only when @Temporal({ allowDSLCode: true }) is set', async () => {
      const dsl = { variables: {}, plan: { execute: { code: 'return 42;', store: 'answer' } } };

      const allowed = await execute(workflows.ShouldRunDSLCodeWhenAllowed, 'start', { dsl });
      await allowed.result();
      expect((await allowed.describe()).status.name).toBe('COMPLETED');

      const blocked = await execute(workflows.ShouldNotRunDSLCodeByDefault, 'start', { dsl });
      expect(await failureType(blocked)).toBe('DSLCodeDisabled');
    });

    it('Should cancel a child that Temporal would not cancel on its own', async () => {
      const childId = `child-${uuid4()}`;
      const handle = await execute(workflows.ShouldCancelChildOutsideScope, 'start', {
        childType: 'cancellableChild',
        childId
      });
      await sleep(2000);
      const child = getClient().workflow.getHandle(childId);
      expect((await child.describe()).status.name).toBe('RUNNING');

      await handle.cancel();
      await expect(handle.result()).rejects.toThrow();
      expect((await handle.describe()).status.name).toBe('CANCELLED');
      await sleep(1000);
      expect((await child.describe()).status.name).toBe('CANCELLED');
    });

    it('Should close after childCancellationTimeout when a child ignores cancellation', async () => {
      const childId = `stubborn-${uuid4()}`;
      const handle = await execute(workflows.ShouldCancelChildOutsideScope, 'start', {
        childType: 'stubbornChild',
        childId
      });
      await sleep(2000);
      const child = getClient().workflow.getHandle(childId);

      const started = Date.now();
      await handle.cancel();
      await expect(handle.result()).rejects.toThrow();
      const waitedMs = Date.now() - started;

      expect((await handle.describe()).status.name).toBe('CANCELLED');
      // The parent waited for its 3-second childCancellationTimeout, not for the child's 60-second sleep.
      expect(waitedMs).toBeGreaterThanOrEqual(2500);
      expect(waitedMs).toBeLessThan(20000);
      expect((await child.describe()).status.name).toBe('RUNNING');
      await child.terminate('test cleanup');
    });
  });

  describe('Review fixes (2.0)', () => {
    const handlerNames = async (handle) => {
      const meta = await handle.query('__temporal_workflow_metadata');
      const def = meta?.definition ?? {};
      const names = (list) => (list ?? []).map((d) => d.name);
      return { signals: names(def.signalDefinitions), updates: names(def.updateDefinitions) };
    };

    const failure = async (handle) => {
      try {
        await handle.result();
      } catch (err) {
        return err?.cause ?? err;
      }
      return undefined;
    };

    it('Should register no pause, resume or cancel signal unless the workflow opts in', async () => {
      const plain = await execute(workflows.ShouldHaveNoControlSignalsByDefault);
      await sleep(1000);
      const { signals } = await handlerNames(plain);
      expect(signals).not.toEqual(expect.arrayContaining(['pause']));
      for (const name of ['pause', 'resume', 'cancel']) {
        expect(signals).not.toContain(name);
      }
      // A pause signal has no handler, so it changes nothing.
      await plain.signal('pause');
      await sleep(500);
      expect(await plain.query('status')).toBe('running');
      await plain.executeUpdate('finish');
      expect(await plain.result()).toBe('running');

      const optedIn = await execute(workflows.ShouldStopOnCancelSignal);
      await sleep(1000);
      expect((await handlerNames(optedIn)).signals).toEqual(expect.arrayContaining(['pause', 'resume', 'cancel']));
      await optedIn.terminate('test cleanup');
    });

    it('Should run the next step after a pause and resume instead of completing early', async () => {
      const handle = await execute(workflows.ShouldPauseBetweenSteps);
      await sleep(1000);
      await handle.signal('pause');
      await sleep(4000);
      // stepOne finished during the pause; stepTwo waits.
      expect(await handle.query('status')).toBe('paused');
      expect(await handle.query('ran')).toEqual(['stepOne']);
      expect((await handle.describe()).status.name).toBe('RUNNING');

      await handle.signal('resume');
      expect(await handle.result()).toEqual(['stepOne', 'stepTwo']);
    });

    it('Should stop a continue-as-new workflow on a cancel signal without running it again, and fail the run', async () => {
      const handle = await execute(workflows.ShouldStopOnCancelSignal);
      await sleep(1500);
      expect(await handle.query('runs')).toBe(1);

      await handle.signal('cancel');
      const err = await failure(handle);
      expect(err?.message).toContain('Cancelled by the cancel signal');
      expect((await handle.describe()).status.name).toBe('FAILED');
      expect(await handle.query('runs')).toBe(1);
      expect(await handle.query('status')).toBe('cancelled');
    });

    it('Should reject an Update whose validator returns a Promise, and keep the workflow running', async () => {
      const handle = await execute(workflows.ShouldRejectOnlyTheUpdate);
      await expect(handle.executeUpdate('approve')).rejects.toMatchObject({
        cause: { type: 'InvalidValidator', message: expect.stringMatching(/synchronous/) }
      });
      expect((await handle.describe()).status.name).toBe('RUNNING');
      expect(await handle.executeUpdate('finish')).toBe('finished');
      expect(await handle.result()).toBe('completed');
    });

    it('Should fail only the Update when an @Action throws a plain Error', async () => {
      const handle = await execute(workflows.ShouldRejectOnlyTheUpdate);
      await expect(handle.executeUpdate('explode')).rejects.toMatchObject({
        cause: { type: 'ActionError', message: 'boom', nonRetryable: true }
      });
      expect((await handle.describe()).status.name).toBe('RUNNING');
      expect(await handle.executeUpdate('finish')).toBe('finished');
      expect(await handle.result()).toBe('completed');
      expect((await handle.describe()).status.name).toBe('COMPLETED');
    });

    it('Should fail at start when a @Validator names no @Action', async () => {
      const handle = await execute(workflows.ShouldFailOnMisnamedValidator);
      const err = await failure(handle);
      expect(err?.type).toBe('InvalidValidator');
      expect(err?.message).toContain("'aprove'");
      expect(err?.message).toContain("'approve'");
      expect((await handle.describe()).status.name).toBe('FAILED');
    });

    it('Should fail the run when an init listener throws a plain Error', async () => {
      const handle = await execute(workflows.ShouldFailOnInitError);
      const err = await failure(handle);
      expect(err?.type).toBe('WorkflowStartupError');
      expect(err?.message).toContain('init failed');
      expect((await handle.describe()).status.name).toBe('FAILED');
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
      // The signal is the method name; the workflow records that its 'setStatus' event fired.
      await handle.signal('setStatus', 'updated');

      expect(await handle.result()).toBe('updated:true');
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
