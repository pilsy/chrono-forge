import { Temporal, StatefulWorkflow, ManagedPaths, Action, Debounce, Property, Signal } from '../..';
import { workflowInfo } from '@temporalio/workflow';
import { schemas } from '../testSchemas';

export type TestAction = {
  actionId: string;
  type: 'testAction';
  payload: {
    fromUpdate: string;
  };
};

@Temporal({
  schemaName: 'User',
  schemas,
  saveStateToMemo: true
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

  @Property({ path: 'fromUpdate' })
  protected fromUpdate!: string;

  @Property({ path: 'listings' })
  protected listings: any;

  @Action<TestAction, void>()
  protected async testAction(action: TestAction): Promise<void> {
    if (!this.data) {
      throw new Error(`There is no data available yet...`);
    }
    const { fromUpdate } = action.payload;
    this.fromUpdate = fromUpdate;
    console.log(`fromUpdate=${fromUpdate}`);
  }

  @Property()
  protected counter: number = 0;

  @Signal()
  public async incrementNumberTest() {
    console.log('incrementNumberTest');
    for (let i = 0; i < 10; i++) {
      await this.debounceTest();
    }
  }

  @Debounce(100)
  private debounceTest() {
    this.counter++;
  }

  @Property({ set: false })
  protected async firstExecutionRunId() {
    const rid = JSON.stringify(workflowInfo().firstExecutionRunId ?? undefined);
    this.log.info(`firstExecutionRunId=${rid}`);
    return rid;
  }

  async execute(params: any) {
    console.log('execute', this.state);
  }
}
