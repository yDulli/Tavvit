import { useTranslation } from 'react-i18next';
import type { ThreadSummary } from '@backspace/shared/src/threads';
import { useFormatters } from '../../i18n/formatters';
import { openThreadView } from '../../utils/openThread';
import { Icon } from '../ui/Icon';

/** Under a message a thread grew from: what it is, how much was said, and the way in. */
export function ThreadChip({ thread, parentChannelId }: { thread: ThreadSummary; parentChannelId: string }) {
  const { t } = useTranslation('chat');
  const { formatRelativeTime, formatNumber } = useFormatters();
  return (
    <button type="button" onClick={() => openThreadView(thread.id, parentChannelId)} className="thread-chip">
      <Icon name="thread" size={14} className="flex-shrink-0 text-txt-tertiary" />
      <span className="min-w-0 truncate font-medium text-txt-primary">{thread.name}</span>
      <span className="flex-shrink-0 text-txt-tertiary">
        {thread.messageCount > 0
          ? t('thread.replies', { count: thread.messageCount, value: formatNumber(thread.messageCount) })
          : t('thread.noReplies')}
        {thread.lastMessageAt !== null ? ` · ${formatRelativeTime(thread.lastMessageAt)}` : ''}
      </span>
    </button>
  );
}
