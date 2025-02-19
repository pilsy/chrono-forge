import { Temporal, Workflow } from '../../workflows';
import { Before } from '../../decorators';

@Temporal()
export class ShouldApplyBeforeHooksCorrectly extends Workflow {
  public status = 'initial';

  @Before('execute')
  setStatus() {
    this.status = 'beforeHookApplied';
  }

  async execute() {
    return this.status;
  }
}
