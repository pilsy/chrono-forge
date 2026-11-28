import { sleep } from '@temporalio/workflow';
import { Temporal, Workflow } from '../../workflows';
import { Property, Signal } from '../../decorators';
import { StatefulWorkflow } from '../../workflows/StatefulWorkflow';

/**
 * 2.0.1: a state-machine execute() that writes one step per loop leaves a change pending after every pass. The loop
 * applies it at once (2.0 slept 2.5 s each time, about 8 s per task in a three-step machine).
 */
@Temporal({ schemaName: 'User' })
export class ShouldStepWithoutSleeping extends StatefulWorkflow {
  protected maxIterations: number = 1000;

  async execute() {
    const user = this.data as Record<string, any> | undefined;
    if (user && (user.step ?? 0) < 3) {
      user.step = (user.step ?? 0) + 1;
    }
  }
}

/** 2.0.1: an execute() that writes on every pass still yields: one sleep after each run of immediate passes. */
@Temporal({ schemaName: 'User' })
export class ShouldYieldOnRunawayChanges extends StatefulWorkflow {
  protected maxIterations: number = 1000;

  async execute() {
    const user = this.data as Record<string, any> | undefined;
    if (user) {
      user.step = (user.step ?? 0) + 1;
    }
  }
}

/** 2.0.1: a wake-up set by a signal while execute() runs starts another pass (2.0 cleared it after execute()). */
@Temporal()
export class ShouldKeepWakeUpDuringExecute extends Workflow {
  @Property({ set: false })
  protected passes = 0;

  constructor(args: unknown, options: unknown) {
    super(args, options);
    this.isContinueable = true;
  }

  @Signal()
  protected wake(): void {
    this.pendingIteration = true;
  }

  async execute() {
    this.passes++;
    if (this.passes === 1) {
      await sleep('3 seconds');
    }
    return this.passes;
  }
}
