type WorkflowConstructor = { new (...args: any[]): any };
type ActivityFunction = (...args: any[]) => Promise<any>;

export interface RegisteredActivity {
  activityFn: ActivityFunction;
  isLocal: boolean;
  taskQueue: string;
}

export interface WorkflowRegistryInterface {
  registerWorkflow(name: string, workflowClass: WorkflowConstructor, taskQueue: string): void;
  getAllWorkflows(): { name: string; workflowClass: WorkflowConstructor; taskQueue: string }[];

  registerActivity(name: string, activityFn: ActivityFunction, isLocal: boolean, taskQueue: string): void;
  getAllActivities(): { name: string; activityFn: ActivityFunction; isLocal: boolean; taskQueue: string }[];
}

export class WorkflowRegistry implements WorkflowRegistryInterface {
  private static instance: WorkflowRegistry;

  public static getInstance(): WorkflowRegistry {
    if (!WorkflowRegistry.instance) {
      WorkflowRegistry.instance = new WorkflowRegistry();
    }
    return WorkflowRegistry.instance;
  }

  private workflows: Map<string, { workflowClass: WorkflowConstructor; taskQueue: string }>;
  private activities: Map<string, RegisteredActivity>;

  private constructor() {
    this.workflows = new Map();
    this.activities = new Map();
  }

  public registerWorkflow(name: string, workflowClass: WorkflowConstructor, taskQueue: string): void {
    if (!this.workflows.has(name)) {
      this.workflows.set(name, { workflowClass, taskQueue });
      console.log(`Registered workflow: ${name} on task queue: ${taskQueue}`);
    } else {
      console.warn(`Workflow ${name} is already registered.`);
    }
  }

  public getAllWorkflows(): { name: string; workflowClass: WorkflowConstructor; taskQueue: string }[] {
    return Array.from(this.workflows.entries()).map(([name, { workflowClass, taskQueue }]) => ({
      name,
      workflowClass,
      taskQueue
    }));
  }

  public registerActivity(name: string, activityFn: ActivityFunction, isLocal: boolean, taskQueue: string): void {
    if (!this.activities.has(name)) {
      this.activities.set(name, { activityFn, isLocal, taskQueue });
      console.log(`Registered ${isLocal ? 'local' : 'remote'} activity: ${name} on task queue: ${taskQueue}`);
    } else {
      console.warn(`Activity ${name} is already registered.`);
    }
  }

  public getAllActivities(): { name: string; activityFn: ActivityFunction; isLocal: boolean; taskQueue: string }[] {
    return Array.from(this.activities.entries()).map(([name, { activityFn, isLocal, taskQueue }]) => ({
      name,
      activityFn,
      isLocal,
      taskQueue
    }));
  }
}

export const registry = WorkflowRegistry.getInstance();
export default registry;
