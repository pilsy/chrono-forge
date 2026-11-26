import { condition } from '@temporalio/workflow';
import { Workflow, Temporal } from '../../workflows';
import { Property } from '../../decorators';

/**
 * temporal-forge 2.0: `@Property({ set: true })` opts a property in to being set by a signal of the same name, and a
 * string `set` with the default `get` names the signal (this used to fall back to the property name).
 */
@Temporal()
export class ShouldAllowExplicitPropertySet extends Workflow {
  @Property({ set: true })
  public label: string = 'initial';

  @Property({ set: 'renameTo' })
  public name: string = 'initial';

  async execute() {
    await condition(() => this.label !== 'initial' && this.name !== 'initial', '10 seconds');
    return `${this.label}|${this.name}`;
  }
}
