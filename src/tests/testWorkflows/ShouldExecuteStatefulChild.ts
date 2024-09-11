import { ChronoFlow } from '../../workflows';
import { ManagedPaths, StatefulWorkflow } from '../../workflows/StatefulWorkflow';
import { Listing } from '../testSchemas';
import { trace } from '@opentelemetry/api';
import { condition } from '@temporalio/workflow';
import { After } from '../../decorators';

@ChronoFlow({
  // schema: Listing
})
export class ShouldExecuteStatefulChild extends StatefulWorkflow {
  protected maxIterations: number = 30;
  protected managedPaths: ManagedPaths = {
    user: {
      autoStartChildren: false,
      workflowType: 'ShouldExecuteStateful',
      entityName: 'User'
    },
    photo: {
      autoStartChildren: true,
      workflowType: 'ShouldExecuteStatefulChild',
      entityName: 'Photo'
    },
    photos: {
      autoStartChildren: true,
      workflowType: 'ShouldExecuteStatefulChild',
      entityName: 'Photo'
    },
    likes: {
      autoStartChildren: true,
      workflowType: 'ShouldExecuteStatefulChild',
      entityName: 'Like'
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
        }, 1000);
      });
    });
  }
}
