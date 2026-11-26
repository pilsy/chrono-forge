import { Workflow } from '../../workflows';
import { Temporal } from '../../workflows';
import { Query, Signal, Step } from '../../decorators';
import { DSLDefinition } from '../../workflows/DSLInterpreter';
import { proxyActivities, sleep } from '@temporalio/workflow';
import { Duration } from '@temporalio/common';

// 2.0: the DSL runs only the activities a workflow hands it. Name them in a plain object: a proxyActivities() proxy
// answers to any name, so it would not limit what a plan can call.
const { makeHTTPRequest, formatData, processResult } = proxyActivities<
  Record<'makeHTTPRequest' | 'formatData' | 'processResult', (...args: string[]) => Promise<string | undefined>>
>({ startToCloseTimeout: '1 minute' });

/**
 * Example workflow that demonstrates how to use the DSLInterpreter
 * within the Temporal Forge framework.
 */
@Temporal({ activities: { makeHTTPRequest, formatData, processResult } })
export class DSLWorkflowExample extends Workflow {
  /**
   * Signal to update the DSLDefinition definition during workflow execution
   */
  @Signal()
  async updateDSL(newDSL: DSLDefinition): Promise<void> {
    this.dsl = newDSL;
  }

  /**
   * Signal to add a new activity to the DSLDefinition sequence
   */
  @Signal()
  async addActivity(activity: { name: string; with?: string[]; result?: string }): Promise<void> {
    if (!this.dsl.plan || !('sequence' in this.dsl.plan)) {
      this.dsl.plan = {
        sequence: {
          elements: []
        }
      };
    }

    // After the above check, we can assert the plan structure exists
    const plan = this.dsl.plan as { sequence: { elements?: any[] } };

    // Ensure elements exists and is an array
    if (!plan.sequence.elements) {
      plan.sequence.elements = [];
    }

    plan.sequence.elements.push({
      execute: {
        activity
      }
    });
  }

  /**
   * Signal to add a new workflow step to the DSLDefinition sequence
   */
  @Signal()
  async addStep(step: { name: string; with?: string[]; result?: string }): Promise<void> {
    if (!this.dsl.plan || !('sequence' in this.dsl.plan)) {
      this.dsl.plan = {
        sequence: {
          elements: []
        }
      };
    }

    // After the above check, we can assert the plan structure exists
    const plan = this.dsl.plan as { sequence: { elements?: any[] } };

    // Ensure elements exists and is an array
    if (!plan.sequence.elements) {
      plan.sequence.elements = [];
    }

    plan.sequence.elements.push({
      execute: {
        step
      }
    });
  }

  /**
   * Query to get the current DSLDefinition definition
   */
  @Query()
  getDSL(): DSLDefinition {
    return this.dsl;
  }

  /**
   * Query to get the current variables
   */
  @Query()
  getVariables(): Record<string, unknown> {
    return this.dsl.variables;
  }

  /**
   * Workflow step to transform data
   */
  @Step()
  async transformData(data: string): Promise<string> {
    return `transformed_${data}`;
  }

  /**
   * Workflow step to validate data
   */
  @Step()
  async validateData(data: string): Promise<boolean> {
    return data.includes('valid') || data.includes('transformed');
  }

  /**
   * Workflow step to format output
   */
  @Step()
  async formatOutput(data: string, isValid: boolean | string): Promise<string> {
    const validFlag = isValid === 'true' || isValid === true;
    return validFlag ? `formatted_${data}` : 'invalid_data';
  }

  /**
   * Simple workflow step that just sleeps for a specified time
   */
  @Step()
  async sleepStep(sleepTimeMs: Duration): Promise<string> {
    await sleep(sleepTimeMs);
    return `slept for ${sleepTimeMs}ms`;
  }
}
