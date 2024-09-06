import { condition } from '@temporalio/workflow';
import { ChronoFlow, Workflow, Property, Signal } from '../../workflows';

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

  protected async condition(): Promise<any> {
    return await condition(() => this.pendingUpdate, '1 minute');
  }

  async execute() {
    await condition(() => this.pendingUpdate, '1 minute');
    return this.data;
  }
}
