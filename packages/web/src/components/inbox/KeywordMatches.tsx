import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { MentionItem } from '@backspace/shared';
import { api } from '../../api/client';
import { useKeywordStore } from '../../stores/keywordStore';
import { messagePath } from '../../utils/openThread';
import { InboxEmptyState, MentionRow } from './InboxPage';

const noMark = async (): Promise<void> => undefined;

/**
 * The inbox's tab for messages that hold a word this person watches: from the instance their
 * words are kept on, read when the tab opens. A hit that arrives while it is open alerts them
 * as usual; a hit in a space of another instance alerts them and is not listed here.
 */
export function KeywordMatches() {
  const { t } = useTranslation(['home', 'common']);
  const navigate = useNavigate();
  const words = useKeywordStore((state) => state.words);
  const [items, setItems] = useState<MentionItem[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

  const load = useCallback(async (before?: string) => {
    try {
      const page = await api.keywords.matches(before);
      setItems((current) => (before ? [...current, ...page.mentions] : page.mentions));
      setNextBefore(page.nextBefore);
      setStatus('ready');
    } catch {
      setStatus('failed');
    }
  }, []);

  useEffect(() => {
    setStatus('loading');
    void load();
  }, [load, words]);

  if (status === 'failed' && items.length === 0) {
    return (
      <div role="alert" className="mx-2.5 mb-2 flex flex-wrap items-center gap-3 rounded-md border border-border-hard px-3 py-2 text-ui text-txt-secondary">
        <span className="flex-1">{t('home:keywordMatches.failed')}</span>
        <button type="button" className="btn-outline btn-sm" onClick={() => void load()}>{t('home:inbox.retry')}</button>
      </div>
    );
  }
  if (status === 'loading' && items.length === 0) {
    return (
      <div className="space-y-2 px-2.5 pt-2" aria-hidden="true">
        {[0, 1, 2].map((at) => <div key={at} className="skeleton skeleton-block h-16" />)}
      </div>
    );
  }
  if (items.length === 0) {
    return <InboxEmptyState icon="at" title={t('home:keywordMatches.emptyTitle')} body={t('home:keywordMatches.emptyBody')} />;
  }
  return (
    <>
      <ul className="space-y-px">
        {items.map((item) => (
          <MentionRow
            key={item.message.id}
            item={{ ...item, origin: '', unread: false }}
            onOpen={() => navigate(messagePath(item.spaceId, item.channelId, item.message.id))}
            onMark={noMark}
          />
        ))}
      </ul>
      {nextBefore !== null && (
        <div className="flex justify-center pt-3">
          <button type="button" className="btn-outline btn-sm" onClick={() => void load(nextBefore)}>{t('home:inbox.older')}</button>
        </div>
      )}
    </>
  );
}
