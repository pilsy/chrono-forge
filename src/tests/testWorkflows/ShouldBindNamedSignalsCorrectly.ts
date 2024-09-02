import { condition } from '@temporalio/workflow';
import { ChronoFlow, Workflow, Signal } from '../../workflows';

@ChronoFlow()
export class ShouldBindNamedSignalsCorrectly extends Workflow {
  public status = 'initial';

  @Signal('status')
  setStatus(newStatus: string) {
    this.status = newStatus;
  }

  async execute() {
    await condition(() => this.status === 'updated', '60 seconds');
    return this.status;
  }
}
