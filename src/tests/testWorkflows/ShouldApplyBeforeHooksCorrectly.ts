import { ChronoFlow, Workflow, Before } from '../../workflows';

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
