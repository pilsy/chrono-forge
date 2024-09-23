import { ChronoFlow } from '../../workflows';
import { ManagedPaths, StatefulWorkflow } from '../../workflows/StatefulWorkflow';

@ChronoFlow({
  // schema: Listing
})
export class ShouldExecuteStatefulChild extends StatefulWorkflow {
  protected maxIterations: number = 1000;
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
    console.log(`Execute`);
  }
}
