import { condition } from '@temporalio/workflow';
import { ChronoFlow, Workflow } from '../../workflows';
import { Signal, Property } from '../../decorators';

@ChronoFlow()
export class ShouldSignalWithStartAndArguments extends Workflow {
  protected continueAsNew: boolean = false;

  @Property()
  protected data: Record<string, any> = {};

  @Signal('start')
  protected signalToStart(data: any) {
    this.pendingUpdate = true;
    this.data = data;
  }

  async execute() {
    await condition(() => this.pendingUpdate, '1 minute');
    return this.data;
  }
}
