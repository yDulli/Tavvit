import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { BadgeId, BadgeTone } from '@backspace/shared/src/badges';

/** A badge's name and what it means, in the reader's language. */
export interface BadgeText {
  name: string;
  description: string;
}

/** The text colour of each badge tone (docs/systems/design-system.md: the accent family, violet sparingly). */
export const BADGE_TONE_CLASS: Record<BadgeTone, string> = {
  neutral: 'text-txt-secondary',
  violet: 'text-accent-soft',
  amber: 'text-accent-amber',
  sky: 'text-accent-sky',
  mint: 'text-accent-mint',
};

/** Every badge's name and description, by id. */
export function useBadgeText(): Record<BadgeId, BadgeText> {
  const { t } = useTranslation(['common']);
  return useMemo(() => ({
    staff: { name: t('common:badges.staff.name'), description: t('common:badges.staff.description') },
    bot: { name: t('common:badges.bot.name'), description: t('common:badges.bot.description') },
    server_owner: { name: t('common:badges.server_owner.name'), description: t('common:badges.server_owner.description') },
    administrator: { name: t('common:badges.administrator.name'), description: t('common:badges.administrator.description') },
    moderator: { name: t('common:badges.moderator.name'), description: t('common:badges.moderator.description') },
    helper: { name: t('common:badges.helper.name'), description: t('common:badges.helper.description') },
    founder: { name: t('common:badges.founder.name'), description: t('common:badges.founder.description') },
    early_supporter: { name: t('common:badges.early_supporter.name'), description: t('common:badges.early_supporter.description') },
    bug_hunter: { name: t('common:badges.bug_hunter.name'), description: t('common:badges.bug_hunter.description') },
    developer: { name: t('common:badges.developer.name'), description: t('common:badges.developer.description') },
    creator: { name: t('common:badges.creator.name'), description: t('common:badges.creator.description') },
    event_participant: { name: t('common:badges.event_participant.name'), description: t('common:badges.event_participant.description') },
    community_contributor: { name: t('common:badges.community_contributor.name'), description: t('common:badges.community_contributor.description') },
    beta_tester: { name: t('common:badges.beta_tester.name'), description: t('common:badges.beta_tester.description') },
    verified: { name: t('common:badges.verified.name'), description: t('common:badges.verified.description') },
    partner: { name: t('common:badges.partner.name'), description: t('common:badges.partner.description') },
  }), [t]);
}
