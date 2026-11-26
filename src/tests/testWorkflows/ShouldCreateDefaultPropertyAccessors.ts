import { sleep } from '@temporalio/workflow';
import { Workflow, Temporal } from '../../workflows';
import { Property } from '../../decorators';

/**
 * temporal-forge 2.0: a plain `@Property()` creates a query but no signal, so the value can only change inside the
 * workflow. The test sends a `status` signal anyway and expects the value to stay unchanged.
 */
@Temporal()
export class ShouldCreateDefaultPropertyAccessors extends Workflow {
  @Property()
  protected status: string = 'running';

  async execute() {
    await sleep('3 seconds');
    return this.status;
  }
}
