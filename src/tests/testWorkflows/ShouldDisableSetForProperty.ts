import { Workflow, Temporal } from '../../workflows';
import { Property } from '../../decorators';
import { sleep } from '@temporalio/workflow';

@Temporal()
export class ShouldDisableSetForProperty extends Workflow {
  @Property({ set: false })
  public readonlyProperty: string = 'readonly';

  async execute() {
    await sleep('10 seconds');
    return this.readonlyProperty;
  }
}
