import { useMemo } from 'react';
import { useSocialStore } from '../stores/socialStore';
import { useActivityStore, activitiesFor } from '../stores/activityStore';
import { useVoiceStore } from '../stores/voiceStore';
import { useSpaceStore } from '../stores/spaceStore';
import { bucketFriends, voicePresenceByUser, type FriendBuckets } from '../utils/homeSummary';

/**
 * The user's friends sorted into who is on voice, who is doing something, who
 * is around and how many are offline. The Home page, the "Active now" column
 * and the phone's Activity tab read this one answer, so they never disagree
 * about who is where; none of them lists an offline friend.
 */
export function useFriendBuckets(): FriendBuckets {
  const friends = useSocialStore((s) => s.friends);
  const userActivities = useActivityStore((s) => s.userActivities);
  const voiceUsers = useVoiceStore((s) => s.voiceUsers);
  const channelIndex = useSpaceStore((s) => s.spaceChannelIndex);

  return useMemo(() => {
    const presence = voicePresenceByUser(voiceUsers, channelIndex);
    return bucketFriends(friends, presence, (friend) =>
      activitiesFor(userActivities, friend, friend._instanceOrigin),
    );
  }, [friends, userActivities, voiceUsers, channelIndex]);
}
