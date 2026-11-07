import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../hooks/useWebSocket', () => ({
  wsSend: vi.fn(),
  wsSendAll: vi.fn(),
}));

// Stub AudioManager to avoid AudioWorkletNode reference error in jsdom
vi.mock('../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({
      setOutputDevice: vi.fn(),
      setVolume: vi.fn(),
    }),
  },
}));

vi.mock('./instanceStore', () => ({
  useInstanceStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector({ instances: [], _autoConnectDone: true }),
    {
      getState: () => ({ instances: [], _autoConnectDone: true }),
      setState: vi.fn(),
      subscribe: vi.fn(),
    }
  ),
}));

vi.mock('./authStore', () => ({
  useAuthStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector({ user: null, token: null }),
    {
      getState: () => ({ user: null, token: null }),
      setState: vi.fn(),
      subscribe: vi.fn(),
    }
  ),
}));

import { useChatStore } from './chatStore';
import type { MessageWithUser } from '@backspace/shared';

// Leaving a channel (docs/systems/message-list.md, "Position memory"): one left at its newest
// message keeps only its newest page, so coming back draws 50 rows rather than up to 200.

function msg(index: number): MessageWithUser {
  return {
    id: String(1000 + index),
    channelId: 'c1',
    userId: 'u1',
    content: `message ${index}`,
    createdAt: index,
    editedAt: null,
    user: { id: 'u1', username: 'u1', displayName: 'U', createdAt: 0, status: 'online' },
    reactions: [],
    attachments: [],
  } as unknown as MessageWithUser;
}

function hold(count: number): void {
  const messages = new Map(useChatStore.getState().messages);
  messages.set('c1', Array.from({ length: count }, (_, index) => msg(index)));
  const hasMore = new Map(useChatStore.getState().hasMore);
  hasMore.set('c1', false);
  useChatStore.setState({ messages, hasMore, detachedChannels: new Map() });
}

beforeEach(() => {
  useChatStore.setState({ messages: new Map(), hasMore: new Map(), scrollPositions: new Map(), detachedChannels: new Map() });
});

describe('leaving a channel', () => {
  it('keeps only the newest page of a channel left at its newest message, and pages back from there', () => {
    hold(200);
    useChatStore.getState().saveScrollPosition('c1', { kind: 'bottom' });
    const kept = useChatStore.getState().messages.get('c1')!;
    expect(kept).toHaveLength(50);
    expect(kept[0]!.id).toBe('1150');
    expect(kept[49]!.id).toBe('1199');
    expect(useChatStore.getState().hasMore.get('c1')).toBe(true);
    expect(useChatStore.getState().scrollPositions.get('c1')).toEqual({ kind: 'bottom' });
  });

  it('keeps everything of a channel left somewhere older, so the view comes back there', () => {
    hold(200);
    const anchor = { kind: 'message' as const, messageId: '1040', offsetPx: -12 };
    useChatStore.getState().saveScrollPosition('c1', anchor);
    expect(useChatStore.getState().messages.get('c1')).toHaveLength(200);
    expect(useChatStore.getState().hasMore.get('c1')).toBe(false);
    expect(useChatStore.getState().scrollPositions.get('c1')).toEqual(anchor);
  });

  it('keeps a detached window whole, and a channel that holds one page or less as it is', () => {
    hold(200);
    useChatStore.setState({ detachedChannels: new Map([['c1', []]]) });
    useChatStore.getState().saveScrollPosition('c1', { kind: 'bottom' });
    expect(useChatStore.getState().messages.get('c1')).toHaveLength(200);

    hold(30);
    const before = useChatStore.getState().messages;
    useChatStore.getState().saveScrollPosition('c1', { kind: 'bottom' });
    expect(useChatStore.getState().messages).toBe(before);
    expect(useChatStore.getState().hasMore.get('c1')).toBe(false);
  });
});
