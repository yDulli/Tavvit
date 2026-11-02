/**
 * What the Home dashboard shows about the people the user knows: who is on a
 * voice channel right now, who is doing something, who is just around.
 *
 * Pure functions over the client's stores, so the page and the mobile messages
 * screen read one answer and a test can state it without rendering anything.
 *
 * A row id names a person only on the instance that issued it, and so does a
 * voice participant id. A friend is therefore matched with a voice channel only
 * when the friend's row and the channel come from the same instance. A friend
 * who is in a space on a different instance is still shown as online; they are
 * just not listed under "in voice" until the identities of the two instances
 * are known to be one person.
 */
import type { Activity, DmChannel } from '@backspace/shared';
import { getPrimaryActivity } from '@backspace/shared/src/activities.js';
import type { TaggedFriend } from '../stores/socialStore';
import type { SpaceChannelIndex } from '../stores/spaceChannels';

/** Where a person is connected to voice. */
export interface VoicePresence {
  spaceId: string;
  channelId: string;
  /** The instance that issued both ids; '' is the page's own. */
  origin: string;
}

export interface HomeFriend {
  friend: TaggedFriend;
  /** The activity the friend is most visibly doing, or null. */
  activity: Activity | null;
  voice: VoicePresence | null;
}

export interface FriendBuckets {
  /** Online friends on a voice channel. */
  inVoice: HomeFriend[];
  /** Online friends doing something (playing, listening, watching, streaming). */
  active: HomeFriend[];
  /** Online friends doing nothing in particular. */
  around: HomeFriend[];
  /** Friends who are not online; they are counted, not listed. */
  offline: number;
}

export interface VoiceGroup {
  spaceId: string;
  channelId: string;
  origin: string;
  friends: HomeFriend[];
}

const KEY_SEPARATOR = '\u0000';

function voiceKey(origin: string, userId: string): string {
  return `${origin}${KEY_SEPARATOR}${userId}`;
}

/**
 * Where every person on a voice channel is, keyed by instance and row id. A
 * person on two channels (two instances) keeps the first one found.
 */
export function voicePresenceByUser(
  voiceUsers: ReadonlyMap<string, readonly string[]>,
  index: SpaceChannelIndex,
): Map<string, VoicePresence> {
  const presence = new Map<string, VoicePresence>();
  for (const [channelId, userIds] of voiceUsers) {
    const entry = index.get(channelId);
    if (!entry || entry.type !== 'voice') continue;
    for (const userId of userIds) {
      const key = voiceKey(entry.origin, userId);
      if (!presence.has(key)) presence.set(key, { spaceId: entry.spaceId, channelId, origin: entry.origin });
    }
  }
  return presence;
}

/** A stable key for one friend row: the instance that listed it and its id there. */
export function friendRowKey(friend: Pick<TaggedFriend, 'id' | '_instanceOrigin'>): string {
  return voiceKey(friend._instanceOrigin, friend.id);
}

/** Where `friend` is on voice, or null. Matches by the friend's instance and row id. */
export function voicePresenceOf(
  presence: ReadonlyMap<string, VoicePresence>,
  friend: Pick<TaggedFriend, 'id' | '_instanceOrigin'>,
): VoicePresence | null {
  return presence.get(voiceKey(friend._instanceOrigin, friend.id)) ?? null;
}

function displayKey(friend: TaggedFriend): string {
  return (friend.displayName ?? friend.username).toLocaleLowerCase();
}

/** Sort key for a stable, readable list: by name, then id so equal names keep their place. */
function byName(a: HomeFriend, b: HomeFriend): number {
  const nameOrder = displayKey(a.friend).localeCompare(displayKey(b.friend));
  return nameOrder !== 0 ? nameOrder : a.friend.id.localeCompare(b.friend.id);
}

/**
 * Sort `friends` into the groups the dashboard shows. `activitiesOf` reads a
 * friend's activities from the activity store (kept out of here so this module
 * does not import a store that opens a socket).
 */
export function bucketFriends(
  friends: readonly TaggedFriend[],
  presence: ReadonlyMap<string, VoicePresence>,
  activitiesOf: (friend: TaggedFriend) => Activity[],
): FriendBuckets {
  const buckets: FriendBuckets = { inVoice: [], active: [], around: [], offline: 0 };
  for (const friend of friends) {
    if (friend.status === 'offline') {
      buckets.offline += 1;
      continue;
    }
    const primary = getPrimaryActivity(activitiesOf(friend));
    const voice = voicePresenceOf(presence, friend);
    const row: HomeFriend = { friend, activity: primary, voice };
    if (voice) buckets.inVoice.push(row);
    else if (primary && primary.type !== 'custom') buckets.active.push(row);
    else buckets.around.push(row);
  }
  buckets.inVoice.sort(byName);
  buckets.active.sort(byName);
  buckets.around.sort(byName);
  return buckets;
}

/** The people on voice, one group per channel, the busiest channel first. */
export function groupByVoiceChannel(inVoice: readonly HomeFriend[]): VoiceGroup[] {
  const groups = new Map<string, VoiceGroup>();
  for (const row of inVoice) {
    if (!row.voice) continue;
    const key = voiceKey(row.voice.origin, row.voice.channelId);
    let group = groups.get(key);
    if (!group) {
      group = { spaceId: row.voice.spaceId, channelId: row.voice.channelId, origin: row.voice.origin, friends: [] };
      groups.set(key, group);
    }
    group.friends.push(row);
  }
  return [...groups.values()].sort(
    (a, b) => b.friends.length - a.friends.length || a.channelId.localeCompare(b.channelId),
  );
}

/**
 * The conversations with something unread, newest first. The conversation that
 * is open is read by definition and never listed.
 */
export function unreadConversations(
  dmChannels: readonly DmChannel[],
  unreadChannels: ReadonlySet<string>,
  openChannelId: string | null,
  limit: number,
): DmChannel[] {
  return dmChannels
    .filter((dm) => unreadChannels.has(dm.id) && dm.id !== openChannelId)
    .sort((a, b) => (b.lastMessage?.createdAt ?? b.createdAt) - (a.lastMessage?.createdAt ?? a.createdAt))
    .slice(0, limit);
}

/** The part of the day a greeting is for. */
export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';

export function dayPartOf(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 23) return 'evening';
  return 'night';
}
