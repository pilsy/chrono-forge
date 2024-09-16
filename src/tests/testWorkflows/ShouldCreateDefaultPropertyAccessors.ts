import { Workflow, ChronoFlow } from '../../workflows';
import { Property } from '../../decorators';

@ChronoFlow()
export class ShouldCreateDefaultPropertyAccessors extends Workflow {
  async execute() {
    // Return the current status after setting via signal
    return this.status;
  }
}
