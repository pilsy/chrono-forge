import { ChronoFlow, Workflow } from "../../workflows/Workflow";

@ChronoFlow()
export class ShouldExecuteWithArguments extends Workflow {
  protected continueAsNew: boolean = true;
  protected maxIterations: number = 3;

  async execute() {
    return `${one},${two},${three}`;
  }

  protected async handleMaxIterations(): Promise<void> {
    
  }
}