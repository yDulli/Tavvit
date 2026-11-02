import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { User } from '@backspace/shared';
import { describeError } from '../../i18n/errors';
import { useFormatters } from '../../i18n/formatters';
import { selectAllSaved, useSavedStore, type SavedEntry } from '../../stores/savedStore';
import { useInboxStore } from '../../stores/inboxStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { userDisplayName } from '../../utils/identity';
import { messagePath } from '../../utils/openThread';
import { useCanonicalUserView } from '../../utils/userViewLookup';
import { InlineMessageText } from '../chat/InlineMessageText';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { InboxEmptyState } from './InboxPage';

const FALLBACK_USER = { id: '', username: '', createdAt: 0, isAdmin: false, replicatedInstances: [] } as unknown as User;

function SavedRow({ entry }: { entry: SavedEntry }) {
  const { t } = useTranslation('home');
  const { formatShortDate, formatTime, formatDateTime } = useFormatters();
  const navigate = useNavigate();
  const addToast = useUIStore((state) => state.addToast);
  const spaceName = useSpaceStore((state) => state.spaces.find((space) => space.id === entry.spaceId && (space._instanceOrigin ?? '') === entry.origin)?.name ?? '');
  const channelName = useSpaceStore((state) => state.spaceChannelIndex.get(entry.channelId)?.name ?? '');
  const canonical = useCanonicalUserView(entry.message.user ?? FALLBACK_USER, entry.origin);
  const author = userDisplayName(canonical);

  const open = () => {
    navigate(entry.kind === 'channel'
      ? messagePath(entry.spaceId, entry.channelId, entry.message.id)
      : `/channels/@me/${entry.channelId}?message=${entry.message.id}`);
  };

  const remove = async () => {
    try {
      await useSavedStore.getState().remove(entry.origin, entry.kind, entry.message.id);
    } catch (err) {
      addToast(describeError(err), 'warning');
    }
  };

  return (
    <li className="list-row group relative items-start p-0">
      <button type="button" onClick={open} className="flex min-w-0 flex-1 gap-3 rounded-md px-2.5 py-2.5 text-left">
        <Avatar src={canonical.avatar} name={author} size={32} user={canonical} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-body font-semibold text-txt-primary">{author}</span>
            <span className="tabular flex-shrink-0 font-mono text-label text-txt-tertiary">
              {formatShortDate(entry.message.createdAt)} {formatTime(entry.message.createdAt)}
            </span>
          </span>
          <span className="mt-0.5 block truncate font-mono text-label text-txt-tertiary">
            {entry.kind === 'channel' ? `${spaceName} › #${channelName}` : t('saved.directMessage')}
          </span>
          <span className="mt-1 line-clamp-3 block text-body leading-[1.45] text-txt-message">
            {entry.message.content
              ? <InlineMessageText content={entry.message.content} channelId={entry.channelId} />
              : t('saved.noPreview')}
          </span>
          {entry.remindAt !== null && (
            <span className="mt-1 flex items-center gap-1.5 text-meta text-txt-tertiary">
              <Icon name="clock" size={13} className="flex-shrink-0" />
              {t('saved.remindsAt', { time: formatDateTime(entry.remindAt) })}
            </span>
          )}
        </span>
      </button>
      <button
        type="button"
        onClick={() => void remove()}
        className="icon-btn mr-1.5 mt-2 flex-shrink-0"
        title={t('saved.remove')}
        aria-label={t('saved.remove')}
      >
        <Icon name="x" size={14} />
      </button>
    </li>
  );
}

/** The inbox's tab for what this person saved, from every instance they are connected to. */
export function SavedList() {
  const { t } = useTranslation(['home', 'common']);
  const byOrigin = useSavedStore((state) => state.byOrigin);
  const items = useMemo(() => selectAllSaved({ byOrigin }), [byOrigin]);
  const connected = useInboxStore((state) => state.byOrigin);
  const originKey = Object.keys(connected).sort().join('|');

  useEffect(() => {
    // The same instances the inbox hears from; home at the least.
    const origins = originKey === '' ? [''] : originKey.split('|');
    for (const origin of origins) void useSavedStore.getState().loadList(origin);
  }, [originKey]);

  const lists = Object.entries(byOrigin);
  const loading = lists.some(([, list]) => list.status === 'loading' && list.items.length === 0);
  const failed = lists.filter(([, list]) => list.status === 'failed').map(([origin]) => origin);
  const older = lists.filter(([, list]) => list.nextBefore !== null).map(([origin]) => origin);

  return (
    <>
      {failed.length > 0 && (
        <div role="alert" className="mx-2.5 mb-2 flex flex-wrap items-center gap-3 rounded-md border border-border-hard px-3 py-2 text-ui text-txt-secondary">
          <span className="flex-1">{t('home:saved.failed')}</span>
          <button type="button" className="btn-outline btn-sm" onClick={() => failed.forEach((origin) => void useSavedStore.getState().loadList(origin))}>
            {t('home:inbox.retry')}
          </button>
        </div>
      )}
      {items.length === 0 ? (
        loading ? (
          <div className="space-y-2 px-2.5 pt-2" aria-hidden="true">
            {[0, 1, 2].map((at) => <div key={at} className="skeleton skeleton-block h-16" />)}
          </div>
        ) : (
          failed.length === 0 && <InboxEmptyState icon="bookmark" title={t('home:saved.emptyTitle')} body={t('home:saved.emptyBody')} />
        )
      ) : (
        <ul className="space-y-px">
          {items.map((entry) => <SavedRow key={`${entry.origin}:${entry.id}`} entry={entry} />)}
        </ul>
      )}
      {older.length > 0 && (
        <div className="flex justify-center pt-3">
          <button type="button" className="btn-outline btn-sm" onClick={() => older.forEach((origin) => void useSavedStore.getState().loadMore(origin))}>
            {t('home:inbox.older')}
          </button>
        </div>
      )}
    </>
  );
}
