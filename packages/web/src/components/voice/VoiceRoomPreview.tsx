import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channel } from '@backspace/shared';
import { useSpaceStore } from '../../stores/spaceStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { hasPermissionBit, PermissionBits } from '../../utils/permissions';
import { joinVoiceChannel } from '../../utils/voice';
import { Avatar } from '../ui/Avatar';
import { ChannelIcon } from '../ui/ChannelIcon';
import { Icon } from '../ui/Icon';
import { VoiceChannelTimer } from './VoiceChannel';

const NOBODY: string[] = [];

/**
 * A voice channel seen from outside, before joining: the room as a page of its own. Its space
 * and its name open it, as any page's opening does; under a hairline, who is in it now (the
 * server's list, the same the channel column shows) with how long the room has been going, or
 * that it is empty; then the one action, joining. Someone without the right to connect sees the
 * room and why the button does nothing.
 */
export function VoiceRoomPreview({ channel }: { channel: Channel }) {
  const { t } = useTranslation(['spaces', 'voice']);
  const userIds = useVoiceStore((s) => s.voiceUsers.get(channel.id)) ?? NOBODY;
  const voiceUserStates = useVoiceStore((s) => s.voiceUserStates);
  const elapsed = useVoiceStore((s) => s.voiceChannelElapsedSeconds.get(channel.id) ?? null);
  const members = useSpaceStore((s) => s.members);
  const spaceName = useSpaceStore((s) => s.spaces.find((space) => space.id === channel.spaceId)?.name ?? '');
  const canConnect = useSpaceStore((s) => hasPermissionBit(s.channelPermissions.get(channel.id), PermissionBits.CONNECT));

  const people = useMemo(() => userIds.map((userId) => {
    const member = members.find((m) => m.userId === userId);
    const state = voiceUserStates.get(userId);
    return {
      userId,
      homeUserId: member?.user.homeUserId ?? userId,
      name: member?.nickname ?? member?.user.displayName ?? member?.user.username ?? userId,
      avatar: member?.user.avatar ?? null,
      avatarColor: member?.user.avatarColor ?? null,
      muted: state?.isMuted ?? false,
      deafened: state?.isDeafened ?? false,
    };
  }), [userIds, members, voiceUserStates]);

  return (
    <div className="relative flex min-h-0 flex-1 overflow-y-auto">
      <section aria-labelledby={`voice-room-${channel.id}`} className="rise-in m-auto w-full max-w-[600px] px-8 py-14">
        <p className="label-mono flex min-w-0 items-center gap-2">
          <ChannelIcon type="voice" icon={channel.icon} size={14} className="flex-shrink-0 text-txt-tertiary" />
          <span className="truncate">{spaceName}</span>
        </p>
        <h2 id={`voice-room-${channel.id}`} className="display-title ink mt-3 break-words">{channel.name}</h2>

        <div className="mt-7 border-t border-border-hard pt-5">
          {people.length > 0 ? (
            <>
              <p className="flex items-center gap-3 text-ui text-txt-secondary">
                <span className="flex items-center gap-2">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-status-online" />
                  <span className="tabular">{t('spaces:main.voice.participants', { count: people.length })}</span>
                </span>
                {elapsed && <VoiceChannelTimer observation={elapsed} />}
              </p>
              <ul className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-x-3 gap-y-5">
                {people.map((person) => (
                  <li key={person.userId} className="flex min-w-0 flex-col items-center gap-2 text-center">
                    <span className="relative">
                      <Avatar src={person.avatar} name={person.name} size={56} userId={person.homeUserId} avatarColor={person.avatarColor} />
                      {/* As in the channel column's rows: the mark is for the eye, like theirs. */}
                      {(person.muted || person.deafened) && (
                        <span aria-hidden="true" className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-surface-elevated text-txt-danger ring-2 ring-surface-chat">
                          <Icon name={person.deafened ? 'headphones-off' : 'mic-off'} size={11} />
                        </span>
                      )}
                    </span>
                    <span className="w-full truncate text-meta font-medium text-txt-secondary">{person.name}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-ui leading-relaxed text-txt-tertiary">{t('spaces:main.voice.empty')}</p>
          )}
        </div>

        <div className="mt-9 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            onClick={() => joinVoiceChannel(channel.id, useVoiceStore.getState().connectFn ?? undefined)}
            disabled={!canConnect}
            className="btn-primary btn-lg"
          >
            <Icon name={canConnect ? 'mic' : 'lock'} size={16} />
            {t('spaces:main.voice.join')}
          </button>
          {!canConnect && <p className="text-meta text-txt-tertiary">{t('voice:connectLocked')}</p>}
        </div>
      </section>
    </div>
  );
}
