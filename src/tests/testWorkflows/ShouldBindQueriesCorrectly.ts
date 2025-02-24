import { sleep } from '@temporalio/workflow';
import { Temporal, Workflow } from '../../workflows';
import { Query } from '../../decorators';

@Temporal()
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
