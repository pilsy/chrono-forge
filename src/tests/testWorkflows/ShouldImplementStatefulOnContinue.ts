import { Temporal } from '../../workflows';
import * as workflow from '@temporalio/workflow';
import { StatefulWorkflow } from '../../workflows/StatefulWorkflow';
import { schemas } from '../testSchemas';
import { Property } from '../../decorators';

/**
 * Test workflow that extends ShouldExecuteStateful and implements the onContinue method
 * This workflow demonstrates the use of the onContinue method for continue-as-new functionality
 */
@Temporal({
  schemaName: 'User',
  schemas,
  saveStateToMemo: true
})
export class ShouldImplementStatefulOnContinue extends StatefulWorkflow {
  @Property()
  protected counter: number = 0;

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
   * @returns The parameters to use for continue-as-new
   */
  protected async onContinue(): Promise<any> {
    // Add or increment counter to demonstrate custom logic
    this.counter += 100;

    // Return the parameters for continue-as-new
    return {
      id: this.id,
      entityName: this.entityName,
      data: this.data,
      state: this.state,
      status: this.status,
      subscriptions: this.subscriptions,
      ancestorWorkflowIds: this.ancestorWorkflowIds
    };
  }
}
