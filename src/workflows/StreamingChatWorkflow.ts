import * as wf from '@temporalio/workflow';
import { StreamingChatActivity } from '../activities/StreamingChatActivity';
import { log } from '@temporalio/workflow';
import { proxySinks, proxyActivities } from '@temporalio/workflow';
import { ChronoFlow, Workflow, Signal, Query } from '.';

type Status = 'requested' | 'pending' | 'connected' | 'connecting' | 'closed' | 'errored';

const MAX_ITERATIONS = 10000;

const { readFile, readPositionFile } = proxyActivities<{
  readFile: (filePath: string) => Promise<string>;
  readPositionFile: (positionFilePath: string) => Promise<string>;
}>({
  startToCloseTimeout: '5s'
});

@ChronoFlow()
export class StreamingChatWorkflow extends Workflow {
  protected host: string;
  protected port: number;
  protected sessionId: string;
  protected status: Status = 'requested';
  protected desiredStatus: Status = 'requested';
  protected iteration = 0;

  constructor(host: string, port: number, sessionId: string) {
    super();
    this.host = host;
    this.port = port;
    this.sessionId = sessionId;
  }

  @Signal()
  public async ready(): Promise<void> {
    this.desiredStatus = 'connected';
  }

  @Signal()
  public async connect(newHost: string, newPort: number): Promise<void> {
    this.host = newHost;
    this.port = newPort;
    this.desiredStatus = 'requested';
    await this.resumeStreaming();
  }

  @Signal()
  public async setStatus(newStatus: Status): Promise<void> {
    this.desiredStatus = newStatus;
  }

  @Query()
  public getStatus(): Status {
    return this.status;
  }

  protected async execute(): Promise<void> {
    while (this.iteration < MAX_ITERATIONS) {
      this.iteration++;

      try {
        if (this.status !== 'closed') {
          this.status = 'pending';
          await wf.executeChild(StreamingChatActivity, {
            args: [this.host, this.port, this.sessionId],
            retry: {
              initialInterval: '1s',
              maximumAttempts: 3
            }
          });

          this.status = 'connected';
        }
      } catch (error) {
        this.status = 'errored';
        if (this.desiredStatus !== 'closed') {
          this.desiredStatus = 'errored';
        }
      }

      await wf.condition(() => this.status === this.desiredStatus || this.status === 'closed');

      if (this.status === 'closed') {
        await this.cleanUpAndClose();
        return;
      }

      if (this.desiredStatus === 'requested' && this.status !== 'pending') {
        this.status = 'requested';
      } else if (this.desiredStatus === 'connected' && this.status !== 'connected') {
        this.status = 'connected';
      } else if (this.desiredStatus === 'closed') {
        this.status = 'closed';
        await this.cleanUpAndClose();
        return;
      }
    }

    if (this.iteration >= MAX_ITERATIONS) {
      await wf.continueAsNew<typeof StreamingChatWorkflow>(this.host, this.port, this.sessionId);
    }
  }

  private async cleanUpAndClose(): Promise<void> {
    await wf.signal(this.setStatus, 'closed');
    await wf.sleep('10s');
  }

  private async resumeStreaming(): Promise<void> {
    const filePath = `./streams/${this.sessionId}.log`;
    const positionFilePath = `./streams/${this.sessionId}.pos`;

    const data = await readFile(filePath);
    const position = await readPositionFile(positionFilePath);

    log.info(`Resuming stream for session ${this.sessionId} from position ${position}`);
  }
}
