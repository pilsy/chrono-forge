import { Workflow } from '../../workflows/Workflow';
import { Property } from '../../decorators';
import { Temporal } from '../../workflows';
import * as workflow from '@temporalio/workflow';

interface ShouldImplementOnContinueParams {
  id: string;
  counter: number;
}

interface ShouldImplementOnContinueOptions {
  workflowType?: string;
}

/**
 * Test workflow that implements the onContinue method
 * This workflow demonstrates the use of the onContinue method for continue-as-new functionality
 */
@Temporal()
export class ShouldImplementOnContinue extends Workflow<
  ShouldImplementOnContinueParams,
  ShouldImplementOnContinueOptions
> {
  @Property()
  protected counter: number;

  @Property()
  protected id: string;

  // Add the isContinueable property to fix the linter error
  protected isContinueable: boolean = true;

  constructor(params: ShouldImplementOnContinueParams, options: ShouldImplementOnContinueOptions) {
    super(params, options);
    this.counter = params.counter || 0;
    this.id = params.id;
    this.isContinueable = true; // Enable continue-as-new functionality
  }

  /**
   * Main execution method for the workflow
   */
  protected async execute(): Promise<unknown> {
    this.counter++;

    // Force continue-as-new after 3 iterations for testing
    if (this.iteration >= 3) {
      this.continueAsNew = true;
    }

    return { id: this.id, counter: this.counter, iteration: this.iteration };
  }

  /**
   * Custom continue-as-new implementation
   * This method will be called when the workflow reaches its maximum iterations
   */
  protected async onContinue(): Promise<Record<string, unknown>> {
    const continueFn = workflow.makeContinueAsNewFunc({
      workflowType: String(this.options.workflowType),
      memo: workflow.workflowInfo().memo,
      searchAttributes: workflow.workflowInfo().searchAttributes
    });

    const params = {
      id: this.id,
      counter: this.counter + 100 // Add 100 to counter to demonstrate custom logic
    };

    await continueFn(params);
    return params;
  }
}
