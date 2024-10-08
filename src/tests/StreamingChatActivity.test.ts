/* eslint-disable no-async-promise-executor */
/* eslint-disable @typescript-eslint/ban-ts-comment */
import { StreamingChatActivity } from '../activities/StreamingChatActivity';
import WebSocket from 'ws';
import * as activities from '..';
import { TestWorkflowEnvironment, MockActivityEnvironment } from '@temporalio/testing';
import { Worker, Runtime, DefaultLogger, LogEntry } from '@temporalio/worker';
import { v4 as uuid4 } from 'uuid';
import { WorkflowCoverage } from '@temporalio/nyc-test-coverage';
import { getExporter, getResource, getTracer } from '../utils/instrumentation';
import './setup';

describe('StreamingChatActivity', () => {
  let wss: WebSocket.Server;
  let port: number;
  let host: string;
  let testActivityEnv: MockActivityEnvironment;
  let activity: StreamingChatActivity;

  beforeEach((done) => {
    wss = new WebSocket.Server({ port: 0 }, () => {
      const address = wss.address() as WebSocket.AddressInfo;
      port = address.port;
      host = 'localhost';
      done();
    });
    testActivityEnv = new MockActivityEnvironment({ attempt: 2 });
  }, 20000);

  afterEach((done) => {
    jest.clearAllMocks();
    wss.close(done);
  }, 20000);

  afterAll(async () => {
    await testActivityEnv.cancel();
    jest.clearAllTimers();
  }, 20000);

  async function runActivityWithMessage(messageSent: string, expectedMessage: string) {
    const receivedMessages: string[] = [];

    await new Promise((resolve, reject) => {
      wss.on('error', (error) => reject(error));
      wss.on('close', resolve);
      wss.on('connection', (ws) => {
        // ws.on('error', async (error) => {
        //   console.error(error);
        //   await ws.close();
        //   await wss.close();
        // });
        // ws.on('close', (code, number) => {
        //   wss.close((err) => (err ? reject(err) : resolve(true)));
        // });
        ws.on('message', (message) => {
          if (message.toString().length > 120) {
            console.log(message.toString().slice(0, 120) + '...');
          } else {
            console.log(message);
          }
          receivedMessages.push(message.toString());
          if (receivedMessages.join('') === expectedMessage) {
            // console.log(`Recieved the full message back, resolving...`);
            // console.log(receivedMessages.join(''));
            // resolve(true);
            ws.close();
            wss.close();
            resolve(true);
          }
        });
        ws.send(messageSent);
      });

      void testActivityEnv.run(async () => {
        activity = new StreamingChatActivity(host, port, uuid4());
        await activity.run();
      });
    });

    expect(receivedMessages.join('')).toEqual(expectedMessage);
  }

  it.skip('ChatTagProcessorWorkflow with mock activity', async () => {
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

  it.skip('should connect to the websocket server, and correctly process 1 tag', async () => {
    const messageSent = 'This is a test message that has <someTag>the content to change</someTag> in it!!!';
    const expectedMessage = 'This is a test message that has THE CONTENT TO CHANGE in it!!!';
    await runActivityWithMessage(messageSent, expectedMessage);
  }, 20000);

  it.skip('should connect to the websocket server, and correctly process 2 tags', async () => {
    const messageSent =
      'This is a test message that has <someTag>the content to change</someTag> in it with a second <second>tag</second> in it!!!';
    const expectedMessage = 'This is a test message that has THE CONTENT TO CHANGE in it with a second TAG in it!!!';
    await runActivityWithMessage(messageSent, expectedMessage);
  }, 20000);

  it.skip('should handle incomplete tags correctly', async () => {
    const messageSent = 'This is a test message with an <incomplete tag still open';
    const expectedMessage = 'This is a test message with an <incomplete tag still open';
    await runActivityWithMessage(messageSent, expectedMessage);
  }, 20000);

  it.skip('should handle non-tag content after an opening bracket', async () => {
    const messageSent = "This is a test message with a < that isn't a tag";
    const expectedMessage = "This is a test message with a < that isn't a tag";
    await runActivityWithMessage(messageSent, expectedMessage);
  }, 20000);

  it.skip('should handle multiple tags with nested structures', async () => {
    const messageSent = '<outer><inner>nested content</inner> more outer content</outer>';
    const expectedMessage = 'NESTED CONTENT X X X X';
    await runActivityWithMessage(messageSent, expectedMessage);
  }, 20000);

  it.skip('should handle large chunks of data efficiently', async () => {
    const largeData = 'x'.repeat(1000000); // 1 MB of data
    const messageSent = `<tag>${largeData}</tag>`;
    const expectedMessage = `<tag>${largeData.toUpperCase()}</tag>`;
    await runActivityWithMessage(messageSent, expectedMessage);
  }, 20000);

  it.skip('should close the connection properly on receiving a "close" signal', async () => {
    const spyClose = jest.fn();
    const wsClient = new WebSocket(`ws://${host}:${port}`);

    await global.sleep();

    wsClient.on('close', spyClose);
    wsClient.close();

    expect(spyClose).toHaveBeenCalled();
  });
});
