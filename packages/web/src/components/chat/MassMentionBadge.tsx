import React from 'react';
import { useTranslation } from 'react-i18next';
import type { MassMentionKeyword } from '@backspace/shared/src/mentions';
import { useSpaceStore } from '../../stores/spaceStore';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

type MassMentionBadgeProps =
  | { keyword: MassMentionKeyword; roleId?: undefined; channelId: string | null }
  | { roleId: string; keyword?: undefined; channelId: string | null };

/**
 * `@everyone`, `@here` or a role mention (`<@&id>`) as a label. These name a
 * group, not a person, so unlike `MentionBadge` there is no profile to open.
 * A role resolves among the roles of the channel's own space; a role this
 * client does not know there shows the unknown-role label.
 */
export const MassMentionBadge = React.memo(function MassMentionBadge({ keyword, roleId, channelId }: MassMentionBadgeProps) {
  const { t } = useTranslation('chat');
  const role = useSpaceStore((s) => {
    if (roleId === undefined || !channelId) return undefined;
    const spaceId = s.channelToSpaceMap.get(channelId);
    return spaceId === undefined ? undefined : s.roles.find((r) => r.id === roleId && r.spaceId === spaceId);
  });

  // `@everyone`, `@here` and a role without a colour take the interface's
  // accent; a role's own colour is data and goes inline; an unknown role is grey.
  let label: string;
  let roleColor: string | null = null;
  let tone = 'text-accent-soft bg-accent-primary/10';
  if (keyword !== undefined) {
    label = keyword;
  } else if (role) {
    // The @everyone role is stored with its "@" in the name.
    label = role.name.replace(/^@/, '');
    if (HEX_COLOR.test(role.color)) roleColor = role.color;
  } else {
    label = t('message.mention.unknownRole');
    tone = 'text-txt-tertiary bg-interactive-hover';
  }

  return (
    <span
      className={`inline-flex items-center rounded px-[2px] font-medium ${roleColor ? '' : tone}`}
      style={roleColor ? { color: roleColor, backgroundColor: `${roleColor}1a` } : undefined}
    >
      @{label}
    </span>
  );
});
