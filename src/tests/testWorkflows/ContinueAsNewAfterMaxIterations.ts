import { ContinueAsNew } from '../../decorators';
import { StatefulWorkflow, Temporal, Workflow } from '../../workflows';
import * as workflow from '@temporalio/workflow';

@Temporal()
export class ContinueAsNewAfterMaxIterations extends StatefulWorkflow {
  protected continueAsNew: boolean = true;
  protected maxIterations: number = 3;

  async execute() {
    this.log.info('execute');
  }

  @ContinueAsNew()
  async customContinueAsNew() {
    this.log.info('handleMaxIterations');
    const continueFn = workflow.makeContinueAsNewFunc({
      workflowType: String(this.options.workflowType),
      memo: workflow.workflowInfo().memo,
      searchAttributes: workflow.workflowInfo().searchAttributes
    });

    await continueFn({
      state: this.state,
      status: this.status,
      subscriptions: this.subscriptions,
      ...Object.keys(this.params).reduce(
        (params, key: string) => ({
          ...params, // @ts-ignore
          [key]: this[key]
        }),
        {}
      )
    });
  }
}
