import { ChronoFlow } from '../../workflows/Workflow';
import { ManagedPaths, StatefulWorkflow } from '../../workflows/StatefulWorkflow';
import { User } from '../testSchemas';
import { trace } from '@opentelemetry/api';
import { condition } from '@temporalio/workflow';

@ChronoFlow({
  schema: User
})
export class ShouldExecuteStateful extends StatefulWorkflow {
  protected maxIterations: number = 30;
  protected managedPaths: ManagedPaths = {
    listings: {
      autoStartChildren: true,
      workflowType: 'ShouldExecuteStatefulChild',
      entityName: 'Listing'
    }
  };

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
