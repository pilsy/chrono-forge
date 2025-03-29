import { Workflow } from '../../workflows';
import { Temporal } from '../../workflows';
import { Query, Signal } from '../../decorators';
import { DSLInterpreter, DSL } from '../../workflows/DSLInterpreter';

/**
 * Example workflow that demonstrates how to use the DSLInterpreter
 * within the Temporal Forge framework.
 */
@Temporal()
export class DSLWorkflowExample extends Workflow {
  // The DSL definition that will be executed
  private dsl: DSL = {
    variables: {},
    root: {
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
  async execute(initialDSL?: DSL): Promise<any> {
    try {
      // Use provided DSL or the default one
      this.dsl = initialDSL || this.dsl;
      this.status = 'running';

      // Execute the DSL
      this.executionResult = await DSLInterpreter(this.dsl);

      this.status = 'completed';
      return this.executionResult;
    } catch (err) {
      this.status = 'error';
      this.error = err as Error;
      throw err;
    }
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
    // Make sure we have a sequence to add to
    if (!this.dsl.root || !('sequence' in this.dsl.root)) {
      this.dsl.root = {
        sequence: {
          elements: []
        }
      };
    }

    // Add the activity to the sequence
    (this.dsl.root.sequence.elements as any[]).push({
      activity
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
