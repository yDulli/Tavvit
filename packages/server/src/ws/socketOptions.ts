import type { WebsocketPluginOptions } from '@fastify/websocket';
import { WS_MAX_CLIENT_FRAME_BYTES } from '@backspace/shared/src/constants.js';

/**
 * How the socket server is set up (docs/systems/websocket.md, "Frame size").
 *
 * `maxPayload`: without it `ws` takes frames of up to 100 MiB from anyone who opens a socket,
 * before they have signed in, and with compression on a frame of a few kilobytes unpacks to that.
 * The limit holds for the unpacked size.
 *
 * Compression: a large `ready` goes compressed. It is mostly the same few words over and over,
 * and someone on a phone waits for all of it. Nothing small is, so a message costs what it did
 * (docs/systems/operations.md).
 */
export const WEBSOCKET_OPTIONS: WebsocketPluginOptions = {
  options: {
    maxPayload: WS_MAX_CLIENT_FRAME_BYTES,
    perMessageDeflate: {
      threshold: 32 * 1024,
      serverNoContextTakeover: true,
      clientNoContextTakeover: true,
      zlibDeflateOptions: { level: 3 },
    },
  },
};
