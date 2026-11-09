import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { badgeDefinition, type BadgeCategory, type BadgeId } from '@backspace/shared/src/badges';

/** A badge's name, what it means and the kind of thing it says, in the reader's language. */
export interface BadgeText {
  name: string;
  description: string;
  /** Its category (`BadgeDefinition.category`), named. */
  category: string;
}

/** Every badge category's name. */
export function useBadgeCategoryNames(): Record<BadgeCategory, string> {
  const { t } = useTranslation(['common']);
  return useMemo(() => ({
    platform: t('common:badges.categories.platform'),
    space: t('common:badges.categories.space'),
    community: t('common:badges.categories.community'),
    building: t('common:badges.categories.building'),
    early: t('common:badges.categories.early'),
  }), [t]);
}

/** Every badge's name, description and category, by id. */
export function useBadgeText(): Record<BadgeId, BadgeText> {
  const { t } = useTranslation(['common']);
  const categories = useBadgeCategoryNames();
  return useMemo(() => {
    const named: Record<BadgeId, Omit<BadgeText, 'category'>> = {
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
    };
    const withCategory = {} as Record<BadgeId, BadgeText>;
    for (const id of Object.keys(named) as BadgeId[]) {
      const category = badgeDefinition(id)?.category;
      withCategory[id] = { ...named[id], category: category ? categories[category] : '' };
    }
    return withCategory;
  }, [t, categories]);
}
