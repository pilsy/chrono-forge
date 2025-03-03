import { limitRecursion } from './limitRecursion';
import { unflatten } from './unflatten';
import { WorkflowHandle } from '@temporalio/client';

/**
 * Represents the state of a workflow.
 *
 * @template T - The type of the state object, defaults to Record<string, any>
 * @property {number} iteration - The current iteration number of the workflow
 * @property {string} status - The current status of the workflow
 * @property {T} state - The state data of the workflow
 */
export interface WorkflowState<T = Record<string, any>> {
  iteration: number;
  status: string;
  state: T;
}

/**
 * Extends WorkflowState to include optional data property.
 *
 * @template D - The type of the data property, defaults to any
 * @property {D} [data] - Optional data associated with the workflow
 */
export interface WorkflowData<D = any> extends WorkflowState {
  data?: D;
}

/**
 * Retrieves and processes workflow memo data from a workflow handle.
 *
 * This function extracts the memo from the workflow handle, parses the workflow ID
 * to get entity information, and processes the memo data using utility functions.
 *
 * @template D - The type of data to be returned in the WorkflowData object
 * @param {WorkflowHandle} handle - The workflow handle to extract memo from
 * @returns {Promise<WorkflowData<D>>} A promise that resolves to the processed workflow data
 * @throws {Error} If the memo is undefined
 */
export async function getMemo<D>(handle: WorkflowHandle): Promise<WorkflowData<D>> {
  const { memo } = await handle.describe();
  const [entityName, entityId] = handle.workflowId.split(/-(.*)/s).slice(0, 2);

  if (!memo) {
    throw new Error(`Memo is undefined`);
  }

  const memoState = unflatten(memo) as WorkflowData;
  memoState.data = limitRecursion(entityId, entityName, memoState.state ?? {});

  return memoState;
}
