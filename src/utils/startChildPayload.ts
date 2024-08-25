import {
  ChildWorkflowCancellationType,
  ParentClosePolicy,
} from "@temporalio/workflow";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function startChildPayload(workflowId: string, args: any[])  {
  return {
    args,
    workflowId,
    cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
    parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_REQUEST_CANCEL,
    startToCloseTimeout: "1 hour",
  };
};