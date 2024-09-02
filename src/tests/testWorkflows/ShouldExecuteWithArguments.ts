import { ChronoFlow, Workflow } from '../../workflows';

@ChronoFlow()
export class ShouldExecuteWithArguments extends Workflow {
  async execute(one: string, two: string, three: string) {
    return `${one},${two},${three}`;
  }
}
