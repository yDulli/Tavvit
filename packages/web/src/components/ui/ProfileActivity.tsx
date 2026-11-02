import { useTranslation } from 'react-i18next';
import { activitiesFor, useActivityStore } from '../../stores/activityStore';
import type { PresenceSubject } from '../../utils/identity';
import { ActivityCard } from './ActivityCard';

/**
 * What a person is doing now, on their profile card and their full profile:
 * the game the desktop app detected, or another rich activity, the way the
 * member list shows it (docs/systems/activity-presence.md). One's own
 * profile shows what this client reports; anyone else's what their instance
 * relayed. Nothing at all without a rich activity; a custom status is shown
 * by the profile itself.
 */
export function ProfileActivity({ subject, origin, isSelf }: { subject: PresenceSubject; origin: string; isSelf: boolean }) {
  const { t } = useTranslation(['social']);
  const mine = useActivityStore((s) => s.myActivities);
  const userActivities = useActivityStore((s) => s.userActivities);
  const activities = isSelf && mine ? mine : activitiesFor(userActivities, subject, origin);
  if (!activities.some((activity) => activity.type !== 'custom')) return null;
  return (
    <div className="surface-card mt-2 rounded-lg px-2.5 py-2">
      <div className="label-mono mb-0.5">{t('social:profile.activity')}</div>
      <ActivityCard activities={activities} />
    </div>
  );
}
