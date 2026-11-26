import { Temporal } from '../../workflows';
import { ManagedPaths, StatefulWorkflow } from '../../workflows/StatefulWorkflow';
import { Property } from '../../decorators';

@Temporal({
  // schema: Listing
  // 2.0: parents forward pause, resume and cancel to children, so the test child opts in too.
  controlSignals: true
})
export class ShouldExecuteStatefulChild extends StatefulWorkflow {
  protected maxIterations: number = 1000;

  // 2.0: opt in to setting status by signal (the tests complete children this way).
  @Property({ set: true })
  protected status: string = (this as any).args?.status ?? 'running';
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
    this.log.info(`Execute`);
  }
}
