import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom has no AudioWorkletNode; the handler's imports reach the voice stack.
vi.mock('../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({
      setOutputDevice: vi.fn(),
      setVolume: vi.fn(),
      playSound: vi.fn(() => Promise.resolve(null)),
    }),
  },
}));

/** A socket the real handler talks to; the test plays the server through `deliver`. */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static all: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { FakeWebSocket.all.push(this); }
  send(data: string): void { this.sent.push(data); }
  close(): void { this.readyState = FakeWebSocket.CLOSED; }
  open(): void { this.readyState = FakeWebSocket.OPEN; this.onopen?.(); }
  deliver(event: Record<string, unknown>): void { this.onmessage?.({ data: JSON.stringify(event) }); }
}

/** The heartbeat runs in a Worker (jsdom has none); an inert one keeps it quiet. */
class InertWorker {
  onmessage: (() => void) | null = null;
  postMessage(): void {}
  terminate(): void {}
}

vi.stubGlobal('WebSocket', FakeWebSocket);
vi.stubGlobal('Worker', InertWorker);
vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:heartbeat', revokeObjectURL: () => {} }));

const { connectInstance, disconnectInstance } = await import('./useWebSocket');
const { useChatStore } = await import('../stores/chatStore');

const NOVA = 'https://nova.example';

function socket(): FakeWebSocket {
  const last = FakeWebSocket.all[FakeWebSocket.all.length - 1];
  if (!last) throw new Error('No socket was opened');
  return last;
}

beforeEach(() => {
  FakeWebSocket.all = [];
  connectInstance(NOVA, 'token');
  socket().open();
});

afterEach(() => {
  disconnectInstance(NOVA);
});

describe('several events in one frame', () => {
  it('says at auth that it reads them', () => {
    expect(JSON.parse(socket().sent[0] ?? '{}')).toEqual(expect.objectContaining({ type: 'auth', batch: true }));
  });

  it('handles each of them, as if they had come alone', () => {
    const spy = vi.spyOn(useChatStore.getState(), 'setTyping');
    socket().deliver({
      type: 'batch',
      events: [
        { type: 'typing', channelId: 'one', userId: 'u1', username: 'anna' },
        { type: 'typing', channelId: 'two', userId: 'u2', username: 'ben' },
      ],
    });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls.map(([channelId]) => channelId)).toEqual(['one', 'two']);
    spy.mockRestore();
  });

  it('still handles one that came alone', () => {
    const spy = vi.spyOn(useChatStore.getState(), 'setTyping');
    socket().deliver({ type: 'typing', channelId: 'one', userId: 'u1', username: 'anna' });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('goes on past one it cannot handle', () => {
    const spy = vi.spyOn(useChatStore.getState(), 'setTyping');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    spy.mockImplementationOnce(() => { throw new Error('broken'); });
    socket().deliver({
      type: 'batch',
      events: [
        { type: 'typing', channelId: 'one', userId: 'u1', username: 'anna' },
        { type: 'typing', channelId: 'two', userId: 'u2', username: 'ben' },
      ],
    });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
    spy.mockRestore();
  });
});

describe('knocking again after losing the connection', () => {
  it('spreads people out, between half the delay and the whole of it', () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random');
    try {
      random.mockReturnValue(0);
      const before = FakeWebSocket.all.length;
      socket().onclose?.();
      vi.advanceTimersByTime(499);
      expect(FakeWebSocket.all.length).toBe(before);
      vi.advanceTimersByTime(2);
      expect(FakeWebSocket.all.length).toBe(before + 1);
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });
});
