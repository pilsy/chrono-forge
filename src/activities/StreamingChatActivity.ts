/* eslint-disable @typescript-eslint/ban-ts-comment */
import WebSocket from 'ws';
import { pipeline, Transform } from 'stream';
import { WritableWebSocketStream } from '../utils/WritableWebSocketStream';
import { TagBuffer } from '../utils/TagBuffer';
import { Context } from '@temporalio/activity';
import { WorkflowClient } from '@temporalio/client';
import { ChatTagProcessorWorkflow } from '../workflows';

export class StreamingChatActivity {
  private mainBuffer: string = '';
  private activeTagBuffers: TagBuffer[] = [];
  private outputQueue: Promise<void> = Promise.resolve();
  private heartbeatInterval = 1000 * 10;
  private sessionId: string;
  private context: Context = Context.current();
  // @ts-ignore
  private client: WorkflowClient = global.client;

  private abortController: AbortController = new AbortController();

  constructor(
    private readonly host: string,
    private readonly port: number,
    sessionId: string
  ) {
    this.sessionId = sessionId;
  }

  public abort = this.abortController.abort.bind(this);

  public async run() {
    // console.log(`Activity is running...`);
    this.context = Context.current();

    // @ts-ignore
    this.client = global.client;

    // console.log(`ws://${this.host}:${this.port}`);
    const ws = new WebSocket(`ws://${this.host}:${this.port}`);

    // Wrap the WebSocket in streams
    const serverStream = WebSocket.createWebSocketStream(ws, { encoding: 'utf8' });
    const clientStream = new WritableWebSocketStream(ws);

    // Start heartbeating in the background
    this.startHeartbeating();

    const stopHeartbeating = () => {
      clearTimeout(this.heartbeatTimeout);
    };

    // Pipe the server stream through the processing pipeline
    return await new Promise((resolve, reject) => {
      pipeline(
        serverStream,
        new Transform({
          transform: this.processChunk.bind(this, clientStream),
          flush: this.flushRemainingBuffer.bind(this, clientStream),
          signal: this.abortController.signal,
          autoDestroy: true,
          destroy(error, callback) {
            stopHeartbeating();
            callback(null);
          }
        }),
        clientStream,
        (err) => {
          if (err) {
            // console.error('Pipeline failed:', err);
            reject(err);
          } else {
            // console.log('Pipeline succeeded.');
            resolve(true);
          }
        }
      );
    });
  }

  private heartbeatTimeout?: any = null;

  private startHeartbeating() {
    const heartbeat = () => {
      this.context.heartbeat();
      this.heartbeatTimeout = setTimeout(heartbeat, this.heartbeatInterval);
    };
    heartbeat();
  }

  private async processChunk(clientStream: WritableWebSocketStream, chunk: Buffer, encoding: string, callback: Function) {
    this.mainBuffer += chunk.toString();

    while (this.mainBuffer.length > 0) {
      const nextOpeningTag = this.mainBuffer.match(/<(\w+)>/);
      const nextClosingTag = this.activeTagBuffers.length > 0 ? this.mainBuffer.indexOf(`</${this.activeTagBuffers[0].name}>`) : -1;

      if (nextOpeningTag && (nextOpeningTag.index! < nextClosingTag || nextClosingTag === -1)) {
        const preTagContent = this.mainBuffer.slice(0, nextOpeningTag.index);
        if (preTagContent) {
          this.queueOutput(() => this.writeToStream(clientStream, preTagContent)); // Queue content before tag
        }

        const tagName = nextOpeningTag[1];
        const tagBuffer = new TagBuffer(tagName);
        this.activeTagBuffers.unshift(tagBuffer);

        this.mainBuffer = this.mainBuffer.slice(nextOpeningTag.index! + nextOpeningTag[0].length);
      } else if (nextClosingTag !== -1) {
        const activeTagBuffer = this.activeTagBuffers.shift();
        if (activeTagBuffer) {
          activeTagBuffer.appendContent(this.mainBuffer.slice(0, nextClosingTag));
          this.mainBuffer = this.mainBuffer.slice(nextClosingTag + `</${activeTagBuffer.name}>`.length);

          this.queueOutput(async () => {
            const processedContent = await this.processTagContent(activeTagBuffer);
            return this.writeToStream(clientStream, processedContent);
            // return this.writeToStream(clientStream, `<${activeTagBuffer.name}>${processedContent}</${activeTagBuffer.name}>`);
          });
        }
      } else {
        if (this.activeTagBuffers.length > 0) {
          this.activeTagBuffers[0].appendContent(this.mainBuffer);
        } else {
          // Queue any remaining content that doesn't belong to any tags
          const remainingContent = this.mainBuffer;
          this.queueOutput(() => this.writeToStream(clientStream, remainingContent));
          this.mainBuffer = ''; // Clear the buffer after writing
        }
      }
    }

    callback(); // Signal that processing for this chunk is complete
  }

  private async flushRemainingBuffer(clientStream: WritableWebSocketStream, callback: Function) {
    if (this.mainBuffer.length > 0) {
      await this.queueOutput(() => this.writeToStream(clientStream, this.mainBuffer));
      this.mainBuffer = '';
    }
    callback();
  }

  private async writeToStream(clientStream: WritableWebSocketStream, content: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const result = clientStream.write(content);
      if (result) {
        resolve();
      } else {
        clientStream.once('drain', resolve);
      }
    });
  }

  private queueOutput(task: () => Promise<void>) {
    this.outputQueue = this.outputQueue.then(() => task());
  }

  protected async processTagContent(tagBuffer: TagBuffer): Promise<string> {
    // console.log(`Starting workflow for tag ${JSON.stringify(tagBuffer.json())}`);
    const processedContent = await this.client.execute('ChatTagProcessorWorkflow', {
      workflowId: tagBuffer.runId,
      taskQueue: 'test',
      args: [tagBuffer.json()]
    });
    // console.log(`Got result of tag buffer ${JSON.stringify(tagBuffer.json())}`, processedContent);
    return processedContent;
  }
}
