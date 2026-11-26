import { condition } from '@temporalio/workflow';
import { Workflow, Temporal } from '../../workflows';
import { Signal, On } from '../../decorators';

/**
 * Invoking a @Signal emits an event with the signal's name. The listener is registered with @On so it exists before the
 * signal handlers are bound (a signal sent right after start is delivered as soon as its handler is set).
 */
@Temporal()
export class ShouldEmitEventOnSignal extends Workflow {
  public status = 'initial';
  public eventSeen = false;

  @Signal()
  setStatus(newStatus: string) {
    this.status = newStatus;
  }

  @On('setStatus')
  protected onSetStatus() {
    this.eventSeen = true;
  }

  async execute() {
    await condition(() => this.eventSeen && this.status !== 'initial', '10 seconds');
    return `${this.status}:${this.eventSeen}`;
  }
}
