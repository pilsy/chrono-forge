import { Temporal, Workflow } from '../../workflows';

@Temporal()
export class ShouldExecuteWithArguments extends Workflow {
  async execute(one: string, two: string, three: string) {
    return `${one},${two},${three}`;
  }
}
