import { sleep } from '@temporalio/workflow';
import { Workflow, Temporal } from '../../workflows';

/**
 * temporal-forge 2.0: the base Workflow's control fields (status, dsl, continueAsNew, pendingIteration, pendingUpdate,
 * startDelay, conditionTimeout) are queryable but can no longer be set by a signal of the same name.
 */
@Temporal()
export class ShouldNotAllowSettingBaseFields extends Workflow {
  async execute() {
    await sleep('3 seconds');
    return {
      status: this.status,
      dsl: this.dsl ?? null,
      continueAsNew: this.continueAsNew,
      pendingIteration: this.pendingIteration,
      startDelay: this.startDelay ?? null,
      conditionTimeout: this.conditionTimeout ?? null
    };
  }
}
