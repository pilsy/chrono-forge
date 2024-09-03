/* eslint-disable no-async-promise-executor */
/* eslint-disable @typescript-eslint/ban-ts-comment */
import { StreamingChatActivity } from './StreamingChatActivity';
import WebSocket from 'ws';
import * as activities from '..';
import { TestWorkflowEnvironment, MockActivityEnvironment } from '@temporalio/testing';
import { Worker, Runtime, DefaultLogger, LogEntry } from '@temporalio/worker';
import { v4 as uuid4 } from 'uuid';
import { WorkflowCoverage } from '@temporalio/nyc-test-coverage';
import { ChatTagProcessorWorkflow } from '../workflows';

const workflowCoverage = new WorkflowCoverage();

describe('StreamingChatActivity', () => {
  let wss: WebSocket.Server;
  let port: number;
  let host: string;
  let testEnv: MockActivityEnvironment;
  let testWorkerEnv: TestWorkflowEnvironment;
  let activity: StreamingChatActivity;
  let worker: Worker;

  beforeAll(async () => {
    Runtime.install({
      logger: new DefaultLogger('WARN', (entry: LogEntry) => console.log(`[${entry.level}]`, entry.message))
    });

    testWorkerEnv = await TestWorkflowEnvironment.createLocal();
    const { client, nativeConnection } = testWorkerEnv;

    // @ts-ignore
    global.client = client.workflow;

    worker = await Worker.create(
      workflowCoverage.augmentWorkerOptions({
        connection: nativeConnection,
        taskQueue: 'test',
        workflowsPath: require.resolve('../../workflows'),
        activities
      })
    );
    void worker.run();
  }, 60000);

  beforeEach((done) => {
    wss = new WebSocket.Server({ port: 0 }, () => {
      const address = wss.address() as WebSocket.AddressInfo;
      port = address.port;
      host = 'localhost';
      done();
    });
    testEnv = new MockActivityEnvironment({ attempt: 2 });
  }, 60000);

  afterEach((done) => {
    jest.clearAllMocks();
    wss.close(done);
  }, 60000);

  afterAll(async () => {
    await worker?.shutdown();
    workflowCoverage.mergeIntoGlobalCoverage();
  }, 60000);

  async function runActivityWithMessage(messageSent: string, expectedMessage: string) {
    const receivedMessages: string[] = [];

    await new Promise(async (resolve) => {
      wss.on('connection', (ws) => {
        ws.on('message', (message) => {
          console.log(message.toString());
          receivedMessages.push(message.toString());
          if (receivedMessages.join('') === expectedMessage) {
            console.log(receivedMessages.join(''));
            resolve(true);
          }
        });
        ws.send(messageSent);
      });

      void testEnv.run(async () => {
        activity = new StreamingChatActivity(host, port, uuid4());
        await activity.run();
      });
    });

    expect(receivedMessages.join('')).toEqual(expectedMessage);
  }

  it('ChatTagProcessorWorkflow with mock activity', async () => {
    const { client } = testWorkerEnv;
    const content = 'the content to change';
    const result = await client.workflow.execute('ChatTagProcessorWorkflow', {
      workflowId: uuid4(),
      taskQueue: 'test',
      args: [
        {
          name: 'test',
          content
        }
      ]
    });
    expect(result).toEqual(content.toUpperCase());
  });

  it('should connect to the websocket server, and correctly process 1 tag', async () => {
    const messageSent = 'This is a test message that has <someTag>the content to change</someTag> in it!!!';
    const expectedMessage = 'This is a test message that has <someTag>THE CONTENT TO CHANGE</someTag> in it!!!';
    await runActivityWithMessage(messageSent, expectedMessage);
  }, 60000);

  it('should connect to the websocket server, and correctly process 2 tags', async () => {
    const messageSent = 'This is a test message that has <someTag>the content to change</someTag> in it with a <second>tag</second> in it!!!';
    const expectedMessage =
      'This is a test message that has <someTag>THE CONTENT TO CHANGE</someTag> in it with a <second>TAG</second> in it!!!';
    await runActivityWithMessage(messageSent, expectedMessage);
  }, 60000);

  it('should handle incomplete tags correctly', async () => {
    const messageSent = 'This is a test message with an <incomplete tag still open';
    const expectedMessage = 'This is a test message with an <incomplete tag still open';
    await runActivityWithMessage(messageSent, expectedMessage);
  }, 60000);

  it('should handle non-tag content after an opening bracket', async () => {
    const messageSent = "This is a test message with a < that isn't a tag";
    const expectedMessage = "This is a test message with a < that isn't a tag";
    await runActivityWithMessage(messageSent, expectedMessage);
  }, 60000);

  it('should handle multiple tags with nested structures', async () => {
    const messageSent = '<outer><inner>nested content</inner> more outer content</outer>';
    const expectedMessage = '<outer><inner>NESTED CONTENT</inner> more outer content</outer>';
    await runActivityWithMessage(messageSent, expectedMessage);
  }, 60000);

  it('should handle large chunks of data efficiently', async () => {
    const largeData = 'x'.repeat(1000000); // 1 MB of data
    const messageSent = `<tag>${largeData}</tag>`;
    const expectedMessage = `<tag>${largeData.toUpperCase()}</tag>`;
    await runActivityWithMessage(messageSent, expectedMessage);
  }, 60000);

  it('should close the connection properly on receiving a "close" signal', async () => {
    const spyClose = jest.fn();
    const wsClient = new WebSocket(`ws://${host}:${port}`);

    wsClient.on('close', spyClose);
    wsClient.close();

    expect(spyClose).toHaveBeenCalled();
  });
});
