// import { Request, Response } from 'express';
import { WebSocket, Server as WebSocketServer } from 'ws';
import { WorkflowClient } from '@temporalio/client';
import { pipeline, Transform } from 'stream';

export function WebSocketHandler(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
  const originalMethod = descriptor.value;

  descriptor.value = async function (req: any, res: any) {
    const wssPort = 8080; // Dynamic port allocation can be added.
    const wssHost = '127.0.0.1'; // Internal network host.
    const sessionId = req.query.sessionId as string;

    // Start a new WebSocket Server for internal communication
    const wss = new WebSocketServer({ port: wssPort });
    console.log(`Internal WSS server started on ws://${wssHost}:${wssPort}`);

    // Upgrade HTTP connection to WebSocket
    if (req.headers.upgrade?.toLowerCase() !== 'websocket') {
      res.status(426).send('Upgrade Required');
      return;
    }

    req.ws((ws: any) => {
      console.log('WebSocket connection upgraded successfully');

      // Initialize the Temporal Workflow Client
      const client = new WorkflowClient();

      // Start the StreamingChatWorkflow
      client
        .start(`StreamingChatWorkflow`, {
          taskQueue: 'chat-queue',
          workflowId: `streaming-chat-${sessionId}`,
          args: [wssHost, wssPort, sessionId]
        })
        .then(() => {
          console.log(`StreamingChatWorkflow started with ID: streaming-chat-${sessionId}`);
        })
        .catch((error) => {
          console.error(`Failed to start workflow: ${error.message}`);
        });

      // Create a Transform stream for processing messages
      const messageTransform = new Transform({
        transform(chunk, encoding, callback) {
          // Relay the incoming message to the internal WebSocket server
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(chunk.toString());
            }
          });
          callback();
        }
      });

      // Pipe messages from the WebSocket to the internal WSS
      pipeline(ws, messageTransform, (err) => {
        if (err) {
          console.error('Pipeline failed:', err);
        } else {
          console.log('Pipeline succeeded.');
        }
      });

      // Cleanup on WebSocket close
      ws.on('close', () => {
        console.log('WebSocket connection closed');
        wss.clients.forEach((client) => {
          client.close();
        });
      });
    });

    // Call the original method after setting up the WebSocket
    await originalMethod.apply(this, [req, res]);
  };

  return descriptor;
}
