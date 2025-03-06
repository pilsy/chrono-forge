import { Workflow, Temporal } from '../../workflows';
import { Condition, Property } from '../../decorators';

@Temporal()
export class ShouldCreateDefaultPropertyAccessors extends Workflow {
  @Property()
  protected status: string = 'running';

  // @ts-ignore
  @Condition(() => this?.status === 'running', '1 second')
  async execute() {
    return this.status;
  }
}
