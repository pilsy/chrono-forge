import { Temporal, Workflow } from '../../workflows';

@Temporal()
export class ShouldExecuteWithArguments extends Workflow {
  protected continueAsNew: boolean = true;
  protected maxIterations: number = 3;

  async execute() {
    return `${one},${two},${three}`;
  }

  protected async handleMaxIterations(): Promise<void> {}
}
