import { Temporal } from '../../workflows';
import { ManagedPaths, StatefulWorkflow } from '../../workflows/StatefulWorkflow';

/**
 * 2.0.1 fixes found while building one long-running StatefulWorkflow per agent with managed Task children.
 */

/** A managed path's processData runs with the workflow as `this` (like `condition`). */
@Temporal({ schemaName: 'User' })
export class ShouldBindProcessData extends StatefulWorkflow {
  protected maxIterations: number = 1000;
  protected managedPaths: ManagedPaths = {
    listings: {
      autoStart: true,
      workflowType: 'ShouldExecuteStatefulChild',
      entityName: 'Listing',
      processData(this: StatefulWorkflow, listing: Record<string, any>) {
        return { ...listing, name: `${listing.name} via ${(this as any).id}` };
      }
    }
  };
}

/** One managed child whose ID already exists must not stop the other children of the same change from starting. */
@Temporal({ schemaName: 'User' })
export class ShouldSkipExistingChild extends StatefulWorkflow {
  protected maxIterations: number = 1000;
  protected managedPaths: ManagedPaths = {
    listings: {
      autoStart: true,
      workflowType: 'ShouldExecuteStatefulChild',
      entityName: 'Listing'
    }
  };
}
