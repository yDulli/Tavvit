import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { useFormatters } from '../../i18n/formatters';
import type { ContextMenuItem } from '../../stores/contextMenuStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { useSpaceStore, getChannelOrigin } from '../../stores/spaceStore';
import { wsSend } from '../../hooks/useWebSocket';
import { hasPermissionBit, PermissionBits } from '../../utils/permissions';
import { viewerCanActOnUserInSpace } from '../../utils/roleHierarchy';
import { ChannelIcon } from '../ui/ChannelIcon';
import { Icon } from '../ui/Icon';

/**
 * Build moderation context menu items for a voice user.
 * Called imperatively at right-click time (not during render).
 *
 * `channelId` is the voice channel the target is in. The server checks every
 * moderation bit against that channel, overrides included, so the menu reads
 * the same channel's permissions: a voice channel can grant or deny
 * MUTE_MEMBERS and the rest on its own. The target must also rank below the
 * viewer in the role hierarchy.
 */
export function buildVoiceModMenuItems(targetUserId: string, channelId: string): ContextMenuItem[] {
  const { channelPermissions, channels, channelToSpaceMap } = useSpaceStore.getState();
  const { spaceMutedUserIds, spaceDeafenedUserIds } = useVoiceStore.getState();

  // Derive spaceId from the voice channel, NOT from UI navigation state.
  // On mobile, the user can navigate away from the space while still in voice.
  const derivedSpaceId = channelToSpaceMap.get(channelId);
  const myPerms = channelPermissions.get(channelId);
  const canMuteMembers = hasPermissionBit(myPerms, PermissionBits.MUTE_MEMBERS);
  const canDeafenMembers = hasPermissionBit(myPerms, PermissionBits.DEAFEN_MEMBERS);
  const canMoveMembers = hasPermissionBit(myPerms, PermissionBits.MOVE_MEMBERS);
  const canDisconnectMembers = hasPermissionBit(myPerms, PermissionBits.DISCONNECT_MEMBERS);

  if (!canMuteMembers && !canDeafenMembers && !canMoveMembers && !canDisconnectMembers) return [];
  // Every action below moderates the target, which the server refuses for a
  // member ranked at or above the viewer (permissions.md, "Role hierarchy").
  if (derivedSpaceId && !viewerCanActOnUserInSpace(derivedSpaceId, targetUserId)) return [];

  const voiceOrigin = getChannelOrigin(channelId);
  const spaceId = derivedSpaceId;
  const isSpaceMuted = spaceMutedUserIds.has(`${spaceId}:${targetUserId}`);
  const isSpaceDeafened = spaceDeafenedUserIds.has(`${spaceId}:${targetUserId}`);
  const otherVoiceChannels = channels.filter(c => c.type === 'voice' && c.id !== channelId);

  const items: ContextMenuItem[] = [];

  if (canMuteMembers) {
    items.push({
      key: 'space-mute',
      type: 'action',
      label: isSpaceMuted ? i18n.t('voice:moderation.spaceUnmute') : i18n.t('voice:moderation.spaceMute'),
      icon: <Icon name={isSpaceMuted ? 'mic-off' : 'mic'} size={16} />,
      onClick: () => wsSend({ type: 'voice_space_mute', userId: targetUserId, muted: !isSpaceMuted }, voiceOrigin),
    });
  }

  if (canDeafenMembers) {
    items.push({
      key: 'space-deafen',
      type: 'action',
      label: isSpaceDeafened ? i18n.t('voice:moderation.spaceUndeafen') : i18n.t('voice:moderation.spaceDeafen'),
      icon: <Icon name={isSpaceDeafened ? 'headphones-off' : 'headphones'} size={16} />,
      onClick: () => wsSend({ type: 'voice_space_deafen', userId: targetUserId, deafened: !isSpaceDeafened }, voiceOrigin),
    });
  }

  if (canDisconnectMembers) {
    items.push({ key: 'mod-sep', type: 'separator' });
    items.push({
      key: 'disconnect',
      type: 'action',
      label: i18n.t('voice:moderation.disconnect'),
      danger: true,
      icon: <Icon name="phone" size={16} className="rotate-[135deg]" />,
      onClick: () => wsSend({ type: 'voice_disconnect', userId: targetUserId }, voiceOrigin),
    });
  }

  if (canMoveMembers && otherVoiceChannels.length > 0) {
    items.push({ key: 'move-sep', type: 'separator' });
    items.push({
      key: 'move-to',
      type: 'submenu',
      label: i18n.t('voice:moderation.moveTo'),
      icon: <Icon name="login" size={16} />,
      children: otherVoiceChannels.map(ch => ({
        key: ch.id,
        type: 'action' as const,
        label: ch.name,
        icon: <ChannelIcon type="voice" icon={ch.icon} size={16} className="text-txt-tertiary" />,
        onClick: () => wsSend({ type: 'voice_move', userId: targetUserId, targetChannelId: ch.id }, voiceOrigin),
      })),
    });
  }

  return items;
}

// ── Shared custom menu item components ────────────────────────────────────

/**
 * Volume slider for a voice participant, used as a `custom` context menu item.
 * Must be a component (not a plain function) because it subscribes to store state.
 */
export function VolumeSliderItem({ userId }: { userId: string }) {
  const { t } = useTranslation(['voice', 'common']);
  const f = useFormatters();
  const volume = useVoiceStore((s) => s.participantVolumes.get(userId) ?? 100);
  const setParticipantVolume = useVoiceStore((s) => s.setParticipantVolume);

  return (
    <div className="p-3">
      <div className="label-mono mb-2">
        {t('voice:participantMenu.userVolume')}
      </div>
      <div className="flex items-center gap-2">
        <Icon name="volume" size={16} className="text-txt-tertiary flex-shrink-0" />
        <input
          type="range"
          min="0"
          max="200"
          value={volume}
          onChange={(e) => setParticipantVolume(userId, parseInt(e.target.value))}
          aria-label={t('voice:participantMenu.userVolume')}
          className="flex-1 min-w-0 cursor-pointer accent-accent-primary h-1"
        />
        <span className="tabular font-mono text-label text-txt-secondary min-w-[36px] flex-shrink-0 text-right">
          {f.formatPercent(volume)}
        </span>
      </div>
    </div>
  );
}
