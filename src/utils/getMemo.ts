import { ExternalWorkflowHandle } from '@temporalio/workflow';
import { EntitiesState } from '../store/entities';
import { limitRecursion } from './limitRecursion';
import { unflatten } from './unflatten';
import { WorkflowHandle } from '@temporalio/client';

export interface WorkflowState<T = Record<string, any>> {
  iteration: number;
  status: string;
  state: T;
}

export interface WorkflowData<D = any> extends WorkflowState {
  data?: D;
}

export async function getMemo<D>(handle: WorkflowHandle): Promise<WorkflowData<D>> {
  const { memo } = await handle.describe();
  const entityName = String(handle.workflowId.split('-').shift());
  const entityId = handle.workflowId.replace(`${entityName}-`, '');

  if (!memo) {
    throw new Error(`Memo is undefined`);
  }

  const memoState = unflatten(memo) as WorkflowData;
  memoState.data = limitRecursion(entityId, entityName, memoState.state);

  return memoState;
}
