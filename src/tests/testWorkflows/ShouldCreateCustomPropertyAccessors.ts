import { Workflow, ChronoFlow } from '../../workflows';
import { Property } from '../../decorators';

@ChronoFlow()
export class ShouldCreateCustomPropertyAccessors extends Workflow {
  @Property({ get: 'customGetQuery', set: 'customSetSignal' })
  public customProperty: string = 'initial';

  async execute() {
    return this.customProperty;
  }
}
