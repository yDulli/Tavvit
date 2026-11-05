import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useCommandReplyStore } from '../../stores/commandReplyStore';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { MarkdownRenderer } from './MarkdownRenderer';
import { MessageCards } from './MessageCards';

/** What a bot answered this person alone, above the composer. Nobody else sees it, and a reload ends it. */
export function CommandReplies({ channelId }: { channelId: string }) {
  const { t } = useTranslation(['chat']);
  const all = useCommandReplyStore((state) => state.replies);
  const dismiss = useCommandReplyStore((state) => state.dismiss);
  const replies = useMemo(() => all.filter((reply) => reply.channelId === channelId), [all, channelId]);
  if (replies.length === 0) return null;

  return (
    <div className="mb-1.5 flex max-h-72 flex-col gap-1.5 overflow-y-auto">
      {replies.map((reply) => (
        <div key={reply.id} className="surface-card rounded-lg px-3 py-2" role="status">
          <div className="flex items-center gap-2">
            <Avatar src={reply.botAvatar} name={reply.botName} size={20} userId={reply.botId} avatarColor={reply.botAvatarColor} />
            <span className="min-w-0 truncate text-ui font-medium text-txt-primary">{reply.botName}</span>
            <span className="min-w-0 flex-1 truncate text-label text-txt-tertiary">{t('chat:commands.onlyYou')}</span>
            <button
              type="button"
              onClick={() => dismiss(reply.id)}
              className="icon-btn h-6 w-6 flex-shrink-0"
              aria-label={t('chat:commands.dismiss')}
            >
              <Icon name="x" size={14} />
            </button>
          </div>
          {reply.content && (
            <div className="message-text mt-1 text-ui leading-[1.5] break-words whitespace-pre-wrap text-txt-message">
              <MarkdownRenderer content={reply.content} channelId={channelId} />
            </div>
          )}
          {reply.cards && <div className="mt-1.5"><MessageCards cards={reply.cards} channelId={channelId} /></div>}
        </div>
      ))}
    </div>
  );
}
