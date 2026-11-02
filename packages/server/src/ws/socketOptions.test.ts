import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { WS_MAX_CLIENT_FRAME_BYTES } from '@backspace/shared/src/constants.js';
import { WEBSOCKET_OPTIONS } from './socketOptions.js';

let app: FastifyInstance | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
});

describe('the socket server', () => {
  it('closes a socket that sends a larger frame than a client ever needs, before anyone signed in', async () => {
    app = Fastify({ logger: false });
    await app.register(websocket, WEBSOCKET_OPTIONS);
    const received: number[] = [];
    await app.register(async (scope) => {
      scope.get('/ws', { websocket: true }, (socket) => {
        socket.on('message', (data: Buffer) => { received.push(data.length); });
      });
    });
    await app.ready();

    const client = await app.injectWS('/ws');
    const closed = new Promise<number>((resolve) => { client.on('close', (code: number) => resolve(code)); });
    client.send('x'.repeat(WS_MAX_CLIENT_FRAME_BYTES));
    client.send('x'.repeat(WS_MAX_CLIENT_FRAME_BYTES + 1));

    expect(await closed).toBe(1009);
    expect(received).toEqual([WS_MAX_CLIENT_FRAME_BYTES]);
  });
});
