import { Workflow, Temporal } from '../../workflows';
import { Property } from '../../decorators';
import { condition } from '@temporalio/workflow';

@Temporal()
export class ShouldCreateCustomPropertyAccessors extends Workflow {
  @Property({ get: 'customGetQuery', set: 'customSetSignal' })
  public customProperty: string = 'initial';

  async execute() {
    await condition(() => this.customProperty !== 'initial', '5 seconds');
    return this.customProperty;
  }
}
