import * as workflow from '@temporalio/workflow';
import type { Duration } from '@temporalio/common';
import { condition, sleep } from '@temporalio/workflow';
import { Workflow, Temporal } from '../../workflows';
import { Action, Validator } from '../../decorators';

type Approval = { approvalId: string; planSha256: string };

/**
 * temporal-forge 2.0 coverage for defaults the first round of tests left out: validators along the class chain,
 * Update names, DSL code via @Temporal, and cancelling children that Temporal would not cancel on its own.
 */

// Not decorated: @Temporal turns a class into a workflow function, which can't be extended.
abstract class ApprovalBase extends Workflow<{ planSha256: string }> {
  protected used: string[] = [];

  @Validator<Approval>('approve')
  protected validateApprove(approval: Approval) {
    if (approval.planSha256 !== this.args.planSha256) {
      throw new Error('plan hash does not match');
    }
  }

  @Action<Approval, string>()
  protected async approve(approval: Approval): Promise<string> {
    this.used.push(approval.approvalId);
    return `approved:${approval.approvalId}`;
  }

  async execute() {
    await condition(() => this.used.length > 0, '20 seconds');
    await sleep('1 second');
    return this.used;
  }
}

/** Inherits the base class's validator. */
@Temporal()
export class ShouldInheritValidator extends ApprovalBase {}

/** Declares its own validator for 'approve', which replaces the inherited one for this class only. */
@Temporal()
export class ShouldUseSubclassValidator extends ApprovalBase {
  @Validator<Approval>('approve')
  protected validateApproveStrict(approval: Approval) {
    if (!approval.approvalId.startsWith('ok-')) {
      throw new Error('subclass rule');
    }
  }
}

/** An @Action with its own Update name. */
@Temporal()
export class ShouldUseActionName extends Workflow {
  private granted = false;

  @Action({ name: 'grant' })
  protected async approveRequest(): Promise<string> {
    this.granted = true;
    return 'granted';
  }

  async execute() {
    await condition(() => this.granted, '20 seconds');
    await sleep('1 second');
    return this.granted;
  }
}

/** Runs the `dsl` from its arguments with code statements allowed. */
@Temporal({ allowDSLCode: true })
export class ShouldRunDSLCodeWhenAllowed extends Workflow {}

/** Runs the `dsl` from its arguments with the default options: code statements are off. */
@Temporal()
export class ShouldNotRunDSLCodeByDefault extends Workflow {}

/** A plain child workflow that runs until it is cancelled. */
export async function cancellableChild(): Promise<string> {
  await workflow.sleep('60 seconds');
  return 'child finished';
}

/** A plain child workflow that ignores cancellation. */
export async function stubbornChild(): Promise<string> {
  await workflow.CancellationScope.nonCancellable(() => workflow.sleep('60 seconds'));
  return 'stubborn finished';
}

/**
 * Starts a child in a non-cancellable scope with the ABANDON parent-close policy, so neither Temporal's scope
 * propagation nor the parent-close policy would cancel it: only the explicit request in cancelChildren() does.
 */
@Temporal()
export class ShouldCancelChildOutsideScope extends Workflow<{ childType: string; childId: string }> {
  protected childCancellationTimeout: Duration = '3 seconds';

  async execute() {
    const handle = await workflow.CancellationScope.nonCancellable(() =>
      workflow.startChild(this.args.childType, {
        workflowId: this.args.childId,
        parentClosePolicy: workflow.ParentClosePolicy.ABANDON
      })
    );
    this.handles.set(handle.workflowId, handle);
    await workflow.sleep('60 seconds');
    return 'parent finished';
  }
}
