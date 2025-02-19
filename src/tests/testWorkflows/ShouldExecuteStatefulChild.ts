import { Temporal } from '../../workflows';
import { ManagedPaths, StatefulWorkflow } from '../../workflows/StatefulWorkflow';

@Temporal({
  // schema: Listing
})
export class ShouldExecuteStatefulChild extends StatefulWorkflow {
  protected maxIterations: number = 1000;
  protected managedPaths: ManagedPaths = {
    user: {
      autoStart: false,
      workflowType: 'ShouldExecuteStateful',
      entityName: 'User'
    },
    photo: {
      autoStart: true,
      workflowType: 'ShouldExecuteStatefulChild',
      entityName: 'Photo'
    },
    photos: {
      autoStart: true,
      workflowType: 'ShouldExecuteStatefulChild',
      entityName: 'Photo'
    },
    likes: {
      autoStart: true,
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
