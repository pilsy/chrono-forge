import { Workflow, ChronoFlow, Property } from '../../workflows/Workflow';

@ChronoFlow()
export class ShouldCreateCustomPropertyAccessors extends Workflow {
  @Property({ get: 'customGetQuery', set: 'customSetSignal' })
  public customProperty: string = 'initial';

  async execute() {
    return this.customProperty;
  }
}
