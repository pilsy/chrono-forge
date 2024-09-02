import { sleep } from '@temporalio/workflow';
import { ChronoFlow, Workflow, Query } from '../../workflows';

@ChronoFlow()
export class ShouldBindQueriesCorrectly extends Workflow {
  public status = 'initial';

  @Query()
  getStatus() {
    return this.status;
  }

  async execute() {
    await sleep(2500);
    return this.status;
  }
}
