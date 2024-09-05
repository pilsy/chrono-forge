import { condition } from '@temporalio/workflow';
import { ChronoFlow, Workflow, Property, Signal } from '../../workflows';

@ChronoFlow()
export class ShouldSignalWithStartAndArguments extends Workflow {
  protected continueAsNew: boolean = true;

  @Property()
  protected data: Record<string, any> = {};

  @Signal('start')
  protected signalToStart(signalArgs: any) {
    console.log(signalArgs);
    console.log(this);
  }

  protected async condition(): Promise<any> {
    return await condition(() => this.pendingUpdate, '1 minute');
  }

  async execute(...args: any[]) {
    console.log(`Execute`);
    return `${args.join(', ')}`;
  }
}
