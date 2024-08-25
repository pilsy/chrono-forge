import {
  CancellationScope,
  isCancellation,
  defineQuery,
  WorkflowInterceptorsFactory,
  getExternalWorkflowHandle,
  defineSignal,
  setHandler,
  condition,
  log,
  continueAsNew,
} from "@temporalio/workflow";

import {
  OpenTelemetryInboundInterceptor,
  OpenTelemetryOutboundInterceptor,
} from "@temporalio/interceptors-opentelemetry/lib/workflow";

import reducer, {
  EntitiesState,
  handleDeleteEntities,
  handleUpdateEntities
} from './utils/entities';

import { detailedDiff } from "deep-object-diff";
import { isEmpty } from "lodash";

export type EntitiesStateWorkflowParams = {
  state?: EntitiesState;
  status?: "running" | "paused" | "cancelled" | "complete";
  subscriptions?: Subscription[];
};

export type Subscription = {
  workflowId: string;
  signalName: string;
  dataWatchPath: string;
};

const MAX_ITERATIONS = 10000;

export async function EntitiesStateWorkflow({
  state = {},
  status = "running",
  subscriptions = [],
}: EntitiesStateWorkflowParams): Promise<void> {
  let iteration = 0;
  const handles: {[sId: string]: ReturnType<typeof getExternalWorkflowHandle>} = {};
  
  try {
    const pendingChanges: any[] = [];
    setHandler(defineQuery("state"), (path?: string) => path ? state[path] : state);
    setHandler(defineSignal("update"), ({updates, entityName, strategy}) => !isEmpty(updates) ?? pendingChanges.push({
      updates,
      entityName,
      strategy,
    }));
    setHandler(defineSignal("delete"), ({deletions, entityName}) => !isEmpty(deletions) ?? pendingChanges.push({
      deletions,
      entityName,
    }));
    setHandler(defineQuery("subscriptions"), () => subscriptions);
    setHandler(defineSignal("subscribe"), ({workflowId, signalName, dataWatchPath}: Subscription) => {
      const currentSubscription = subscriptions.find(
        s => s.workflowId === workflowId
          && s.dataWatchPath === dataWatchPath
          && s.signalName === signalName
      );
      if (!currentSubscription) {
        handles[workflowId] = await getExternalWorkflowHandle(workflowId);
        subscriptions.push(subscription)
      }
    });
    setHandler(defineSignal("unsubscribe"), ({workflowId, signalName, dataWatchPath}: Subscription) => {
      const currentSubscriptionIndex = subscriptions.find(
        s => s.workflowId === workflowId
          && s.dataWatchPath === dataWatchPath
          && s.signalName === signalName
      );
      if (currentSubscriptionIndex !== -1) {
        delete handles[workflowId];
        subscriptions.splice(currentSubscriptionIndex, 1);
      }
    });
    
    while (status === 'running') {
      await condition(() => pendingChanges.length > 0 || status !== "running");

      if (status === 'paused') {
        log.info(`Pausing...`);
        await Promise.all(subscriptions.map(subscription => {
          try {
            await handles[subscription.workflowId].signal("pause");
          } catch(e) {
            log.debug(e);
          }
        }));
        
        log.info(`Paused.`);
        await condition(() => status !== 'paused');
        log.info(`Running...`);
      }
      
      let newState = false;
      while (pendingChanges.length > 0) {
        const change = pendingChanges.shift();
        newState = reducer(newState || state,
          change?.updates
            ? handleUpdateEntities(newState || state, change.updates, change?.strategy)
            : handleDeleteEntities(newState || state, change?.deletions)
        );
      }

      if (newState) {
        const differences = detailedDiff(state, newState);
        if (!isEmpty(differences)) {
          await notifySubscribers(differences, subscriptions);
        }
      }
  
      if (++iteration >= MAX_ITERATIONS) {
        log.info('Restarting workflow due to MAX_ITERATIONS limit');
        await continueAsNew(EntitiesStateWorkflow, { state, status, subscriptions });
        break;
      }
    }
  } catch (err) {
    if (isCancellation(err)) {
      await CancellationScope.nonCancellable(async () => {
        for (const listener of listeners) {
          try {
            log.info(`Sending cancellation signal to ${listener.workflowId}...`);
            await (await getExternalWorkflowHandle(listener.workflowId)).cancel();
          } catch (e) {
            log.error(`Error sending cancellation signal to ${listener.workflowId}: ${e}`);
          }
        }
      });
      log.info(`Cancelled!`);
      throw err;
    }
  }
};

export const interceptors: WorkflowInterceptorsFactory = () => ({
  inbound: [new OpenTelemetryInboundInterceptor()],
  outbound: [new OpenTelemetryOutboundInterceptor()],
});

function pathMatches(subscriberPath: string, changePath: string): boolean {
  const regex = new RegExp(`^${subscriberPath.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`);
  return regex.test(changePath);
};

function notifySubscribers(difference: Update, subscribers: Subscriber[]): void {
  subscribers.forEach(subscriber => {
    if (pathMatches(subscriber.dataWatchPath, difference.path)) {
      const { workflowId, signalName } = subscriber;
      Workflow.signalExternalWorkflow(workflowId, signalName, difference.value);
      logger.info(`Notified ${workflowId} about change at ${difference.path}`);
    }
  });
};
