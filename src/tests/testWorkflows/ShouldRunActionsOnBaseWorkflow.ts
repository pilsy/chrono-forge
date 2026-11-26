import { condition, sleep } from '@temporalio/workflow';
import { Workflow, Temporal } from '../../workflows';
import { Action, Validator } from '../../decorators';

export type Approval = { approvalId: string; planSha256: string };

/**
 * temporal-forge 2.0: @Action/@Validator work on the base Workflow as Temporal Updates. The validator runs before an
 * Update is accepted, so a wrong plan hash or a reused approval is rejected and never reaches the workflow history.
 */
@Temporal()
export class ShouldRunActionsOnBaseWorkflow extends Workflow<{ planSha256: string }> {
  private used: string[] = [];

  @Validator<Approval>('approve')
  protected validateApprove(approval: Approval) {
    if (approval.planSha256 !== this.args.planSha256) {
      throw new Error('plan hash does not match');
    }
    if (this.used.includes(approval.approvalId)) {
      throw new Error('approval already used');
    }
  }

  @Action<Approval, string>()
  protected async approve(approval: Approval): Promise<string> {
    this.used.push(approval.approvalId);
    return `approved:${approval.approvalId}`;
  }

  async execute() {
    await condition(() => this.used.length > 0, '20 seconds');
    await sleep('2 seconds');
    return this.used;
  }
}

/** An async validator can't reject an Update, so 2.0 refuses to start a workflow that declares one. */
@Temporal()
export class ShouldRejectAsyncValidator extends Workflow {
  @Validator('approve')
  protected async validateApprove() {
    throw new Error('never reached');
  }

  @Action()
  protected async approve(): Promise<string> {
    return 'approved';
  }

  async execute() {
    return 'should not run';
  }
}
