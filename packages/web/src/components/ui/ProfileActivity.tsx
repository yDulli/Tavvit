import { useTranslation } from 'react-i18next';
import { getPrimaryActivity } from '@backspace/shared/src/activities.js';
import { twitchStreamOf } from '@backspace/shared/src/twitch';
import { activitiesFor, useActivityStore } from '../../stores/activityStore';
import type { PresenceSubject } from '../../utils/identity';
import { ActivityCard } from './ActivityCard';
import { Icon } from './Icon';

/**
 * What a person is doing now, on their profile card and their full profile:
 * the game the desktop app detected, a stream their home found live on
 * Twitch, or another rich activity, the way the member list shows it
 * (docs/systems/activity-presence.md). One's own profile shows what this
 * client reports, at once, beside what the home found itself; anyone else's
 * what their instance relayed. A live stream comes with the way to it.
 * Nothing at all without a rich activity; a custom status is shown by the
 * profile itself.
 */
export function ProfileActivity({ subject, origin, isSelf }: { subject: PresenceSubject; origin: string; isSelf: boolean }) {
  const { t } = useTranslation(['social']);
  const mine = useActivityStore((s) => s.myActivities);
  const userActivities = useActivityStore((s) => s.userActivities);
  const held = activitiesFor(userActivities, subject, origin);
  const activities = isSelf && mine ? [...held.filter((activity) => activity.source !== undefined), ...mine] : held;
  if (!activities.some((activity) => activity.type !== 'custom')) return null;
  const stream = twitchStreamOf(getPrimaryActivity(activities));
  return (
    <div className="surface-card mt-2 rounded-lg px-2.5 py-2">
      <div className="label-mono mb-0.5">{t('social:profile.activity')}</div>
      <ActivityCard activities={activities} />
      {stream && (
        <a
          href={stream}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="btn-outline btn-sm mt-2 w-full"
        >
          <Icon name="external" size={14} />
          {t('social:profile.watchOnTwitch')}
        </a>
      )}
    </div>
  );
}
