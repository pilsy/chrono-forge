import { condition } from '@temporalio/workflow';
import { Temporal, Workflow } from '../../workflows';
import { Signal } from '../../decorators';

@Temporal()
export class ShouldEmitEventOnSignal extends Workflow {
  public status = 'initial';

  @Signal()
  setStatus(newStatus: string) {
    this.status = newStatus;
  }

  async execute() {
    this.on('setStatus', () => (this.status = 'updatedByEvent'));
    await condition(() => this.status === 'updatedByEvent', '10 seconds');
    return this.status;
  }
}
