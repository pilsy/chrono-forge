import { Temporal, Workflow } from '../../workflows';
import { Query, Step, Signal } from '../../decorators';
import { sleep } from '@temporalio/workflow';

@Temporal()
export class ShouldExecuteSteps extends Workflow {
  private results: string[] = [];
  // Flag to control conditional steps
  public shouldRunConditional: boolean = true;

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

  // Conditional step that only runs when shouldRunConditional is true
  @Step({
    after: 'stepTwo',
    // Use a regular function to allow proper binding with call()
    condition: function () {
      // @ts-ignore
      return this.shouldRunConditional === true;
    }
  })
  async conditionalStep() {
    this.results.push('conditionalStep');
    return 'conditionalStep';
  }

  // This step depends on the conditional step
  @Step({
    after: 'conditionalStep'
  })
  async afterConditional() {
    this.results.push('afterConditional');
    return 'afterConditional';
  }

  // This step always runs after stepTwo regardless of conditional
  @Step({
    after: 'stepTwo'
  })
  async alwaysRun() {
    this.results.push('alwaysRun');
    return 'alwaysRun';
  }

  // Query to get execution order for testing
  @Query()
  getResults() {
    return this.results;
  }

  // Query to check if conditional step was executed
  @Query()
  wasConditionalExecuted() {
    return this.results.includes('conditionalStep');
  }

  // Signal to set the condition flag (used in tests)
  @Signal()
  async setShouldRunConditional(value: boolean) {
    this.shouldRunConditional = value;
    return value;
  }
}
