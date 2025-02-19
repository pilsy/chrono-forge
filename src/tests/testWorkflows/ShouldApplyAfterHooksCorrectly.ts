import { Temporal, Workflow } from '../../workflows';
import { After } from '../../decorators';

@Temporal()
export class ShouldApplyAfterHooksCorrectly extends Workflow {
  public status = 'initial';

  @After('test')
  afterHook() {
    this.status = 'afterHookApplied';
  }

  async test() {
    this.status = 'test';
  }

  async execute() {
    await this.test();
    return this.status;
  }
}
