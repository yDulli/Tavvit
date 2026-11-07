import { useTranslation } from 'react-i18next';
import type { User } from '@backspace/shared';
import { useSpaceStore } from '../../stores/spaceStore';
import type { TaggedFriend } from '../../stores/socialStore';
import { presenceLabel } from '../../i18n/presence';
import { replaceEmojiShortcodes, useEmojiShortcodeNames } from '../../utils/emojiShortcodes';
import type { HomeFriend } from '../../utils/homeSummary';

/**
 * What the friends views (the Home page, the "Active now" column, the phone's
 * Activity tab) say about one online friend, and the profile card they open.
 * Shared so the three never describe the same person differently.
 */

/** What an online friend is doing, in words. */
export interface FriendDoing {
  /** One line: on voice and where, the activity they share, their status, or their presence. */
  line: string;
  /** The activity's details (a game's map, a song's album), or null. */
  detail: string | null;
  /** On voice or sharing an activity: the line says more than "online". */
  busy: boolean;
}

/**
 * What `row` is doing, said in words rather than shown by a colour: on a
 * voice channel and in which space, the activity they share (playing,
 * listening, watching, streaming), the status line they wrote, or else their
 * presence. `person` is the canonical view of the friend, so the status reads
 * the freshest row.
 */
export function useFriendDoing(row: HomeFriend, person: Pick<User, 'status' | 'customStatus'>): FriendDoing {
  const { t } = useTranslation(['home', 'common']);
  useEmojiShortcodeNames();
  const voice = row.voice;
  const voiceSpaceName = useSpaceStore((s) => {
    if (!voice) return null;
    return s.spaces.find((space) => space.id === voice.spaceId && (space._instanceOrigin ?? '') === voice.origin)?.name ?? null;
  });

  if (voice) {
    return {
      line: voiceSpaceName ? t('home:voice.status', { space: voiceSpaceName }) : t('home:online.inVoice'),
      detail: null,
      busy: true,
    };
  }
  const activity = row.activity;
  if (activity && activity.source === 'twitch') {
    // Live on Twitch, as their home found it; the line below is what the stream is called.
    return { line: t('common:activity.liveOnTwitch'), detail: activity.name, busy: true };
  }
  if (activity && activity.type !== 'custom') {
    return {
      line: t(`common:activity.line.${activity.type}`, { name: activity.name }),
      detail: activity.details ?? null,
      busy: true,
    };
  }
  const status = activity?.name || person.customStatus;
  if (status) return { line: replaceEmojiShortcodes(status), detail: null, busy: false };
  return { line: presenceLabel(t, person.status), detail: null, busy: false };
}

/**
 * A friend row as the profile card takes it: the fields the row carries, as
 * the instance that listed it issued them (`friend._instanceOrigin` goes to
 * the card beside it).
 */
export function friendProfileUser(friend: TaggedFriend): User {
  return {
    id: friend.id,
    username: friend.username,
    displayName: friend.displayName,
    avatar: friend.avatar,
    banner: friend.banner,
    accentColor: friend.accentColor,
    avatarColor: friend.avatarColor,
    bio: friend.bio,
    status: friend.status,
    customStatus: friend.customStatus,
    createdAt: friend.createdAt,
    homeUserId: friend.homeUserId,
    homeInstance: friend.homeInstance,
    isAdmin: false,
    replicatedInstances: [],
  };
}
