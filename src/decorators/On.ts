import 'reflect-metadata';
import { EVENTS_METADATA_KEY } from './metadata';

/**
 * Decorator that binds a method to handle specific workflow or state events.
 *
 * The `@On` decorator allows methods to respond to various types of events within the workflow system:
 *
 * ## State Events
 * Prefix with 'state:' to listen to state changes:
 * - `state:updated` - Triggered when an entity is updated
 * - `state:created` - Triggered when a new entity is created
 * - `state:deleted` - Triggered when an entity is deleted
 * - `state:*` - Wildcard to catch all state events
 *
 * ## Child Workflow Events
 * Events related to child workflow management:
 * - `child:${entityName}:started` - When a child workflow starts
 * - `child:${entityName}:updated` - When a child workflow receives updates
 * - `child:${entityName}:deleted` - When a child workflow is terminated
 * - `child:*` - Wildcard to catch all child workflow events
 *
 * ## Lifecycle Events
 * Core workflow lifecycle events:
 * - `init` - Workflow initialization
 * - `setup` - Initial workflow setup
 * - `beforeExecute` - Before main execution
 * - `afterExecute` - After main execution
 * - `error` - Error handling
 *
 * @param event - The event name to listen for. Can include wildcards (*) for pattern matching.
 *
 * @example
 * ```typescript
 * // Listen for state updates
 * @On('state:updated')
 * protected async onStateUpdated(update: Record<string, any>) {
 *   this.log.info(`State updated: ${JSON.stringify(update)}`);
 * }
 *
 * // Listen for child workflow events
 * @On('child:Task:started')
 * protected async onTaskStarted(taskData: any) {
 *   this.log.info(`New task workflow started: ${taskData.id}`);
 * }
 *
 * // Listen for all child events
 * @On('child:*')
 * protected async onAnyChildEvent(eventData: any) {
 *   this.log.debug(`Child workflow event: ${JSON.stringify(eventData)}`);
 * }
 * ```
 */
export const On = (event: string) => {
  return (target: any, propertyKey: string) => {
    const eventHandlers = Reflect.getOwnMetadata(EVENTS_METADATA_KEY, target) ?? [];

    eventHandlers.push({ event, method: propertyKey });

    Reflect.defineMetadata(EVENTS_METADATA_KEY, eventHandlers, target);
  };
};
