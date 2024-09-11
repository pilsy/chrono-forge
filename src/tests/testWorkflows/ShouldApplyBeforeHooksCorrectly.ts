import { ChronoFlow, Workflow } from '../../workflows';
import { Before } from '../../decorators';

@ChronoFlow()
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
