import WebSocket from 'ws';
import { Readable, Writable, pipeline } from 'stream';

export class WritableWebSocketStream extends Writable {
  constructor(private ws: WebSocket) {
    super();
  }
  _write(chunk: any, encoding: string, callback: (error?: Error | null) => void) {
    this.ws.send(chunk, callback);
  }
}