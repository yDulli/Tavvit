import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';

// Adding a socket touches no table; the module only needs a database to exist.
vi.mock('../db/index.js', async () => {
  const { default: Database } = await import('better-sqlite3');
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('../db/schema.js');
  const sqlite = new Database(':memory:');
  return { getDb: () => drizzle(sqlite, { schema }), getRawDb: () => sqlite, schema };
});

const { connectionManager } = await import('./handler.js');

interface FakeSocket {
  readyState: number;
  sent: Array<{ type: string; code?: string }>;
  closedWith: number | null;
  send: (raw: string) => void;
  close: (code: number) => void;
}

function fakeSocket(): FakeSocket {
  const socket: FakeSocket = {
    readyState: 1,
    sent: [],
    closedWith: null,
    send: (raw) => { socket.sent.push(JSON.parse(raw) as { type: string; code?: string }); },
    close: (code) => { socket.closedWith = code; socket.readyState = 3; },
  };
  return socket;
}

describe('the sockets of one account', () => {
  it('stay at ten: the oldest goes, told why, so it does not come straight back', () => {
    const sockets = Array.from({ length: 11 }, fakeSocket);
    for (const socket of sockets) connectionManager.addConnection('socket-limit-user', socket as unknown as WebSocket);

    expect(connectionManager.getUserConnections('socket-limit-user').size).toBe(10);
    expect(sockets[0]?.closedWith).not.toBeNull();
    expect(sockets[0]?.sent).toEqual([expect.objectContaining({ type: 'error', code: 'too_many_connections' })]);
    expect(sockets.slice(1).every((socket) => socket.closedWith === null)).toBe(true);
  });
});
