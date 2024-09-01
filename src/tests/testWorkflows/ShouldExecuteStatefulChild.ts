import { After, ChronoFlow } from '../../workflows/Workflow';
import { ManagedPaths, StatefulWorkflow } from '../../workflows/StatefulWorkflow';
import { Listing } from '../testSchemas';
import { trace } from '@opentelemetry/api';
import { condition } from '@temporalio/workflow';

@ChronoFlow({
  schema: Listing
})
export class ShouldExecuteStatefulChild extends StatefulWorkflow {
  protected maxIterations: number = 3;
  protected managedPaths: ManagedPaths = {
    user: {
      autoStartChildren: false,
      workflowType: 'ShouldExecuteStateful'
    }
  };

  // @After("update")
  // async afterUpdate() {

  // }

  async execute(params: any) {
    return new Promise(async (resolve) => {
      await trace.getTracer('temporal_worker').startActiveSpan('test', (span) => {
        setTimeout(() => {
          resolve(params);
        }, 100);
      });
    });
  }
}
