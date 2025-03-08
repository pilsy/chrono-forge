import { Temporal } from '../../workflows';
import * as workflow from '@temporalio/workflow';
import { ShouldExecuteStateful } from './ShouldExecuteStateful';
import { schemas } from '../testSchemas';

/**
 * Test workflow that extends ShouldExecuteStateful and implements the onContinue method
 * This workflow demonstrates the use of the onContinue method for continue-as-new functionality
 */
@Temporal({
  schemaName: 'User',
  schemas,
  saveStateToMemo: true
})
export class ShouldImplementStatefulOnContinue extends ShouldExecuteStateful {
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
