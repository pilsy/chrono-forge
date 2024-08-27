/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { Workflow, ChronoFlow, Signal, Query } from '../index';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker, Runtime, DefaultLogger, LogEntry } from '@temporalio/worker';
import { WorkflowClient, Connection } from '@temporalio/client';
import { v4 as uuid4 } from 'uuid';
import path from 'path';

describe('ChronoFlow Workflow Tests', () => {
  let testEnv: TestWorkflowEnvironment;
  let worker: Worker;
  let client: WorkflowClient;
  let nativeConnection;

  const mockActivities = {
    makeHTTPRequest: async () => '99',
  };

  beforeAll(async () => {
    Runtime.install({
      logger: new DefaultLogger('WARN', (entry: LogEntry) => console.log(`[${entry.level}]`, entry.message)),
    });

    testEnv = await TestWorkflowEnvironment.createLocal();
    const { client: workflowClient, nativeConnection: nc } = testEnv;
    client = workflowClient;
    nativeConnection = nc;
  }, 60000);

  afterAll(async () => {
    // await worker?.shutdown();
    // await testEnv?.nativeConnection?.close();
  }, 60000);

  describe('Workflow Execution', () => {
    it('Should call the execute() method with provided arguments', async () => {
      worker = await Worker.create({
        connection: nativeConnection,
        taskQueue: 'test',
        workflowsPath: path.resolve(__dirname, './testWorkflows'),
        activities: mockActivities,
      });
      await worker.runUntil(async () => {
        const { client } = testEnv;
        const args = ["one", "two", "three"];
        const handle = await client.workflow.start("ShouldExecuteWithArguments", {
          taskQueue: 'test',
          workflowId: 'should_execute',
          args,
        });

        const workflowResult = await handle.result();
        expect(workflowResult).toBe(args.join(','));
      });
    });

    it.skip('should_invoke_workflow_execute_method', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        public status = 'initial';

        async execute() {
          this.status = 'executed';
          return this.status;
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      const workflowResult = await result.result();
      expect(workflowResult).toBe('executed');
    });

    it.skip('should_trace_workflow_execution_correctly', async () => {
      // This test will check that tracing spans are correctly set up and completed for workflow execution
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        public status = 'initial';

        async execute() {
          this.status = 'executed';
          return this.status;
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      const spans = Runtime.instance().tracer.getActiveSpans();
      expect(spans.some(span => span.name.includes('TestWorkflow'))).toBe(true);
    });

    it.skip('should_dynamically_create_class_extending_workflow', async () => {
      @ChronoFlow()
      class TestWorkflow { }

      const instance = new TestWorkflow();
      expect(instance instanceof Workflow).toBe(true);
    });

    it.skip('should_bind_queries_and_signals_to_dynamic_class', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        @Query('getStatus')
        getStatus() {
          return 'status';
        }

        @Signal()
        updateStatus() {
          this.status = 'updated';
        }

        public status = 'initial';

        async execute() {
          return this.status;
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      const queryResult = await result.query('getStatus');
      expect(queryResult).toBe('status');

      await result.signal('updateStatus');
      const updatedStatus = await result.result();
      expect(updatedStatus).toBe('updated');
    });

    it.skip('should_execute_workflow_function_with_tracing', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        public status = 'initial';

        async execute() {
          this.status = 'executed';
          return this.status;
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      const spans = Runtime.instance().tracer.getActiveSpans();
      expect(spans.some(span => span.name.includes('[Workflow]:TestWorkflow'))).toBe(true);
    });

    it.skip('should_continue_as_new_after_max_iterations', async () => {
      @ChronoFlow({ maxIterations: 1 })
      class TestWorkflow extends Workflow {
        public iteration = 0;

        async execute() {
          if (this.iteration++ < 1) {
            return this.continueAsNew();
          }
          return this.iteration;
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      const finalIteration = await result.result();
      expect(finalIteration).toBe(2); // Should have continued as new once
    });

    it.skip('should_handle_condition_awaiting_properly', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        public conditionMet = false;

        async condition() {
          return this.conditionMet;
        }

        async execute() {
          await this.condition();
          this.conditionMet = true;
          return 'condition met';
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      const workflowResult = await result.result();
      expect(workflowResult).toBe('condition met');
    });

    it.skip('should_execute_steps_in_correct_order_based_on_dependencies', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        public steps: string[] = [];

        @Hook({ before: 'step2' })
        step1() {
          this.steps.push('step1');
        }

        @Hook({ before: 'step3' })
        step2() {
          this.steps.push('step2');
        }

        async step3() {
          this.steps.push('step3');
        }

        async execute() {
          await this.step3();
          return this.steps;
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      const stepsOrder = await result.result();
      expect(stepsOrder).toEqual(['step1', 'step2', 'step3']);
    });

    it.skip('should_skip_step_if_condition_not_met', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        public steps: string[] = [];

        @Hook({ before: 'step2' })
        step1() {
          this.steps.push('step1');
        }

        @Hook({ before: 'step3', on: () => false })
        step2() {
          this.steps.push('step2');
        }

        async step3() {
          this.steps.push('step3');
        }

        async execute() {
          await this.step3();
          return this.steps;
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      const stepsOrder = await result.result();
      expect(stepsOrder).toEqual(['step1', 'step3']); // step2 should be skipped
    });

    it.skip('should_handle_pause_and_resume_correctly', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        public status = 'running';

        @Signal()
        pause() {
          this.status = 'paused';
        }

        @Signal()
        resume() {
          this.status = 'running';
        }

        async execute() {
          while (this.status === 'running') {
            await this.sleep(1000);
          }
          return this.status;
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      await result.signal('pause');
      const pausedStatus = await result.query('getStatus');
      expect(pausedStatus).toBe('paused');

      await result.signal('resume');
      const resumedStatus = await result.query('getStatus');
      expect(resumedStatus).toBe('running');
    });

    it.skip('should_handle_execution_error_gracefully', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        async execute() {
          throw new Error('Test error');
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      await expect(result.result()).rejects.toThrow('Test error');
    });

    it.skip('should_process_dependent_steps_correctly', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        public steps: string[] = [];

        @Hook({ before: 'step3' })
        step1() {
          this.steps.push('step1');
        }

        @Hook({ after: 'step1' })
        step2() {
          this.steps.push('step2');
        }

        async step3() {
          this.steps.push('step3');
        }

        async execute() {
          await this.step3();
          return this.steps;
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      const stepsOrder = await result.result();
      expect(stepsOrder).toEqual(['step1', 'step2', 'step3']);
    });

    it.skip('should_handle_workflow_termination_correctly', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        async execute() {
          return 'running';
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      await result.terminate();
      await expect(result.result()).rejects.toThrow('Workflow was terminated');
    });

    it.skip('should_handle_workflow_cancellation', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        async execute() {
          return 'running';
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      await result.cancel();
      await expect(result.result()).rejects.toThrow('Workflow was cancelled');
    });

    it.skip('should_retry_workflow_on_failure', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        public attempt = 0;

        async execute() {
          if (this.attempt++ < 2) {
            throw new Error('Test error');
          }
          return 'success';
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
        retryPolicy: { maximumAttempts: 3 },
      });

      const workflowResult = await result.result();
      expect(workflowResult).toBe('success');
    });

    it.skip('should_handle_large_payloads_correctly', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        async execute(largeData: string) {
          return largeData.toUpperCase();
        }
      }

      const largeData = 'x'.repeat(1000000); // 1 MB of data
      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [largeData],
      });

      const workflowResult = await result.result();
      expect(workflowResult).toBe(largeData.toUpperCase());
    });

    it.skip('should_properly_cleanup_resources_on_workflow_completion', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        public cleanedUp = false;

        async execute() {
          this.cleanedUp = true;
          return 'completed';
        }

        async cleanup() {
          this.cleanedUp = true;
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      await result.result();
      const cleanupStatus = await result.query('getCleanupStatus');
      expect(cleanupStatus).toBe(true);
    });

    it.skip('should_gracefully_handle_workflow_timeouts', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        async execute() {
          await this.sleep(10000);
          return 'completed';
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
        workflowRunTimeout: '5s', // Set a timeout
      });

      await expect(result.result()).rejects.toThrow('Workflow timed out');
    });

    it.skip('should_correctly_emit_and_handle_custom_events', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        public eventHandled = false;

        async execute() {
          this.emit.skip('customEvent', { data: 'eventData' });
          return 'executed';
        }

        @Signal()
        handleEvent() {
          this.eventHandled = true;
        }

        async onCustomEvent(data: any) {
          if (data.data === 'eventData') {
            await this.handleEvent();
          }
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      const eventHandled = await result.query('getEventHandled');
      expect(eventHandled).toBe(true);
    });

    it.skip('should_execute_workflow_with_multiple_activities_in_sequence', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        public activitiesCompleted: string[] = [];

        async execute() {
          await this.performActivity1();
          await this.performActivity2();
          await this.performActivity3();
          return this.activitiesCompleted;
        }

        async performActivity1() {
          this.activitiesCompleted.push('activity1Completed');
        }

        async performActivity2() {
          this.activitiesCompleted.push('activity2Completed');
        }

        async performActivity3() {
          this.activitiesCompleted.push('activity3Completed');
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      const activitiesState = await result.result();
      expect(activitiesState).toEqual(['activity1Completed', 'activity2Completed', 'activity3Completed']);
    });
  });

  describe('Signal Handling', () => {
    it('should_bind_signals_correctly', async () => {
      worker = await Worker.create({
        connection: nativeConnection,
        taskQueue: 'test',
        workflowsPath: path.resolve(__dirname, './testWorkflows'),
        activities: mockActivities,
      });
      await worker.runUntil(async () => {
        const { client } = testEnv;
        const handle = await client.workflow.start("ShouldBindSignalsCorrectly", {
          taskQueue: 'test',
          workflowId: 'should_bind_signals_correctly',
          args: [],
        });
  
        await handle.signal('setStatus', 'updated');
        const workflowResult = await handle.result();
        expect(workflowResult).toBe('updated');
      });
    });

    it('should_bind_named_signals_correctly', async () => {
      worker = await Worker.create({
        connection: nativeConnection,
        taskQueue: 'test',
        workflowsPath: path.resolve(__dirname, './testWorkflows'),
        activities: mockActivities,
      });
      await worker.runUntil(async () => {
        const { client } = testEnv;
        const handle = await client.workflow.start("ShouldBindNamedSignalsCorrectly", {
          taskQueue: 'test',
          workflowId: 'should_bind_named_signals_correctly',
          args: [],
        });
  
        await handle.signal('status', 'updated');
        const workflowResult = await handle.result();
        expect(workflowResult).toBe('updated');
      });
    });

    it('should_emit_event_on_signal_invocation', async () => {
      worker = await Worker.create({
        connection: nativeConnection,
        taskQueue: 'test',
        workflowsPath: path.resolve(__dirname, './testWorkflows'),
        activities: mockActivities,
      });
      await worker.runUntil(async () => {
        const { client } = testEnv;
        const handle = await client.workflow.start("ShouldEmitEventOnSignal", {
          taskQueue: 'test',
          workflowId: 'should_emit_event_on_signal_invocation',
          args: [],
        });
  
        await handle.signal('setStatus', 'updated');
        const workflowResult = await handle.result();
        expect(workflowResult).toBe('updatedByEvent');
      });
    });

    it.skip('should_forward_signal_to_child_workflows', async () => {
      @ChronoFlow()
      class ChildWorkflow extends Workflow {
        public status = 'initial';

        @Signal()
        setStatus(newStatus: string) {
          this.status = newStatus;
        }

        async execute() {
          return this.status;
        }
      }

      @ChronoFlow()
      class ParentWorkflow extends Workflow {
        async execute() {
          const child = await this.startChildWorkflow(ChildWorkflow, {
            workflowId: 'child-workflow',
            taskQueue: 'test',
          });

          await this.forwardSignalToChildren('setStatus', 'updated');
          return await child.result();
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(ParentWorkflow, {
        taskQueue: 'test',
        workflowId: 'parent-workflow',
        args: [],
      });

      const childResult = await result.result();
      expect(childResult).toBe('updated');
    });

    it.skip('should_handle_error_during_signal_forwarding', async () => {
      @ChronoFlow()
      class ChildWorkflow extends Workflow {
        public status = 'initial';

        @Signal()
        setStatus() {
          throw new Error('Error during signal handling');
        }

        async execute() {
          return this.status;
        }
      }

      @ChronoFlow()
      class ParentWorkflow extends Workflow {
        async execute() {
          const child = await this.startChildWorkflow(ChildWorkflow, {
            workflowId: 'child-workflow',
            taskQueue: 'test',
          });

          try {
            await this.forwardSignalToChildren('setStatus', 'updated');
          } catch (error) {
            this.status = 'error-handled';
          }

          return this.status;
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(ParentWorkflow, {
        taskQueue: 'test',
        workflowId: 'parent-workflow',
        args: [],
      });

      const parentResult = await result.result();
      expect(parentResult).toBe('error-handled');
    });

    it.skip('should_handle_multiple_concurrent_signals', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        public signalCount = 0;

        @Signal()
        incrementCount() {
          this.signalCount += 1;
        }

        async execute() {
          return this.signalCount;
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      await Promise.all([
        result.signal('incrementCount'),
        result.signal('incrementCount'),
        result.signal('incrementCount'),
      ]);

      const finalCount = await result.result();
      expect(finalCount).toBe(3);
    });

    it.skip('should_handle_signal_forwarding_to_multiple_children', async () => {
      @ChronoFlow()
      class ChildWorkflow extends Workflow {
        public status = 'initial';

        @Signal()
        setStatus(newStatus: string) {
          this.status = newStatus;
        }

        async execute() {
          return this.status;
        }
      }

      @ChronoFlow()
      class ParentWorkflow extends Workflow {
        async execute() {
          const child1 = await this.startChildWorkflow(ChildWorkflow, {
            workflowId: 'child-workflow-1',
            taskQueue: 'test',
          });

          const child2 = await this.startChildWorkflow(ChildWorkflow, {
            workflowId: 'child-workflow-2',
            taskQueue: 'test',
          });

          await this.forwardSignalToChildren('setStatus', 'updated');

          const [result1, result2] = await Promise.all([child1.result(), child2.result()]);

          return [result1, result2];
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(ParentWorkflow, {
        taskQueue: 'test',
        workflowId: 'parent-workflow',
        args: [],
      });

      const [childResult1, childResult2] = await result.result();
      expect(childResult1).toBe('updated');
      expect(childResult2).toBe('updated');
    });
  });

  describe('Query Handling', () => {
    it.skip('should_bind_queries_correctly', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        private status = 'initial';

        @Query('getStatus')
        getStatus() {
          return this.status;
        }

        async execute() {
          return this.status;
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      const queryResult = await result.query('getStatus');
      expect(queryResult).toBe('initial');
    });

    it.skip('should_throw_error_for_undefined_query', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        private status = 'initial';

        async execute() {
          return this.status;
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      await expect(result.query('undefinedQuery')).rejects.toThrow('Query undefinedQuery is not defined on this workflow');
    });

    it.skip('should_invoke_query_handlers_with_correct_arguments', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        private status = 'initial';

        @Query('getStatus')
        getStatus(prefix: string, suffix: string) {
          return `${prefix} ${this.status} ${suffix}`;
        }

        async execute() {
          return this.status;
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      const queryResult = await result.query('getStatus', 'Current status is:', 'and it is final.');
      expect(queryResult).toBe('Current status is: initial and it is final.');
    });

    it.skip('should_support_querying_workflow_history', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        private history: string[] = [];

        @Query('getHistory')
        getHistory() {
          return this.history;
        }

        @Signal()
        addToHistory(event: string) {
          this.history.push(event);
        }

        async execute() {
          this.history.push('Workflow started');
          await this.sleep(1000);
          this.history.push('Workflow finished');
          return this.history;
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      await result.signal('addToHistory', 'Custom event');
      const history = await result.query('getHistory');

      expect(history).toEqual(['Workflow started', 'Custom event', 'Workflow finished']);
    });
  });

  describe('Hook Handling', () => {
    it.skip('should_apply_before_hooks_correctly', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        public status = 'initial';

        @Before('updateStatus')
        beforeUpdateStatus() {
          this.status = 'before-hook';
        }

        async updateStatus(newStatus: string) {
          this.status = newStatus;
        }

        async execute() {
          await this.updateStatus('updated');
          return this.status;
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      const workflowResult = await result.result();
      expect(workflowResult).toBe('updated');
    });

    it.skip('should_apply_after_hooks_correctly', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        public status = 'initial';

        async updateStatus(newStatus: string) {
          this.status = newStatus;
        }

        @After('updateStatus')
        afterUpdateStatus() {
          this.status = 'after-hook';
        }

        async execute() {
          await this.updateStatus('updated');
          return this.status;
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      const workflowResult = await result.result();
      expect(workflowResult).toBe('after-hook');
    });

    it.skip('should_execute_before_and_after_hooks_in_correct_order', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        public status = 'initial';
        public hookOrder: string[] = [];

        @Before('updateStatus')
        beforeHook() {
          this.hookOrder.push('beforeHook');
        }

        async updateStatus(newStatus: string) {
          this.status = newStatus;
          this.hookOrder.push('updateStatus');
        }

        @After('updateStatus')
        afterHook() {
          this.hookOrder.push('afterHook');
        }

        async execute() {
          await this.updateStatus('updated');
          return this.hookOrder;
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      const hookOrder = await result.result();
      expect(hookOrder).toEqual(['beforeHook', 'updateStatus', 'afterHook']);
    });

    it.skip('should_gracefully_handle_hook_execution_errors', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        public status = 'initial';
        public errorHandled = false;

        @Before('updateStatus')
        beforeHook() {
          throw new Error('Before hook error');
        }

        async updateStatus(newStatus: string) {
          this.status = newStatus;
        }

        async execute() {
          try {
            await this.updateStatus('updated');
          } catch (error) {
            this.errorHandled = true;
          }
          return this.errorHandled;
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      const errorHandled = await result.result();
      expect(errorHandled).toBe(true);
    });

    it.skip('should_not_apply_hooks_to_undefined_methods', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        public status = 'initial';

        @Before('nonExistentMethod')
        beforeHook() {
          this.status = 'before-hook';
        }

        async execute() {
          return this.status;
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      const workflowResult = await result.result();
      expect(workflowResult).toBe('initial'); // Hook should not have been applied
    });

    it.skip('should_handle_nested_hooks_correctly', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        public status = 'initial';
        public hookOrder: string[] = [];

        @Before('updateStatus')
        firstBeforeHook() {
          this.hookOrder.push('firstBeforeHook');
        }

        @Before('updateStatus')
        secondBeforeHook() {
          this.hookOrder.push('secondBeforeHook');
        }

        async updateStatus(newStatus: string) {
          this.status = newStatus;
          this.hookOrder.push('updateStatus');
        }

        @After('updateStatus')
        firstAfterHook() {
          this.hookOrder.push('firstAfterHook');
        }

        @After('updateStatus')
        secondAfterHook() {
          this.hookOrder.push('secondAfterHook');
        }

        async execute() {
          await this.updateStatus('updated');
          return this.hookOrder;
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      const hookOrder = await result.result();
      expect(hookOrder).toEqual(['firstBeforeHook', 'secondBeforeHook', 'updateStatus', 'firstAfterHook', 'secondAfterHook']);
    });

    it.skip('should_apply_hooks_based_on_condition', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        public status = 'initial';
        public hookApplied = false;

        @Hook({ before: 'updateStatus' })
        conditionalHook() {
          if (this.status === 'trigger') {
            this.hookApplied = true;
          }
        }

        async updateStatus(newStatus: string) {
          this.status = newStatus;
        }

        async execute() {
          await this.updateStatus('trigger');
          return this.hookApplied;
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      const hookApplied = await result.result();
      expect(hookApplied).toBe(true);
    });

    it.skip('should_execute_inherited_hooks_in_child_class', async () => {
      class ParentWorkflow extends Workflow {
        public status = 'initial';

        @Before('updateStatus')
        beforeHook() {
          this.status = 'parent-before-hook';
        }

        async updateStatus(newStatus: string) {
          this.status = newStatus;
        }
      }

      @ChronoFlow()
      class ChildWorkflow extends ParentWorkflow {
        @After('updateStatus')
        afterHook() {
          this.status = 'child-after-hook';
        }

        async execute() {
          await this.updateStatus('updated');
          return this.status;
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(ChildWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      const workflowResult = await result.result();
      expect(workflowResult).toBe('child-after-hook');
    });
  });

  describe('Event Handling', () => {
    it.skip('should_invoke_event_handlers_correctly', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        public eventHandled = false;

        async execute() {
          this.emit.skip('customEvent');
          return 'executed';
        }

        @Signal()
        handleCustomEvent() {
          this.eventHandled = true;
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      await result.signal('handleCustomEvent');
      expect(await result.query('getEventHandled')).toBe(true);
    });

    it.skip('should_invoke_correct_event_handler_based_on_type', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        public eventType = '';

        async execute() {
          this.emit.skip('typeAEvent');
          return 'executed';
        }

        @Signal()
        handleTypeA() {
          this.eventType = 'A';
        }

        @Signal()
        handleTypeB() {
          this.eventType = 'B';
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      await result.signal('handleTypeA');
      expect(await result.query('getEventType')).toBe('A');
    });

    it.skip('should_emit_custom_events_correctly', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        public eventHandled = false;

        async execute() {
          this.emit.skip('customEvent', { data: 'eventData' });
          return 'executed';
        }

        @Signal()
        handleCustomEvent(data: any) {
          if (data.data === 'eventData') {
            this.eventHandled = true;
          }
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      await result.signal('handleCustomEvent', { data: 'eventData' });
      expect(await result.query('getEventHandled')).toBe(true);
    });

    it.skip('should_handle_event_emission_within_workflow_execution', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        public eventHandled = false;

        async execute() {
          this.emit.skip('executionEvent');
          return 'executed';
        }

        @Signal()
        handleExecutionEvent() {
          this.eventHandled = true;
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      await result.signal('handleExecutionEvent');
      expect(await result.query('getEventHandled')).toBe(true);
    });

    it.skip('should_forward_events_to_child_workflows', async () => {
      @ChronoFlow()
      class ChildWorkflow extends Workflow {
        public eventHandled = false;

        @Signal()
        handleEvent() {
          this.eventHandled = true;
        }
      }

      @ChronoFlow()
      class ParentWorkflow extends Workflow {
        async execute() {
          const child = await this.createChildWorkflow(ChildWorkflow, { taskQueue: 'test' });
          this.emit.skip('forwardEvent');
          await child.signal('handleEvent');
          return 'completed';
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(ParentWorkflow, {
        taskQueue: 'test',
        workflowId: 'parent-workflow',
        args: [],
      });

      const childResult = await client.workflow.query(result.workflowId, 'getEventHandled');
      expect(childResult).toBe(true);
    });

    it.skip('should_handle_event_errors_gracefully', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        public errorHandled = false;

        async execute() {
          try {
            this.emit.skip('errorEvent');
            throw new Error('Test error');
          } catch (error) {
            this.errorHandled = true;
          }
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      expect(await result.query('getErrorHandled')).toBe(true);
    });

    it.skip('should_support_event_bubbling_within_nested_workflows', async () => {
      @ChronoFlow()
      class ChildWorkflow extends Workflow {
        public eventHandled = false;

        @Signal()
        handleChildEvent() {
          this.eventHandled = true;
        }
      }

      @ChronoFlow()
      class ParentWorkflow extends Workflow {
        async execute() {
          const child = await this.createChildWorkflow(ChildWorkflow, { taskQueue: 'test' });
          this.emit.skip('bubbleEvent');
          await child.signal('handleChildEvent');
          return 'completed';
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(ParentWorkflow, {
        taskQueue: 'test',
        workflowId: 'parent-workflow',
        args: [],
      });

      const childResult = await client.workflow.query(result.workflowId, 'getEventHandled');
      expect(childResult).toBe(true);
    });

    it.skip('should_allow_event_handler_overriding_in_child_workflows', async () => {
      @ChronoFlow()
      class ParentWorkflow extends Workflow {
        public eventHandled = false;

        @Signal()
        handleEvent() {
          this.eventHandled = true;
        }
      }

      @ChronoFlow()
      class ChildWorkflow extends ParentWorkflow {
        @Signal()
        handleEvent() {
          this.eventHandled = false;
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(ChildWorkflow, {
        taskQueue: 'test',
        workflowId: 'child-workflow',
        args: [],
      });

      expect(await result.query('getEventHandled')).toBe(false);
    });

    it.skip('should_support_event_subscription_and_unsubscription', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        public subscribed = false;

        async execute() {
          this.subscribe('testEvent', this.handleEvent);
          this.emit.skip('testEvent');
          this.unsubscribe('testEvent', this.handleEvent);
        }

        @Signal()
        handleEvent() {
          this.subscribed = true;
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      expect(await result.query('getSubscribed')).toBe(true);
    });

    it.skip('should_trigger_event_handler_on_specific_condition', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        public conditionMet = false;

        async execute() {
          if (this.conditionMet) {
            this.emit.skip('conditionalEvent');
          }
        }

        @Signal()
        handleConditionalEvent() {
          this.conditionMet = true;
        }
      }

      const { client } = testEnv;
      const result = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      await result.signal('handleConditionalEvent');
      expect(await result.query('getConditionMet')).toBe(true);
    });
  });

  describe('Logging', () => {
    it.skip('should_log_workflow_execution_steps', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        async execute() {
          this.log.info('Workflow execution started');
          return 'executed';
        }
      }

      const { client } = testEnv;
      await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      const logEntry = logEntries.find(entry => entry.message.includes('Workflow execution started'));
      expect(logEntry).toBeDefined();
    });

    it.skip('should_log_signals_received', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        @Signal()
        async handleSignal() {
          this.log.info('Signal received');
        }
      }

      const { client } = testEnv;
      const workflow = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      await workflow.signal('handleSignal');

      const logEntry = logEntries.find(entry => entry.message.includes('Signal received'));
      expect(logEntry).toBeDefined();
    });

    it.skip('should_log_queries_made', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        @Query()
        async getState() {
          this.log.info('Query made');
          return 'state';
        }
      }

      const { client } = testEnv;
      const workflow = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      await workflow.query('getState');

      const logEntry = logEntries.find(entry => entry.message.includes('Query made'));
      expect(logEntry).toBeDefined();
    });

    it.skip('should_log_workflow_start_and_end', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        async execute() {
          this.log.info('Workflow started');
          this.log.info('Workflow ended');
          return 'executed';
        }
      }

      const { client } = testEnv;
      await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      const startLog = logEntries.find(entry => entry.message.includes('Workflow started'));
      const endLog = logEntries.find(entry => entry.message.includes('Workflow ended'));

      expect(startLog).toBeDefined();
      expect(endLog).toBeDefined();
    });

    it.skip('should_log_errors_during_workflow_execution', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        async execute() {
          try {
            throw new Error('Execution error');
          } catch (error) {
            this.log.error('Error during execution', { error });
          }
          return 'failed';
        }
      }

      const { client } = testEnv;
      await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      const errorLog = logEntries.find(entry => entry.message.includes('Error during execution'));
      expect(errorLog).toBeDefined();
    });

    it.skip('should_log_before_and_after_hooks_execution', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        @Hook({ before: 'execute' })
        logBeforeExecute() {
          this.log.info('Before execute hook');
        }

        @Hook({ after: 'execute' })
        logAfterExecute() {
          this.log.info('After execute hook');
        }

        async execute() {
          return 'executed';
        }
      }

      const { client } = testEnv;
      await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      const beforeLog = logEntries.find(entry => entry.message.includes('Before execute hook'));
      const afterLog = logEntries.find(entry => entry.message.includes('After execute hook'));

      expect(beforeLog).toBeDefined();
      expect(afterLog).toBeDefined();
    });

    it.skip('should_log_child_workflow_invocations', async () => {
      @ChronoFlow()
      class ChildWorkflow extends Workflow {
        async execute() {
          this.log.info('Child workflow executed');
          return 'child-result';
        }
      }

      @ChronoFlow()
      class ParentWorkflow extends Workflow {
        async execute() {
          const child = await this.createChildWorkflow(ChildWorkflow, { taskQueue: 'test' });
          await child.execute();
          this.log.info('Parent workflow completed');
        }
      }

      const { client } = testEnv;
      await client.workflow.start(ParentWorkflow, {
        taskQueue: 'test',
        workflowId: 'parent-workflow',
        args: [],
      });

      const childLog = logEntries.find(entry => entry.message.includes('Child workflow executed'));
      const parentLog = logEntries.find(entry => entry.message.includes('Parent workflow completed'));

      expect(childLog).toBeDefined();
      expect(parentLog).toBeDefined();
    });

    it.skip('should_log_custom_events', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        async execute() {
          this.emit.skip('customEvent');
          this.log.info('Custom event emitted');
        }
      }

      const { client } = testEnv;
      await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      const logEntry = logEntries.find(entry => entry.message.includes('Custom event emitted'));
      expect(logEntry).toBeDefined();
    });

    it.skip('should_log_workflow_cancellation', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        async execute() {
          this.log.info('Workflow started');
        }
      }

      const { client } = testEnv;
      const workflow = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      await workflow.cancel();

      const logEntry = logEntries.find(entry => entry.message.includes('Workflow started'));
      expect(logEntry).toBeDefined();
      const cancellationLog = logEntries.find(entry => entry.message.includes('Workflow cancelled'));
      expect(cancellationLog).toBeDefined();
    });

    it.skip('should_log_workflow_pauses_and_resumes', async () => {
      @ChronoFlow()
      class TestWorkflow extends Workflow {
        @Signal()
        async pause() {
          this.log.info('Workflow paused');
          this.status = 'paused';
        }

        @Signal()
        async resume() {
          this.log.info('Workflow resumed');
          this.status = 'running';
        }

        async execute() {
          if (this.status === 'paused') {
            await this.condition();
          }
          return 'executed';
        }
      }

      const { client } = testEnv;
      const workflow = await client.workflow.start(TestWorkflow, {
        taskQueue: 'test',
        workflowId: 'test-workflow',
        args: [],
      });

      await workflow.signal('pause');
      await workflow.signal('resume');

      const pauseLog = logEntries.find(entry => entry.message.includes('Workflow paused'));
      const resumeLog = logEntries.find(entry => entry.message.includes('Workflow resumed'));

      expect(pauseLog).toBeDefined();
      expect(resumeLog).toBeDefined();
    });
  });

  describe('Inheritance Handling', () => {
    it.skip('should_correctly_handle_inheritance_of_signals_and_queries', async () => {
      @ChronoFlow()
      class ParentWorkflow extends Workflow {
        @Signal()
        async parentSignal() { }

        @Query()
        async parentQuery() {
          return 'parentQueryResult';
        }
      }

      @ChronoFlow()
      class ChildWorkflow extends ParentWorkflow {
        async execute() {
          return 'executed';
        }
      }

      const childWorkflow = new ChildWorkflow({});
      expect(childWorkflow.parentSignal).toBeDefined();
      expect(await childWorkflow.parentQuery()).toBe('parentQueryResult');
    });

    it.skip('should_execute_inherited_hooks_in_child_class', async () => {
      @ChronoFlow()
      class ParentWorkflow extends Workflow {
        @Hook({ before: 'execute' })
        async beforeExecuteHook() {
          this.log.info('Parent before execute');
        }
      }

      @ChronoFlow()
      class ChildWorkflow extends ParentWorkflow {
        async execute() {
          return 'executed';
        }
      }

      const childWorkflow = new ChildWorkflow({});
      const logs: string[] = [];
      childWorkflow.log.info = (msg: string) => logs.push(msg);

      await childWorkflow.execute();
      expect(logs).toContain('Parent before execute');
    });

    it.skip('should_inherit_and_execute_parent_workflow_logic', async () => {
      @ChronoFlow()
      class ParentWorkflow extends Workflow {
        async parentLogic() {
          return 'parent logic executed';
        }
      }

      @ChronoFlow()
      class ChildWorkflow extends ParentWorkflow {
        async execute() {
          return await this.parentLogic();
        }
      }

      const childWorkflow = new ChildWorkflow({});
      const result = await childWorkflow.execute();
      expect(result).toBe('parent logic executed');
    });

    it.skip('should_allow_overriding_of_inherited_methods', async () => {
      @ChronoFlow()
      class ParentWorkflow extends Workflow {
        async logic() {
          return 'parent logic';
        }
      }

      @ChronoFlow()
      class ChildWorkflow extends ParentWorkflow {
        async logic() {
          return 'child logic';
        }

        async execute() {
          return await this.logic();
        }
      }

      const childWorkflow = new ChildWorkflow({});
      const result = await childWorkflow.execute();
      expect(result).toBe('child logic');
    });

    it.skip('should_correctly_inherit_conditions_and_steps', async () => {
      @ChronoFlow()
      class ParentWorkflow extends Workflow {
        @Step({ name: 'parentStep' })
        async parentStep() {
          return 'parent step executed';
        }

        @Condition('1m')
        async isReady() {
          return true;
        }
      }

      @ChronoFlow()
      class ChildWorkflow extends ParentWorkflow {
        async execute() {
          if (await this.isReady()) {
            return await this.parentStep();
          }
        }
      }

      const childWorkflow = new ChildWorkflow({});
      const result = await childWorkflow.execute();
      expect(result).toBe('parent step executed');
    });

    it.skip('should_correctly_inherit_and_apply_hooks', async () => {
      @ChronoFlow()
      class ParentWorkflow extends Workflow {
        @Hook({ before: 'execute' })
        async parentBeforeHook() {
          this.log.info('Parent before hook');
        }
      }

      @ChronoFlow()
      class ChildWorkflow extends ParentWorkflow {
        async execute() {
          return 'executed';
        }
      }

      const childWorkflow = new ChildWorkflow({});
      const logs: string[] = [];
      childWorkflow.log.info = (msg: string) => logs.push(msg);

      await childWorkflow.execute();
      expect(logs).toContain('Parent before hook');
    });

    it.skip('should_support_mixed_inheritance_from_multiple_parents', async () => {
      class ParentWorkflowA extends Workflow {
        @Signal()
        async signalA() { }

        @Query()
        async queryA() {
          return 'A';
        }
      }

      class ParentWorkflowB extends Workflow {
        @Signal()
        async signalB() { }

        @Query()
        async queryB() {
          return 'B';
        }
      }

      @ChronoFlow()
      class ChildWorkflow extends ParentWorkflowA {
        constructor() {
          super({});
          Object.assign(this, new ParentWorkflowB());
        }

        async execute() {
          return 'executed';
        }
      }

      const childWorkflow = new ChildWorkflow();
      expect(childWorkflow.signalA).toBeDefined();
      expect(childWorkflow.signalB).toBeDefined();
      expect(await childWorkflow.queryA()).toBe('A');
      expect(await childWorkflow.queryB()).toBe('B');
    });

    it.skip('should_allow_inherited_workflows_to_define_additional_steps', async () => {
      @ChronoFlow()
      class ParentWorkflow extends Workflow {
        @Step({ name: 'parentStep' })
        async parentStep() {
          return 'parent step executed';
        }
      }

      @ChronoFlow()
      class ChildWorkflow extends ParentWorkflow {
        @Step({ name: 'childStep' })
        async childStep() {
          return 'child step executed';
        }

        async execute() {
          await this.parentStep();
          return await this.childStep();
        }
      }

      const childWorkflow = new ChildWorkflow({});
      const result = await childWorkflow.execute();
      expect(result).toBe('child step executed');
    });

    it.skip('should_allow_inherited_workflows_to_define_additional_signals_and_queries', async () => {
      @ChronoFlow()
      class ParentWorkflow extends Workflow {
        @Signal()
        async parentSignal() { }

        @Query()
        async parentQuery() {
          return 'parentQueryResult';
        }
      }

      @ChronoFlow()
      class ChildWorkflow extends ParentWorkflow {
        @Signal()
        async childSignal() { }

        @Query()
        async childQuery() {
          return 'childQueryResult';
        }

        async execute() {
          return 'executed';
        }
      }

      const childWorkflow = new ChildWorkflow({});
      expect(childWorkflow.parentSignal).toBeDefined();
      expect(childWorkflow.childSignal).toBeDefined();
      expect(await childWorkflow.parentQuery()).toBe('parentQueryResult');
      expect(await childWorkflow.childQuery()).toBe('childQueryResult');
    });

    it.skip('should_support_inheritance_of_event_handlers', async () => {
      @ChronoFlow()
      class ParentWorkflow extends Workflow {
        @Hook({ before: 'execute' })
        async beforeExecuteHook() {
          this.log.info('Parent before execute');
        }

        async execute() {
          this.emit.skip('event', 'data');
          return 'executed';
        }
      }

      @ChronoFlow()
      class ChildWorkflow extends ParentWorkflow {
        @Hook({ before: 'execute' })
        async childBeforeExecuteHook() {
          this.log.info('Child before execute');
        }

        async execute() {
          return super.execute();
        }
      }

      const childWorkflow = new ChildWorkflow({});
      const logs: string[] = [];
      childWorkflow.log.info = (msg: string) => logs.push(msg);

      await childWorkflow.execute();
      expect(logs).toContain('Parent before execute');
      expect(logs).toContain('Child before execute');
    });
  });

  describe('Nested and Child Workflow Handling', () => {
    it.skip('should_handle_nested_workflows_correctly', async () => {
      @ChronoFlow()
      class ChildWorkflow extends Workflow {
        async execute() {
          return 'child workflow executed';
        }
      }

      @ChronoFlow()
      class ParentWorkflow extends Workflow {
        async execute() {
          const childHandle = await this.createChildWorkflow(ChildWorkflow, 'child-task-queue');
          return await childHandle.result();
        }
      }

      const parentWorkflow = new ParentWorkflow({});
      const result = await parentWorkflow.execute();
      expect(result).toBe('child workflow executed');
    });

    it.skip('should_handle_multiple_child_workflows_with_different_lifecycle_statuses', async () => {
      @ChronoFlow()
      class ChildWorkflowA extends Workflow {
        async execute() {
          return 'A completed';
        }
      }

      @ChronoFlow()
      class ChildWorkflowB extends Workflow {
        async execute() {
          throw new Error('B failed');
        }
      }

      @ChronoFlow()
      class ParentWorkflow extends Workflow {
        async execute() {
          const childA = await this.createChildWorkflow(ChildWorkflowA, 'child-task-queue');
          const childB = await this.createChildWorkflow(ChildWorkflowB, 'child-task-queue');
          const resultA = await childA.result();
          try {
            await childB.result();
          } catch (e) {
            return [resultA, 'B failed'];
          }
        }
      }

      const parentWorkflow = new ParentWorkflow({});
      const result = await parentWorkflow.execute();
      expect(result).toEqual(['A completed', 'B failed']);
    });

    it.skip('should_cancel_child_workflows_correctly', async () => {
      @ChronoFlow()
      class ChildWorkflow extends Workflow {
        async execute() {
          this.cancellationScope.cancelRequested().then(() => {
            this.log.info('Child workflow cancelled');
          });
          await this.awaitCondition();
          return 'child workflow completed';
        }
      }

      @ChronoFlow()
      class ParentWorkflow extends Workflow {
        async execute() {
          const childHandle = await this.createChildWorkflow(ChildWorkflow, 'child-task-queue');
          await this.cancelChildWorkflow(childHandle);
          return 'parent workflow completed';
        }
      }

      const parentWorkflow = new ParentWorkflow({});
      const result = await parentWorkflow.execute();
      expect(result).toBe('parent workflow completed');
    });

    it.skip('should_invoke_child_workflows_with_correct_arguments', async () => {
      @ChronoFlow()
      class ChildWorkflow extends Workflow {
        async execute(arg: string) {
          return `child received: ${arg}`;
        }
      }

      @ChronoFlow()
      class ParentWorkflow extends Workflow {
        async execute() {
          const childHandle = await this.createChildWorkflow(ChildWorkflow, 'child-task-queue', 'testArg');
          return await childHandle.result();
        }
      }

      const parentWorkflow = new ParentWorkflow({});
      const result = await parentWorkflow.execute();
      expect(result).toBe('child received: testArg');
    });

    it.skip('should_propagate_signals_to_nested_child_workflows', async () => {
      @ChronoFlow()
      class ChildWorkflow extends Workflow {
        signalReceived = false;

        @Signal()
        async childSignal() {
          this.signalReceived = true;
        }

        async execute() {
          await this.awaitCondition(() => this.signalReceived);
          return 'signal received';
        }
      }

      @ChronoFlow()
      class ParentWorkflow extends Workflow {
        async execute() {
          const childHandle = await this.createChildWorkflow(ChildWorkflow, 'child-task-queue');
          await this.signalChildWorkflow(childHandle, 'childSignal');
          return await childHandle.result();
        }
      }

      const parentWorkflow = new ParentWorkflow({});
      const result = await parentWorkflow.execute();
      expect(result).toBe('signal received');
    });

    it.skip('should_propagate_queries_to_nested_child_workflows', async () => {
      @ChronoFlow()
      class ChildWorkflow extends Workflow {
        @Query()
        async childQuery() {
          return 'child query result';
        }

        async execute() {
          return 'executed';
        }
      }

      @ChronoFlow()
      class ParentWorkflow extends Workflow {
        async execute() {
          const childHandle = await this.createChildWorkflow(ChildWorkflow, 'child-task-queue');
          return await this.queryChildWorkflow(childHandle, 'childQuery');
        }
      }

      const parentWorkflow = new ParentWorkflow({});
      const result = await parentWorkflow.execute();
      expect(result).toBe('child query result');
    });

    it.skip('should_allow_child_workflows_to_emit_and_handle_events', async () => {
      @ChronoFlow()
      class ChildWorkflow extends Workflow {
        async execute() {
          this.emit.skip('childEvent', 'eventData');
          return 'executed';
        }
      }

      @ChronoFlow()
      class ParentWorkflow extends Workflow {
        eventReceived = false;

        async execute() {
          const childHandle = await this.createChildWorkflow(ChildWorkflow, 'child-task-queue');
          childHandle.on('childEvent', (data: any) => {
            this.eventReceived = data === 'eventData';
          });
          await childHandle.result();
          return this.eventReceived;
        }
      }

      const parentWorkflow = new ParentWorkflow({});
      const result = await parentWorkflow.execute();
      expect(result).toBe(true);
    });

    it.skip('should_handle_cancellation_of_parent_workflow_and_all_children', async () => {
      @ChronoFlow()
      class ChildWorkflow extends Workflow {
        async execute() {
          this.cancellationScope.cancelRequested().then(() => {
            this.log.info('Child workflow cancelled');
          });
          await this.awaitCondition();
          return 'child workflow completed';
        }
      }

      @ChronoFlow()
      class ParentWorkflow extends Workflow {
        async execute() {
          const childHandle = await this.createChildWorkflow(ChildWorkflow, 'child-task-queue');
          this.cancellationScope.cancelRequested().then(async () => {
            await this.cancelChildWorkflow(childHandle);
          });
          await this.cancel();
          return 'parent workflow cancelled';
        }
      }

      const parentWorkflow = new ParentWorkflow({});
      const result = await parentWorkflow.execute();
      expect(result).toBe('parent workflow cancelled');
    });

    it.skip('should_log_all_child_workflow_invocations_and_completions', async () => {
      @ChronoFlow()
      class ChildWorkflow extends Workflow {
        async execute() {
          this.log.info('Child workflow invoked');
          return 'child completed';
        }
      }

      @ChronoFlow()
      class ParentWorkflow extends Workflow {
        async execute() {
          const childHandle = await this.createChildWorkflow(ChildWorkflow, 'child-task-queue');
          const result = await childHandle.result();
          this.log.info('Child workflow completed');
          return result;
        }
      }

      const parentWorkflow = new ParentWorkflow({});
      const logs: string[] = [];
      parentWorkflow.log.info = (msg: string) => logs.push(msg);

      await parentWorkflow.execute();
      expect(logs).toContain('Child workflow invoked');
      expect(logs).toContain('Child workflow completed');
    });

    it.skip('should_handle_retry_logic_for_failed_child_workflows', async () => {
      @ChronoFlow()
      class ChildWorkflow extends Workflow {
        async execute() {
          throw new Error('Child failed');
        }
      }

      @ChronoFlow()
      class ParentWorkflow extends Workflow {
        async execute() {
          let retryCount = 0;
          const retryPolicy = {
            maximumAttempts: 3,
          };
          while (retryCount < retryPolicy.maximumAttempts) {
            try {
              const childHandle = await this.createChildWorkflow(ChildWorkflow, 'child-task-queue');
              await childHandle.result();
              break;
            } catch (error) {
              retryCount++;
              this.log.info(`Retry attempt ${retryCount} failed`);
            }
          }
          return retryCount === retryPolicy.maximumAttempts ? 'failed' : 'success';
        }
      }

      const parentWorkflow = new ParentWorkflow({});
      const result = await parentWorkflow.execute();
      expect(result).toBe('failed');
    });
  });
});

