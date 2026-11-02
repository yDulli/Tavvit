import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useChatStore } from '../../stores/chatStore';
import { useThreadStore } from '../../stores/threadStore';
import { Icon } from '../ui/Icon';

/** The threads someone follows, under their channel in the sidebar. A thread that went quiet leaves at the next start. */
export function FollowedThreadRows({ channelId, spaceId }: { channelId: string; spaceId: string }) {
  const { t } = useTranslation('home');
  const navigate = useNavigate();
  const followed = useThreadStore((s) => s.followed);
  const openThreadId = useThreadStore((s) => s.open?.threadId);
  const unread = useChatStore((s) => s.unreadChannels);

  const threads = useMemo(() => [...followed.values()]
    .filter((thread) => thread.parentChannelId === channelId)
    .sort((a, b) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt)), [followed, channelId]);

  if (threads.length === 0) return null;

  return (
    <ul className="ml-4 border-l border-border-hard pl-1.5">
      {threads.map((thread) => {
        const active = openThreadId === thread.id;
        const isUnread = unread.has(thread.id) && !active;
        return (
          <li key={thread.id}>
            <button
              type="button"
              onClick={() => navigate(`/channels/${spaceId}/${channelId}?thread=${thread.id}`)}
              data-active={active ? 'true' : undefined}
              data-unread={isUnread ? 'true' : undefined}
              aria-current={active ? 'true' : undefined}
              className="nav-item group relative w-full text-left"
            >
              <Icon name="thread" size={14} className="flex-shrink-0 text-txt-tertiary" />
              <span className="min-w-0 flex-1 truncate text-meta">{thread.name}</span>
              {isUnread && (
                <>
                  <span aria-hidden="true" className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-txt-primary" />
                  <span className="sr-only">{t('unread.dot')}</span>
                </>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
