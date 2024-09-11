import { condition } from '@temporalio/workflow';
import { ChronoFlow, Workflow } from '../../workflows';
import { Signal } from '../../decorators';

@ChronoFlow()
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
