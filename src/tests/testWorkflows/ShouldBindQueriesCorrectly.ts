import { sleep } from "@temporalio/workflow";
import { ChronoFlow, Workflow, Query } from "../../workflows/Workflow";

@ChronoFlow("ShouldBindQueriesCorrectly")
export class ShouldBindQueriesCorrectly extends Workflow {
  public status = 'initial';

  @Query()
  getStatus() {
    return this.status;
  }

  async execute() {
    await sleep(5000);
    return this.status;
  }
}