import { Workflow, ChronoFlow } from '../../workflows';
import { Property } from '../../decorators';

@ChronoFlow()
export class ShouldDisableSetForProperty extends Workflow {
  @Property({ set: false })
  public readonlyProperty: string = 'readonly';

  async execute() {
    return this.readonlyProperty;
  }
}
