type WorkflowConstructor = { new (...args: any[]): any };
type ActivityFunction = (...args: any[]) => Promise<any>;

interface WorkflowRegistryInterface {
  registerWorkflow(name: string, workflowClass: WorkflowConstructor): void;
  getAllWorkflows(): { name: string; workflowClass: WorkflowConstructor }[];

  registerActivity(name: string, activityFn: ActivityFunction): void;
  getAllActivities(): { name: string; activityFn: ActivityFunction }[];
}

class WorkflowRegistry implements WorkflowRegistryInterface {
  private static instance: WorkflowRegistry;

  public static getInstance(): WorkflowRegistry {
    if (!WorkflowRegistry.instance) {
      WorkflowRegistry.instance = new WorkflowRegistry();
    }
    return WorkflowRegistry.instance;
  }

  private workflows: Map<string, WorkflowConstructor>;
  private activities: Map<string, ActivityFunction>;

  private constructor() {
    this.workflows = new Map();
    this.activities = new Map();
  }

  public registerWorkflow(name: string, workflowClass: WorkflowConstructor): void {
    if (!this.workflows.has(name)) {
      this.workflows.set(name, workflowClass);
      console.log(`Registered workflow: ${name}`);
    } else {
      console.warn(`Workflow ${name} is already registered.`);
    }
  }

  public getAllWorkflows(): { name: string; workflowClass: WorkflowConstructor }[] {
    return Array.from(this.workflows.entries()).map(([name, workflowClass]) => ({
      name,
      workflowClass
    }));
  }

  public registerActivity(name: string, activityFn: ActivityFunction): void {
    if (!this.activities.has(name)) {
      this.activities.set(name, activityFn);
      console.log(`Registered activity: ${name}`);
    } else {
      console.warn(`Activity ${name} is already registered.`);
    }
  }

  public getAllActivities(): { name: string; activityFn: ActivityFunction }[] {
    return Array.from(this.activities.entries()).map(([name, activityFn]) => ({
      name,
      activityFn
    }));
  }
}

export const registry = WorkflowRegistry.getInstance();
