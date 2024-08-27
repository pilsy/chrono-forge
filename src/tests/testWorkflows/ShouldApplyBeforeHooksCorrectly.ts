import { ChronoFlow, Workflow, Before } from "../../workflows/Workflow";

@ChronoFlow("ShouldApplyBeforeHooksCorrectly")
export class ShouldApplyBeforeHooksCorrectly extends Workflow {
  public status = 'initial';

  @Before("execute")
  setStatus() {
    this.status = "beforeHookApplied";
  }

  async execute() {
    return this.status;
  }
}