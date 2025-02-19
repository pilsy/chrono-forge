import { condition } from '@temporalio/workflow';
import { Temporal, Workflow } from '../../workflows';
import { Signal } from '../../decorators';

@Temporal()
export class ShouldBindSignalsCorrectly extends Workflow {
  public status = 'initial';

  @Signal()
  setStatus(newStatus: string) {
    this.status = newStatus;
  }

  async execute() {
    await condition(() => this.status === 'updated', '60 seconds');
    return this.status;
  }
}
