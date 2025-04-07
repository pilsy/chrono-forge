import { Temporal, Workflow } from '../../workflows';
import { Query, Step } from '../../decorators';
import { sleep } from '@temporalio/workflow';

@Temporal()
export class ShouldExecuteSteps extends Workflow {
  private results: string[] = [];

  @Step()
  async stepOne() {
    this.results.push('stepOne');
    return 'stepOne';
  }

  @Step({
    after: 'stepOne'
  })
  async stepTwo() {
    this.results.push('stepTwo');
    return 'stepTwo';
  }

  @Step({
    after: 'stepTwo'
  })
  async stepThree() {
    this.results.push('stepThree');
    return 'stepThree';
  }

  // Parallel steps that both start after stepOne
  @Step({
    after: 'stepOne'
  })
  async parallelStepA() {
    await sleep(300); // Deliberate delay to test parallelism
    this.results.push('parallelA');
    return 'parallelA';
  }

  @Step({
    after: 'stepOne'
  })
  async parallelStepB() {
    await sleep(100); // Shorter delay but should still run in parallel with A
    this.results.push('parallelB');
    return 'parallelB';
  }

  // This step depends on both parallel steps completing
  @Step({
    after: ['parallelStepA', 'parallelStepB']
  })
  async afterParallel() {
    this.results.push('afterParallel');
    return 'afterParallel';
  }

  // Query to get execution order for testing
  @Query()
  getResults() {
    return this.results;
  }
}
