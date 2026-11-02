import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ThreadOpened } from '@backspace/shared/src/threads';
import { useUIStore } from '../../stores/uiStore';
import { ThreadActions, ThreadConversation } from '../chat/ThreadPanel';
import { BAR_BUTTON, BAR_TITLE } from './mobileClasses';

/** A thread as a screen of its own: a phone has no room for it beside the channel. */
export function MobileThreadScreen({ params }: { params?: Record<string, string> }) {
  const { t } = useTranslation(['chat', 'common']);
  const popMobileScreen = useUIStore((s) => s.popMobileScreen);
  const [opened, setOpened] = useState<ThreadOpened | null>(null);
  const [title, setTitle] = useState('');
  const [jumpTo, setJumpTo] = useState<string | null>(params?.messageId ?? null);

  const onHeader = useCallback((value: ThreadOpened | null) => {
    setOpened(value);
    if (value) setTitle(value.thread.name);
  }, []);
  const clearJump = useCallback(() => setJumpTo(null), []);

  const threadId = params?.threadId;
  const parentChannelId = params?.parentChannelId;
  if (!threadId || !parentChannelId) return null;

  return (
    <div className="lit flex h-full flex-col bg-surface-chat">
      <header className="panel-bar flex h-12 items-center gap-1 bg-surface-base px-1">
        <button type="button" onClick={popMobileScreen} className={BAR_BUTTON} aria-label={t('common:actions.back')}>
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <h1 className={BAR_TITLE}>{title || t('chat:thread.listTitle')}</h1>
        {opened && <ThreadActions opened={opened} onRenamed={setTitle} onDeleted={popMobileScreen} />}
      </header>
      <ThreadConversation
        key={threadId}
        threadId={threadId}
        parentChannelId={parentChannelId}
        jumpToMessageId={jumpTo}
        onJumpHandled={clearJump}
        onHeader={onHeader}
      />
    </div>
  );
}
