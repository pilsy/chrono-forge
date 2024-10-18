import { ChronoFlow } from '../../workflows';
import { ManagedPaths, StatefulWorkflow } from '../../workflows/StatefulWorkflow';
import { User, Listing } from '../testSchemas';
import { trace } from '@opentelemetry/api';
import { condition } from '@temporalio/workflow';
import { Action, On, Property } from '../../decorators';

export type TestAction = {
  actionId: string;
  payload: {
    testUpdate: string;
  };
};

@ChronoFlow({
  schema: User
})
export class ShouldExecuteStateful extends StatefulWorkflow {
  protected maxIterations: number = 1000;
  protected managedPaths: ManagedPaths = {
    listings: {
      autoStart: true,
      workflowType: 'ShouldExecuteStatefulChild',
      entityName: 'Listing'
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
    },
    photo: {
      autoStart: true,
      workflowType: 'ShouldExecuteStatefulChild',
      entityName: 'Photo'
    }
  };

  @Property({ path: 'listings' })
  protected listings: any;

  @Property({ memo: '' })
  @Action()
  protected testAction(action: TestAction) {
    if (!this.data) {
      throw new Error(`There is no data available yet...`);
    }
    console.log(this.data);
  }

  async execute(params: any) {
    console.log('execute');
    // console.log(this.listings);
    // // if (this.listings.length < 3) {
    // //   this.listings.push({
    // //     id: 'fake',
    // //     user: this.id,
    // //     test: true
    // //   });
    // // }
    // if (this.listings.length === 2) {
    //   this.listings.pop();
    // }
  }

  // @On('updated')
  // async onUpdated(update: Record<string, any>, newState: Record<string, any>, previousState: Record<string, any>) {
  //   this.log.info(JSON.stringify(update));
  //   this.log.debug(JSON.stringify(newState));
  //   this.log.debug(JSON.stringify(previousState));
  // }

  // @On('created')
  // async onCreated(created: Record<string, any>, newState: Record<string, any>, previousState: Record<string, any>) {
  //   this.log.info(JSON.stringify(created));
  //   this.log.debug(JSON.stringify(newState));
  //   this.log.debug(JSON.stringify(previousState));
  // }
}
