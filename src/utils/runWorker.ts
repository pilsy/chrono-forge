// createWorker.ts
import { Worker } from '@temporalio/worker';
import { registry } from '../WorkflowRegistry';
import * as fs from 'fs';
import * as path from 'path';

interface CreateWorkerOptions {
  workflowsPath?: string;
  activitiesPath?: string;
  taskQueue: string;
  workerOptions?: Record<string, unknown>;
  startupDelay?: number;
  restartOnFailure?: boolean;
  maxRestartAttempts?: number;
}

type WorkerInstance = {
  run: () => Promise<void>;
  stop: () => Promise<void>;
  on: (event: 'error' | 'stopped' | 'shutdown', listener: (error?: Error) => void) => void;
  shutdown: () => Promise<void>;
};

async function createWorker({
  workflowsPath,
  activitiesPath,
  taskQueue,
  workerOptions = {},
  startupDelay = 0,
  restartOnFailure = false,
  maxRestartAttempts = 3
}: CreateWorkerOptions): Promise<WorkerInstance> {
  const registeredWorkflows = registry.getAllWorkflows();
  const registeredActivities = registry.getAllActivities();

  let generatedContent = `
    // Auto-generated by createWorker utility
    import { Worker } from '@temporalio/worker';

    // Import registered workflows
    ${registeredWorkflows.map(({ name, workflowClass }) => `import ${name} from '${workflowClass}';`).join('\n')}
    
    // Import registered activities
    ${registeredActivities.map(({ name, activityFn }) => `import ${name} from '${activityFn}';`).join('\n')}
  `;

  if (workflowsPath) {
    generatedContent += `
      // Import user-defined workflows
      import * as userWorkflows from '${workflowsPath}';
    `;
  }

  if (activitiesPath) {
    generatedContent += `
      // Import user-defined activities
      import * as userActivities from '${activitiesPath}';
    `;
  }

  generatedContent += `
    // Export all workflows
    export const workflows = {
      ${registeredWorkflows.map(({ name }) => name).join(',\n')},
      ...userWorkflows,
    };

    // Export all activities
    export const activities = {
      ${registeredActivities.map(({ name }) => name).join(',\n')},
      ...userActivities,
    };
  `;

  const generatedFilePath = path.resolve(__dirname, 'generatedWorkflows.ts');
  fs.writeFileSync(generatedFilePath, generatedContent);

  let restartAttempts = 0;
  let workerInstance: Worker | null = null;
  const errorHandlers: Array<(error: Error) => void> = [];
  const stopHandlers: Array<() => void> = [];
  const shutdownHandlers: Array<() => void> = [];

  const createAndRunWorker = async (): Promise<void> => {
    try {
      workerInstance = await Worker.create({
        taskQueue,
        workflowsPath: generatedFilePath,
        activities: path.resolve(__dirname, activitiesPath || ''),
        ...workerOptions
      });

      console.log(`Worker created for task queue: ${taskQueue}`);
      await workerInstance.run();
      console.log(`Worker started on task queue: ${taskQueue}`);
    } catch (error) {
      console.error('Worker encountered an error:', error);
      errorHandlers.forEach((handler) => handler(error));

      if (restartOnFailure && restartAttempts < maxRestartAttempts) {
        restartAttempts++;
        console.log(`Restarting worker... Attempt ${restartAttempts}/${maxRestartAttempts}`);
        await createAndRunWorker();
      } else {
        stopHandlers.forEach((handler) => handler());
      }
    }
  };

  // Step 7: Graceful Shutdown Logic
  const shutdown = async (): Promise<void> => {
    console.log('Initiating graceful shutdown...');
    if (workerInstance) {
      await workerInstance.shutdown(); // Ensure no new tasks are accepted
      shutdownHandlers.forEach((handler) => handler());
      console.log('Worker shutdown completed gracefully.');
    }
  };

  // Handle process signals for graceful shutdown
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Step 8: Start the worker after a delay (if specified)
  setTimeout(createAndRunWorker, startupDelay);

  // Step 9: Return an object to manage the worker instance
  return {
    run: async () => await createAndRunWorker(),
    stop: async () => {
      if (workerInstance) {
        await workerInstance.shutdown();
        console.log('Worker stopped');
      }
    },
    shutdown,
    on: (event, listener) => {
      if (event === 'error') {
        errorHandlers.push(listener);
      } else if (event === 'stopped') {
        stopHandlers.push(listener);
      } else if (event === 'shutdown') {
        shutdownHandlers.push(listener);
      }
    }
  };
}

export default createWorker;
