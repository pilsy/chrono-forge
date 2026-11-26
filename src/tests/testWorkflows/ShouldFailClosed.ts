import { sleep } from '@temporalio/workflow';
import { ApplicationFailure } from '@temporalio/common';
import { Workflow, Temporal } from '../../workflows';
import { Condition, Conditional, Guard, On, Query, Signal } from '../../decorators';

/** A plain (not continueAsNew) workflow must close as CANCELLED when cancelled; 1.x waited forever. */
@Temporal()
export class ShouldCancelCleanly extends Workflow {
  async execute() {
    await sleep('60 seconds');
    return 'finished';
  }
}

/** @Condition sees the workflow as `this` and runs the method once the condition holds. */
@Temporal()
export class ShouldPassConditionWithThis extends Workflow {
  public ready = false;

  @Signal()
  markReady() {
    this.ready = true;
  }

  @Condition(function (this: ShouldPassConditionWithThis) {
    return this.ready;
  }, '20 seconds')
  protected async whenReady() {
    return 'ran';
  }

  async execute() {
    return await this.whenReady();
  }
}

/** @Condition fails closed: a timeout fails the workflow with type ConditionTimeout; 1.x ran the method anyway. */
@Temporal()
export class ShouldFailOnConditionTimeout extends Workflow {
  public ready = false;

  @Condition(function (this: ShouldFailOnConditionTimeout) {
    return this.ready;
  }, '1 second')
  protected async whenReady() {
    return 'ran anyway';
  }

  async execute() {
    return await this.whenReady();
  }
}

/** @Guard is exported and fails the workflow (type GuardFailed) when its check is false. */
@Temporal()
export class ShouldFailOnGuard extends Workflow {
  @Guard(function () {
    return false;
  })
  protected async guarded() {
    return 'ran anyway';
  }

  async execute() {
    return await this.guarded();
  }
}

/** @Conditional no longer swallows an error thrown by the method it wraps. */
@Temporal()
export class ShouldPropagateConditionalMethodError extends Workflow {
  @Conditional(() => true)
  protected async failing() {
    throw ApplicationFailure.create({ type: 'MethodFailed', message: 'method failed', nonRetryable: true });
  }

  async execute() {
    await this.failing();
    return 'swallowed';
  }
}

/** @Conditional fails closed when its condition throws. */
@Temporal()
export class ShouldFailOnConditionalConditionError extends Workflow {
  @Conditional(() => {
    throw new Error('condition broke');
  })
  protected async guarded() {
    return 'ran anyway';
  }

  async execute() {
    return (await this.guarded()) ?? 'skipped';
  }
}

/** A query only reads: no event with the query's name is emitted. */
@Temporal()
export class ShouldNotEmitOnQuery extends Workflow {
  public value = 'v';
  public eventSeen = false;

  @Query()
  getValue() {
    return this.value;
  }

  @On('getValue')
  protected onGetValue() {
    this.eventSeen = true;
  }

  async execute() {
    await sleep('3 seconds');
    return this.eventSeen;
  }
}
