import { Workflow, ChronoFlow } from '../../workflows';
import { Property } from '../../decorators';

@ChronoFlow()
export class ShouldCreateDefaultPropertyAccessors extends Workflow {
  @Property()
  public status: string = 'initial';

  async execute() {
    // Return the current status after setting via signal
    return this.status;
  }
}
