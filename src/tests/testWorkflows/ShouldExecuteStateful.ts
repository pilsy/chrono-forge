import { ChronoFlow } from '../../workflows';
import { ManagedPaths, StatefulWorkflow } from '../../workflows/StatefulWorkflow';
import { User } from '../testSchemas';
import { trace } from '@opentelemetry/api';
import { condition } from '@temporalio/workflow';
import { On } from '../../decorators';

@ChronoFlow({
  schema: User
})
export class ShouldExecuteStateful extends StatefulWorkflow {
  protected maxIterations: number = 1000;
  protected managedPaths: ManagedPaths = {
    listings: {
      autoStartChildren: true,
      workflowType: 'ShouldExecuteStatefulChild',
      entityName: 'Listing'
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
    },
    photo: {
      autoStartChildren: true,
      workflowType: 'ShouldExecuteStatefulChild',
      entityName: 'Photo'
    }
  };

  async execute(params: any) {
    return new Promise(async (resolve) => {
      await trace.getTracer('temporal_worker').startActiveSpan('test', (span) => {
        setTimeout(() => {
          // console.log(this);
          resolve(params);
        }, 100);
      });
    });
  }

  @On('updated')
  async onUpdated(update: Record<string, any>, newState: Record<string, any>, previousState: Record<string, any>) {
    this.log.info(JSON.stringify(update));
    this.log.debug(JSON.stringify(newState));
    this.log.debug(JSON.stringify(previousState));
  }

  @On('created')
  async onCreated(created: Record<string, any>, newState: Record<string, any>, previousState: Record<string, any>) {
    this.log.info(JSON.stringify(created));
    this.log.debug(JSON.stringify(newState));
    this.log.debug(JSON.stringify(previousState));
  }
}
