import type { MessageWithUser, User } from '@backspace/shared';
import { parseChannelSystemEvent } from '@backspace/shared/src/channelSystemEvents';
import { useTranslation } from 'react-i18next';
import { useSpaceStore } from '../../stores/spaceStore';
import { spaceMemberName } from '../../utils/identity';
import { useCanonicalUserView } from '../../utils/userViewLookup';
import { useMessageJump } from './messageJumpContext';

interface ChannelSystemMessageProps {
  message: MessageWithUser;
}

/** Stands in for the roster row's user when the target is not in the roster; its name is never shown. */
const NO_USER = { id: '', username: '', createdAt: 0, isAdmin: false, replicatedInstances: [] } as unknown as User;

/**
 * Timeline row for a space channel system message (`channelSystemEvents.ts`).
 * The people it names are named the way the rest of the space names them,
 * through `spaceMemberName` on the space's roster, so a member with a
 * nickname has one name on the screen. The target's stored name is used only
 * when the target is not in the roster. Content this version does not know
 * renders the generic label, never the content.
 */
export function ChannelSystemMessage({ message }: ChannelSystemMessageProps) {
  const { t } = useTranslation(['chat', 'dm']);
  const origin = useSpaceStore((s) => s.channelOriginMap.get(message.channelId) ?? '');
  const members = useSpaceStore((s) => s.members);
  const event = parseChannelSystemEvent(message.content);

  // message.userId and targetUserId are ids on the space's instance, the ids
  // its roster carries.
  const actorMember = members.find((m) => m.userId === message.userId);
  const targetMember = event?.event === 'channel_poke' ? members.find((m) => m.userId === event.targetUserId) : undefined;
  const actorUser = useCanonicalUserView(message.user, origin);
  const targetUser = useCanonicalUserView(targetMember?.user ?? NO_USER, origin);
  const jump = useMessageJump();

  if (event?.event === 'message_pinned') {
    return (
      <div className="flex items-center justify-center gap-1.5 py-1 px-5 select-none">
        <span className="text-meta text-txt-tertiary text-center">
          {t('chat:pins.line', { actor: spaceMemberName(actorMember, actorUser) })}
        </span>
        {jump && (
          <button type="button" onClick={() => jump(event.messageId)} className="text-meta text-txt-link hover:underline">
            {t('chat:pins.lineJump')}
          </button>
        )}
      </div>
    );
  }

  let text: string;
  if (event?.event === 'channel_poke') {
    text = t('chat:poke.received', {
      actor: spaceMemberName(actorMember, actorUser),
      target: targetMember ? spaceMemberName(targetMember, targetUser) : event.targetDisplayName,
    });
  } else {
    text = t('dm:system.generic');
  }

  return (
    <div className="flex items-center justify-center py-1 px-5 select-none">
      <span className="text-meta text-txt-tertiary text-center">{text}</span>
    </div>
  );
}
