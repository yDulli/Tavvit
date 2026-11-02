import { describe, it, expect } from 'vitest';
import type { Activity, DmChannel } from '@backspace/shared';
import type { TaggedFriend } from '../stores/socialStore';
import type { SpaceChannelIndex } from '../stores/spaceChannels';
import {
  bucketFriends,
  dayPartOf,
  groupByVoiceChannel,
  unreadConversations,
  voicePresenceByUser,
} from './homeSummary';

function friend(id: string, over: Partial<TaggedFriend> = {}): TaggedFriend {
  return {
    id,
    username: `user-${id}`,
    displayName: null,
    avatar: null,
    banner: null,
    accentColor: null,
    avatarColor: null,
    bio: null,
    status: 'online',
    customStatus: null,
    createdAt: 0,
    addedAt: 0,
    homeUserId: null,
    homeInstance: null,
    _instanceOrigin: '',
    ...over,
  };
}

function activity(type: Activity['type'], name = 'Thing'): Activity {
  return { type, name } as Activity;
}

const INDEX: SpaceChannelIndex = new Map([
  ['voice-1', { spaceId: 'space-a', origin: '', type: 'voice' as const }],
  ['voice-2', { spaceId: 'space-b', origin: '', type: 'voice' as const }],
  ['text-1', { spaceId: 'space-a', origin: '', type: 'text' as const }],
  ['voice-remote', { spaceId: 'space-r', origin: 'https://other.example', type: 'voice' as const }],
]);

describe('voicePresenceByUser', () => {
  it('maps users on voice channels to where they are', () => {
    const presence = voicePresenceByUser(new Map([['voice-1', ['u1', 'u2']]]), INDEX);
    expect(presence.size).toBe(2);
    expect([...presence.values()][0]).toEqual({ spaceId: 'space-a', channelId: 'voice-1', origin: '' });
  });

  it('ignores channels that are not voice channels or not in the index', () => {
    const presence = voicePresenceByUser(new Map([['text-1', ['u1']], ['ghost', ['u2']]]), INDEX);
    expect(presence.size).toBe(0);
  });
});

describe('bucketFriends', () => {
  const none = () => [] as Activity[];

  it('counts offline friends without listing them', () => {
    const result = bucketFriends([friend('1', { status: 'offline' }), friend('2')], new Map(), none);
    expect(result.offline).toBe(1);
    expect(result.around.map((r) => r.friend.id)).toEqual(['2']);
  });

  it('puts a friend on voice under inVoice, ahead of any activity', () => {
    const presence = voicePresenceByUser(new Map([['voice-1', ['1']]]), INDEX);
    const result = bucketFriends([friend('1')], presence, () => [activity('playing')]);
    expect(result.inVoice.map((r) => r.friend.id)).toEqual(['1']);
    expect(result.active).toEqual([]);
    expect(result.inVoice[0]!.voice?.spaceId).toBe('space-a');
  });

  it('treats a custom status as being around, and a game as active', () => {
    const activities: Record<string, Activity[]> = {
      '1': [activity('custom')],
      '2': [activity('playing', 'Chess')],
    };
    const result = bucketFriends([friend('1'), friend('2')], new Map(), (f) => activities[f.id] ?? []);
    expect(result.around.map((r) => r.friend.id)).toEqual(['1']);
    expect(result.active.map((r) => r.friend.id)).toEqual(['2']);
    expect(result.active[0]!.activity?.name).toBe('Chess');
  });

  it('does not match a friend with a voice channel of another instance', () => {
    const presence = voicePresenceByUser(new Map([['voice-remote', ['1']]]), INDEX);
    const result = bucketFriends([friend('1', { _instanceOrigin: '' })], presence, none);
    expect(result.inVoice).toEqual([]);
    expect(result.around).toHaveLength(1);
  });

  it('matches by instance as well as by id', () => {
    const presence = voicePresenceByUser(new Map([['voice-remote', ['1']]]), INDEX);
    const result = bucketFriends([friend('1', { _instanceOrigin: 'https://other.example' })], presence, none);
    expect(result.inVoice).toHaveLength(1);
  });

  it('sorts each group by display name, then id', () => {
    const result = bucketFriends(
      [friend('3', { displayName: 'Zed' }), friend('1', { displayName: 'amy' }), friend('2', { displayName: 'Amy' })],
      new Map(),
      none,
    );
    expect(result.around.map((r) => r.friend.id)).toEqual(['1', '2', '3']);
  });
});

describe('groupByVoiceChannel', () => {
  it('groups friends by channel and lists the busiest channel first', () => {
    const presence = voicePresenceByUser(new Map([['voice-1', ['1']], ['voice-2', ['2', '3']]]), INDEX);
    const { inVoice } = bucketFriends([friend('1'), friend('2'), friend('3')], presence, () => []);
    const groups = groupByVoiceChannel(inVoice);
    expect(groups.map((g) => g.channelId)).toEqual(['voice-2', 'voice-1']);
    expect(groups[0]!.friends.map((r) => r.friend.id)).toEqual(['2', '3']);
  });
});

describe('unreadConversations', () => {
  function dm(id: string, at: number): DmChannel {
    return { id, createdAt: at, lastMessage: null } as unknown as DmChannel;
  }

  it('lists unread conversations, newest first, without the open one', () => {
    const dms = [dm('a', 1), dm('b', 3), dm('c', 2), dm('d', 4)];
    const result = unreadConversations(dms, new Set(['a', 'b', 'c', 'd']), 'd', 10);
    expect(result.map((d) => d.id)).toEqual(['b', 'c', 'a']);
  });

  it('skips conversations that are read and honours the limit', () => {
    const dms = [dm('a', 1), dm('b', 3), dm('c', 2)];
    expect(unreadConversations(dms, new Set(['a', 'c']), null, 10).map((d) => d.id)).toEqual(['c', 'a']);
    expect(unreadConversations(dms, new Set(['a', 'b', 'c']), null, 1).map((d) => d.id)).toEqual(['b']);
  });

  it('sorts by the last message when there is one', () => {
    const early = { id: 'x', createdAt: 100, lastMessage: { createdAt: 10 } } as unknown as DmChannel;
    const late = { id: 'y', createdAt: 1, lastMessage: { createdAt: 50 } } as unknown as DmChannel;
    expect(unreadConversations([early, late], new Set(['x', 'y']), null, 5).map((d) => d.id)).toEqual(['y', 'x']);
  });
});

describe('dayPartOf', () => {
  it.each([
    [4, 'night'],
    [5, 'morning'],
    [11, 'morning'],
    [12, 'afternoon'],
    [17, 'afternoon'],
    [18, 'evening'],
    [22, 'evening'],
    [23, 'night'],
    [0, 'night'],
  ])('hour %i is %s', (hour, part) => {
    expect(dayPartOf(hour)).toBe(part);
  });
});
