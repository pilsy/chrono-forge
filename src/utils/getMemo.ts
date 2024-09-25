import { ExternalWorkflowHandle } from '@temporalio/workflow';
import { EntitiesState } from './entities';
import { limitRecursion } from './limitRecursion';
import { unflatten } from './unflatten';
import { WorkflowHandle } from '@temporalio/client';

export type WorkflowMemo<T = EntitiesState> = {
  iteration: number;
  status: string;
  state: EntitiesState;
};

export type WorkflowState<D = any> = {
  iteration: number;
  status: string;
  state: D;
};

export async function getMemo<D extends WorkflowState>(handle: WorkflowHandle): Promise<WorkflowState<D>> {
  const { memo } = await handle.describe();
  const entityName = String(handle.workflowId.split('-').shift());
  const entityId = handle.workflowId.replace(`${entityName}-`, '');

  const data = unflatten(memo as WorkflowMemo) as WorkflowState<D>;
  data.state = limitRecursion(entityId, entityName, data.state);

  return data;
}
