import { Workflow } from '../../workflows';
import { Temporal } from '../../workflows';
import { Query, Signal } from '../../decorators';
import { DSLInterpreter, DSL } from '../../workflows/DSLInterpreter';
import { sleep } from '@temporalio/workflow';
import { Duration } from '@temporalio/common';

/**
 * Example workflow that demonstrates how to use the DSLInterpreter
 * within the Temporal Forge framework.
 */
@Temporal()
export class DSLWorkflowExample extends Workflow {
  // The DSL definition that will be executed
  private dsl: DSL = {
    variables: {},
    plan: {
      sequence: {
        elements: []
      }
    }
  };

  // Store the execution result
  private executionResult: any = null;

  // Track execution status
  protected status: 'idle' | 'running' | 'completed' | 'error' = 'idle';
  private error: Error | null = null;

  // Step functions that can be referenced in the DSL
  private workflowSteps: Record<string, (...args: any[]) => Promise<any>> = {
    transformData: this.transformData.bind(this),
    validateData: this.validateData.bind(this),
    formatOutput: this.formatOutput.bind(this),
    sleepStep: this.sleepStep.bind(this)
  };

  /**
   * Main workflow execution method
   */
  async execute(initialDSL?: DSL): Promise<any> {
    try {
      // Use provided DSL or the default one
      this.dsl = initialDSL || this.dsl;
      this.status = 'running';

      // Execute the DSL with both activities and workflow steps
      this.executionResult = await DSLInterpreter(this.dsl, undefined, this.workflowSteps);

      this.status = 'completed';
      return this.executionResult;
    } catch (err) {
      this.status = 'error';
      this.error = err as Error;
      throw err;
    }
  }

  /**
   * Workflow step to transform data
   */
  async transformData(data: string): Promise<string> {
    return `transformed_${data}`;
  }

  /**
   * Workflow step to validate data
   */
  async validateData(data: string): Promise<boolean> {
    return data.includes('valid') || data.includes('transformed');
  }

  /**
   * Workflow step to format output
   */
  async formatOutput(data: string, isValid: boolean | string): Promise<string> {
    console.log('formatOutput', data, isValid);
    // Convert string 'true' to boolean true if needed
    const validFlag = isValid === 'true' || isValid === true;
    return validFlag ? `formatted_${data}` : 'invalid_data';
  }

  /**
   * Simple workflow step that just sleeps for a specified time
   */
  async sleepStep(sleepTimeMs: Duration): Promise<string> {
    await sleep(sleepTimeMs);
    return `slept for ${sleepTimeMs}ms`;
  }

  /**
   * Signal to update the DSL definition during workflow execution
   */
  @Signal()
  async updateDSL(newDSL: DSL): Promise<void> {
    // Update the DSL - this will be used on next execution
    this.dsl = newDSL;
  }

  /**
   * Signal to add a new activity to the DSL sequence
   */
  @Signal()
  async addActivity(activity: { name: string; arguments?: string[]; result?: string }): Promise<void> {
    if (!this.dsl.plan || !('sequence' in this.dsl.plan)) {
      this.dsl.plan = {
        sequence: {
          elements: []
        }
      };
    }

    (this.dsl.plan.sequence.elements as any[]).push({
      execute: {
        activity
      }
    });
  }

  /**
   * Signal to add a new workflow step to the DSL sequence
   */
  @Signal()
  async addStep(step: { name: string; arguments?: string[]; result?: string }): Promise<void> {
    if (!this.dsl.plan || !('sequence' in this.dsl.plan)) {
      this.dsl.plan = {
        sequence: {
          elements: []
        }
      };
    }

    (this.dsl.plan.sequence.elements as any[]).push({
      execute: {
        step
      }
    });
  }

  /**
   * Query to get the current DSL definition
   */
  @Query()
  getDSL(): DSL {
    return this.dsl;
  }

  /**
   * Query to get the current execution status
   */
  @Query()
  getStatus(): { status: string; error: string | null } {
    console.log(this);
    return {
      status: this.status,
      error: this.error ? this.error.message : null
    };
  }

  /**
   * Query to get the execution result
   */
  @Query()
  getResult(): any {
    return this.executionResult;
  }

  /**
   * Query to get the current variables
   */
  @Query()
  getVariables(): Record<string, unknown> {
    return this.dsl.variables;
  }
}
