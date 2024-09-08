import { Worker, proxyActivities, proxyLocalActivities, NativeConnection } from '@temporalio/worker';
import { registry } from '../WorkflowRegistry';

/**
 * Example usage
 * 
 * ```typescript
 * import { ChronoFlow, Activity, LocalActivity, ChronoWorker } from './decorators';

 * // Registering a remote activity
 * class UserActivities {
 *   @Activity('fetchUserData', 'user-queue')
 *   async fetchUserData(userId: string): Promise<any> {
 *     // Simulate fetching user data
 *     return { id: userId, name: 'John Doe' };
 *   }
 * 
 *   @LocalActivity('processUserData', 'local-user-queue')
 *   async processUserData(userData: any): Promise<any> {
 *     // Process user data locally
 *     return { ...userData, processed: true };
 *   }
 * }
 * 
 * // Registering a workflow
 * @ChronoFlow('UserWorkflow', 'user-queue')
 * class UserWorkflow {
 *   async execute(userId: string) {
 *     const fetchUserData = proxyActivities({ startToCloseTimeout: '1 minute' }).fetchUserData;
 *     const processUserData = proxyLocalActivities({ startToCloseTimeout: '1 minute' }).processUserData;
 * 
 *     const user = await fetchUserData(userId);
 *     const processedUser = await processUserData(user);
 *     console.log(`Processed User Data: ${JSON.stringify(processedUser)}`);
 *   }
 * }
 * 
 * // Running the worker
 * class MyWorker {
 *   @ChronoWorker(['user-queue', 'local-user-queue'])
 *   static async startWorker() {
 *     // Worker will be started with all registered workflows and activities
 *   }
 * }
 * 
 * // Start the worker
 * MyWorker.startWorker();
 * ```
 * 
 * @param taskQueues The list of task queues for the worker.
 * @param workerOptions Additional options for configuring the worker.
 * @returns A decorator function that starts the Temporal worker.
 */
export function ChronoWorker(taskQueues: string[], workerOptions: Partial<WorkerOptions> = {}) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    descriptor.value = async function (...args: any[]) {
      const workflows = registry.getAllWorkflows().filter((w) => taskQueues.includes(w.taskQueue));
      const activities = registry.getAllActivities().filter((a) => taskQueues.includes(a.taskQueue));

      const remoteActivities: Record<string, ActivityFunction> = {};
      const localActivities: Record<string, ActivityFunction> = {};

      // Dynamically create proxies for activities
      activities.forEach(({ name, activityFn, isLocal }) => {
        if (isLocal) {
          localActivities[name] = proxyLocalActivities({ startToCloseTimeout: '1 minute' })[name];
        } else {
          remoteActivities[name] = proxyActivities({ startToCloseTimeout: '1 minute' })[name];
        }
      });

      const worker = await Worker.create({
        workflowsPath: require.resolve('./workflows'),
        taskQueue: taskQueues.join(','),
        activities: remoteActivities,
        localActivities,
        connection: await NativeConnection.create(),
        ...workerOptions
      });

      console.log(`Starting Temporal worker on task queues: ${taskQueues.join(', ')}`);
      await worker.run();
    };
  };
}
