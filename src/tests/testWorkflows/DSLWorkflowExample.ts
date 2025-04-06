import { Workflow } from '../../workflows';
import { Temporal } from '../../workflows';
import { Query, Signal, Step } from '../../decorators';
import { DSLInterpreter, DSLDefinition } from '../../workflows/DSLInterpreter';
import { sleep } from '@temporalio/workflow';
import { Duration } from '@temporalio/common';

/**
 * Example workflow that demonstrates how to use the DSLInterpreter
 * within the Temporal Forge framework.
 */
@Temporal()
export class DSLWorkflowExample extends Workflow {
  // The DSLDefinition definition that will be executed
  dsl: DSLDefinition = {
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

  /**
   * Main workflow execution method
   */
  async execute(initialDSL?: DSLDefinition): Promise<any> {
    try {
      this.dsl = initialDSL || this.dsl;
      this.status = 'running';

      const interpreter = DSLInterpreter(this.dsl, undefined, this.getStepHandlers());

      // Handle each generation from the interpreter
      for await (const generation of interpreter) {
        this.emitAsync('generation', {
          nodeId: generation.nodeId,
          nodeIds: generation.nodeIds
        });

        // Execute the current generation and store result
        const result = await generation.execute();
        if (result !== undefined) {
          this.executionResult = result;
        }
      }

      this.status = 'completed';
      return this.executionResult;
    } catch (error) {
      this.status = 'error';
      this.error = error as Error;
      throw error;
    }
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
    console.log('formatOutput', data, isValid);
    // Convert string 'true' to boolean true if needed
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

  /**
   * Signal to update the DSLDefinition definition during workflow execution
   */
  @Signal()
  async updateDSL(newDSL: DSLDefinition): Promise<void> {
    // Update the DSLDefinition - this will be used on next execution
    this.dsl = newDSL;
  }

  /**
   * Signal to add a new activity to the DSLDefinition sequence
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
   * Signal to add a new workflow step to the DSLDefinition sequence
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
   * Query to get the current DSLDefinition definition
   */
  @Query()
  getDSL(): DSLDefinition {
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
