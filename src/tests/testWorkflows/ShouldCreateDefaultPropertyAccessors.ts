import { Workflow, ChronoFlow, Property, Signal, Query } from '../../workflows';

@ChronoFlow()
export class ShouldCreateDefaultPropertyAccessors extends Workflow {
  @Property()
  public status: string = 'initial';

  async execute() {
    // Return the current status after setting via signal
    return this.status;
  }
}
