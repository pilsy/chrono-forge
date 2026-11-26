import { condition, sleep } from '@temporalio/workflow';
import { Workflow, Temporal } from '../../workflows';
import { Action, On, Property, Step, Validator } from '../../decorators';

/**
 * temporal-forge 2.0 review fixes: control signals are opt-in and behave, validator and action errors reject the
 * Update instead of wedging the workflow, a misnamed validator or a start-up error fails the run.
 */

/** Opts in to control signals. stepTwo must still run after a pause during stepOne and a resume. */
@Temporal({ controlSignals: true })
export class ShouldPauseBetweenSteps extends Workflow {
  @Property({ set: false })
  protected ran: string[] = [];

  @Step()
  async stepOne() {
    this.ran.push('stepOne');
    await sleep('3 seconds');
    return 'stepOne';
  }

  @Step({ after: 'stepOne' })
  async stepTwo() {
    this.ran.push('stepTwo');
    return 'stepTwo';
  }

  async execute() {
    await super.execute();
    return this.ran;
  }
}

/** A continue-as-new workflow with control signals: a cancel signal must stop it without another run of execute. */
@Temporal({ controlSignals: true })
export class ShouldStopOnCancelSignal extends Workflow {
  @Property({ set: false })
  protected runs = 0;

  constructor(args: unknown, options: unknown) {
    super(args, options);
    this.isContinueable = true;
  }

  async execute() {
    this.runs++;
    return this.runs;
  }
}

/** Default options: no pause, resume or cancel signal. */
@Temporal()
export class ShouldHaveNoControlSignalsByDefault extends Workflow {
  @Property({ set: false })
  protected done = false;

  @Action()
  protected async finish(): Promise<string> {
    this.done = true;
    return 'finished';
  }

  async execute() {
    await condition(() => this.done, '20 seconds');
    return this.status;
  }
}

/**
 * Validator and action errors: `approve` has a validator that returns a rejected Promise (not declared async, so it
 * passes the start-up check), `explode` throws a plain Error. Both must reject only their Update; `finish` then ends
 * the workflow normally.
 */
@Temporal()
export class ShouldRejectOnlyTheUpdate extends Workflow {
  private done = false;

  @Validator('approve')
  protected validateApprove() {
    return Promise.reject(new Error('async rejection'));
  }

  @Action()
  protected async approve(): Promise<string> {
    return 'approved';
  }

  @Action()
  protected async explode(): Promise<string> {
    throw new Error('boom');
  }

  @Action()
  protected async finish(): Promise<string> {
    this.done = true;
    return 'finished';
  }

  async execute() {
    await condition(() => this.done, '20 seconds');
    return 'completed';
  }
}

/** A validator whose name matches no action ('aprove' next to 'approve'): the workflow must fail at start. */
@Temporal()
export class ShouldFailOnMisnamedValidator extends Workflow {
  @Validator('aprove')
  protected validateApprove() {
    throw new Error('never reached');
  }

  @Action()
  protected async approve(): Promise<string> {
    return 'approved';
  }

  async execute() {
    return 'should not run';
  }
}

/** A plain Error in an init listener must fail the run, not leave it RUNNING with the task retrying. */
@Temporal()
export class ShouldFailOnInitError extends Workflow {
  @On('init')
  protected breakOnInit() {
    throw new Error('init failed');
  }

  async execute() {
    return 'should not run';
  }
}
