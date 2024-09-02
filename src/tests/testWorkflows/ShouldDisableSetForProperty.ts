import { Workflow, ChronoFlow, Property } from '../../workflows';

@ChronoFlow()
export class ShouldDisableSetForProperty extends Workflow {
  @Property({ set: false })
  public readonlyProperty: string = 'readonly';

  async execute() {
    return this.readonlyProperty;
  }
}
