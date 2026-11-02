import React from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';
import { menuPositionFor, useContextMenuStore, type ContextMenuItem } from '../../stores/contextMenuStore';
import { insertComposerMention } from './useComposerMention';
import { useChannelUser } from '../../utils/channelUser';
import { spaceMemberName } from '../../utils/identity';


interface MentionBadgeProps {
  userId: string;
  /**
   * The channel the mention was written in. A `<@id>` token carries an id on
   * that channel's origin and names one of that channel's people, so it is
   * resolved there (`utils/channelUser`). Null outside a channel: the badge
   * cannot resolve and shows the unknown-user label.
   */
  channelId: string | null;
  /**
   * The name to show when the channel's people are not at hand: the inbox reads
   * messages of spaces whose member lists were not loaded, and the server names
   * the mentioned people there (`MentionItem.mentionedNames`).
   */
  fallbackName?: string;
  /**
   * False inside another control (a reply preview is a jump button): the badge
   * keeps its look but is plain text, so it neither opens a profile nor nests
   * interactive content in that control.
   */
  interactive?: boolean;
}

export const MentionBadge = React.memo(function MentionBadge({ userId, channelId, fallbackName, interactive = true }: MentionBadgeProps) {
  const { t } = useTranslation(['chat', 'spaces', 'common']);
  const openUserProfile = useUIStore((s) => s.openUserProfile);
  const resolved = useChannelUser(channelId, userId);

  const displayName = resolved ? spaceMemberName(resolved.member, resolved.user) : (fallbackName ?? t('message.mention.unknownUser'));
  // A role colour (or the owner's rose) tints the badge; without one it takes
  // the interface's accent, and an unplaceable mention stays grey. The role
  // colour is data, so it is inline; the rest are theme tokens.
  const roleColor = resolved?.nameColor ?? null;
  const toneClass = roleColor ? '' : resolved || fallbackName ? 'text-accent-soft bg-accent-primary/10' : 'text-txt-tertiary bg-interactive-hover';
  const toneStyle: React.CSSProperties | undefined = roleColor ? { color: roleColor, backgroundColor: `${roleColor}1a` } : undefined;

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!resolved) return;
    e.stopPropagation();
    const memberContext = resolved.member
      ? { spaceId: resolved.member.spaceId, userId: resolved.member.userId }
      : undefined;
    openUserProfile(resolved.user, resolved.origin, e.currentTarget.getBoundingClientRect(), undefined, memberContext);
  };

  // The right click: the person, not the message around the badge. Profile,
  // a mention of them in this channel's composer, their username to copy.
  const handleContextMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!resolved) return;
    e.preventDefault();
    e.stopPropagation();
    const anchor = e.currentTarget.getBoundingClientRect();
    const memberContext = resolved.member
      ? { spaceId: resolved.member.spaceId, userId: resolved.member.userId }
      : undefined;
    const items: ContextMenuItem[] = [
      {
        type: 'action', key: 'profile', label: t('spaces:members.menu.profile'),
        onClick: () => openUserProfile(resolved.user, resolved.origin, anchor, undefined, memberContext),
      },
      {
        type: 'action', key: 'mention', label: '@' + displayName, hidden: !channelId,
        onClick: () => { if (channelId) insertComposerMention(channelId, userId); },
      },
      { type: 'separator', key: 'copy-separator' },
      {
        type: 'action', key: 'copy-username', label: t('common:contextMenu.copyUsername'),
        onClick: () => {
          void navigator.clipboard.writeText(resolved.user.username).then(
            () => useUIStore.getState().addToast(t('common:contextMenu.usernameCopied'), 'success', 2000),
            () => useUIStore.getState().addToast(t('common:contextMenu.clipboardFailed'), 'warning'),
          );
        },
      },
    ];
    useContextMenuStore.getState().open(menuPositionFor(e), items);
  };

  const baseClass = `inline-flex items-center rounded px-[2px] font-medium ${toneClass}`;

  // Plain text inside another control, and when there is no profile to open.
  if (!interactive || !resolved) {
    return (
      <span className={baseClass} style={toneStyle}>
        @{displayName}
      </span>
    );
  }

  // A real button, so it is in the tab order and Enter and Space open the
  // profile, like the click does.
  return (
    <button
      type="button"
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      className={`${baseClass} cursor-pointer transition-[filter] duration-100 hover:brightness-125 active:brightness-110`}
      style={toneStyle}
    >
      @{displayName}
    </button>
  );
});
