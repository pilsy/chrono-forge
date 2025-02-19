import { Workflow, Temporal } from '../../workflows';
import { Property } from '../../decorators';

@Temporal()
export class ShouldCreateDefaultPropertyAccessors extends Workflow {
  async execute() {
    // Return the current status after setting via signal
    return this.status;
  }
}
