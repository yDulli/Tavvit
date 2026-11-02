import React, { useEffect, useId, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { formatters } from '../../i18n/formatters';
import { createPortal } from 'react-dom';
import { useFloatingPosition } from '../../hooks/useFloatingPosition';
import { isDmChannel, getChannelOrigin, getApiForOrigin } from '../../stores/spaceStore';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { highlightMatch } from './searchHighlight';
import { messageTextForPreview } from '../../utils/stickerMessages';
import { useEmojiShortcodeNames } from '../../utils/emojiShortcodes';
import { useCanonicalUserView } from '../../utils/userViewLookup';
import type { MessageWithUser, DmMessageWithUser, User } from '@backspace/shared';

type AnyMessage = MessageWithUser | DmMessageWithUser;

interface SearchPopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  channelId: string;
  isDm: boolean;
  onJumpToMessage: (messageId: string) => void;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  const time = formatters.formatTime(timestamp);
  if (isToday) return i18n.t('common:time.today', { time });
  if (isYesterday) return i18n.t('common:time.yesterday', { time });
  return formatters.formatDateTime(timestamp);
}

const _FALLBACK_USER = { id: '', username: '', createdAt: 0, isAdmin: false, replicatedInstances: [] } as unknown as User;

export function SearchResultRow({
  msg,
  origin,
  query,
  onJumpToMessage,
}: {
  msg: AnyMessage;
  /** The instance that issued the result (the searched channel's). */
  origin: string;
  query: string;
  onJumpToMessage: (id: string) => void;
}) {
  useEmojiShortcodeNames();
  const { t } = useTranslation(['search']);
  const canonical = useCanonicalUserView(msg.user ?? _FALLBACK_USER, origin);
  const displayName = canonical.displayName ?? canonical.username ?? '?';
  const avatar = msg.user ? canonical.avatar : undefined;
  return (
    <button
      type="button"
      onClick={() => onJumpToMessage(msg.id)}
      className="list-row w-full items-start gap-2.5"
    >
      <div className="flex-shrink-0 mt-0.5">
        <Avatar
          src={avatar}
          name={displayName}
          size={28}
          user={msg.user ? canonical : undefined}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-ui font-medium text-txt-primary truncate">
            {displayName}
          </span>
          <span className="tabular flex-shrink-0 font-mono text-2xs text-txt-tertiary">
            {formatTime(msg.createdAt)}
          </span>
        </div>
        <div className="text-ui text-txt-secondary leading-[1.4] line-clamp-2 mt-0.5 [overflow-wrap:anywhere]">
          {highlightMatch(messageTextForPreview(msg.content ?? ''), query)}
        </div>
        {msg.attachments && msg.attachments.length > 0 && (
          <div className="flex items-center gap-1 mt-1 text-label text-txt-tertiary">
            <Icon name="paperclip" size={12} />
            {t('search:results.attachments', { count: msg.attachments.length })}
          </div>
        )}
      </div>
    </button>
  );
}

export function SearchPopover({ open, onClose, anchorRef, channelId, isDm, onJumpToMessage }: SearchPopoverProps) {
  const { t } = useTranslation(['search', 'common']);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const filterId = useId();
  const { style } = useFloatingPosition(anchorRef, popoverRef, {
    placement: 'bottom',
    offset: 8,
    enabled: open,
  });

  const [query, setQuery] = useState('');
  const [fromFilter, setFromFilter] = useState('');
  const [hasFilter, setHasFilter] = useState('');
  const [beforeFilter, setBeforeFilter] = useState('');
  const [afterFilter, setAfterFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [results, setResults] = useState<AnyMessage[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [offset, setOffset] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Reset state when channel changes or popover opens
  useEffect(() => {
    if (open) {
      setQuery('');
      setFromFilter('');
      setHasFilter('');
      setBeforeFilter('');
      setAfterFilter('');
      setResults([]);
      setTotalCount(0);
      setOffset(0);
      setShowFilters(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, channelId]);

  // Click-outside handler
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      // The button that opens it closes it: this would close it and that click open it again.
      if (popoverRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open, onClose, anchorRef]);

  // Escape handler
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const doSearch = useCallback(async (searchOffset = 0) => {
    const trimmed = query.trim();
    if (!trimmed && !fromFilter && !hasFilter && !beforeFilter && !afterFilter) {
      setResults([]);
      setTotalCount(0);
      return;
    }

    setIsSearching(true);
    try {
      const origin = getChannelOrigin(channelId);
      const client = getApiForOrigin(origin);
      const params = {
        q: trimmed || undefined,
        from: fromFilter || undefined,
        has: hasFilter || undefined,
        before: beforeFilter || undefined,
        after: afterFilter || undefined,
        offset: searchOffset,
        limit: 25,
      };

      const data = isDm
        ? await client.search.dm(channelId, params)
        : await client.search.channel(channelId, params);

      if (searchOffset === 0) {
        setResults(data.results as AnyMessage[]);
      } else {
        setResults(prev => [...prev, ...(data.results as AnyMessage[])]);
      }
      setTotalCount(data.totalCount);
      setOffset(searchOffset + data.results.length);
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setIsSearching(false);
    }
  }, [query, fromFilter, hasFilter, beforeFilter, afterFilter, channelId, isDm]);

  // Debounced search on query/filter change
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doSearch(0);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [doSearch]);

  const handleLoadMore = () => {
    doSearch(offset);
  };

  if (!open) return null;

  const hasAnyFilter = !!(fromFilter || hasFilter || beforeFilter || afterFilter);

  return createPortal(
    <div
      ref={popoverRef}
      style={style}
      className="w-[420px] max-w-[calc(100*var(--app-vw)-16px)] max-h-[min(500px,calc(100*var(--app-vh)-64px))] glass rounded-lg flex flex-col animate-fade-in"
    >
      {/* Search input */}
      <div className="p-2.5 border-b border-border-hard">
        <div className="relative flex items-center">
          <Icon name="search" size={15} className="pointer-events-none absolute left-2.5 text-txt-tertiary" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search:input.placeholder')}
            className="input-search h-8 w-full py-0 pl-8 pr-8 text-ui"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="icon-btn absolute right-1 h-6 w-6"
              aria-label={t('common:actions.clear')}
            >
              <Icon name="x" size={14} />
            </button>
          )}
        </div>

        {/* Filter toggle */}
        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          aria-expanded={showFilters}
          className="mt-1.5 -ml-1 flex items-center gap-1 rounded-md py-0.5 pl-0.5 pr-1.5 text-meta text-txt-tertiary transition-colors hover:text-txt-primary"
        >
          <Icon name="chevron-right" size={14} className={`transition-transform duration-100 ${showFilters ? 'rotate-90' : ''}`} />
          {t('search:filters.toggle')}
          {hasAnyFilter && (
            <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-accent-primary" />
          )}
        </button>

        {/* Filters row */}
        {showFilters && (
          <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-2">
            <div>
              <label className="field-label mb-1" htmlFor={`${filterId}-from`}>{t('search:filters.from.label')}</label>
              <input
                id={`${filterId}-from`}
                type="text"
                value={fromFilter}
                onChange={(e) => setFromFilter(e.target.value)}
                placeholder={t('search:filters.from.placeholder')}
                className="input-search h-8 w-full py-0 pl-2.5 pr-2 text-ui"
              />
            </div>
            <div>
              <label className="field-label mb-1" htmlFor={`${filterId}-has`}>{t('search:filters.has.label')}</label>
              <select
                id={`${filterId}-has`}
                value={hasFilter}
                onChange={(e) => setHasFilter(e.target.value)}
                className="input-search h-8 w-full py-0 pl-2.5 text-ui"
              >
                <option value="">{t('search:filters.has.any')}</option>
                <option value="file">{t('search:filters.has.file')}</option>
                <option value="image">{t('search:filters.has.image')}</option>
                <option value="link">{t('search:filters.has.link')}</option>
              </select>
            </div>
            <div>
              <label className="field-label mb-1" htmlFor={`${filterId}-before`}>{t('search:filters.before.label')}</label>
              <input
                id={`${filterId}-before`}
                type="date"
                value={beforeFilter}
                onChange={(e) => setBeforeFilter(e.target.value)}
                className="input-search h-8 w-full py-0 pl-2.5 pr-2 text-ui"
              />
            </div>
            <div>
              <label className="field-label mb-1" htmlFor={`${filterId}-after`}>{t('search:filters.after.label')}</label>
              <input
                id={`${filterId}-after`}
                type="date"
                value={afterFilter}
                onChange={(e) => setAfterFilter(e.target.value)}
                className="input-search h-8 w-full py-0 pl-2.5 pr-2 text-ui"
              />
            </div>
          </div>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 scrollbar-thin">
        {isSearching && results.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <div className="h-4 w-4 rounded-full border-[1.5px] border-txt-tertiary border-r-transparent animate-spin" />
          </div>
        )}

        {!isSearching && results.length === 0 && (query || hasAnyFilter) && (
          <div className="empty-state">
            <span className="empty-state-icon" aria-hidden="true">
              <Icon name="search" size={18} />
            </span>
            <p className="empty-state-body">{t('search:results.empty')}</p>
          </div>
        )}

        {!query && !hasAnyFilter && results.length === 0 && (
          <div className="px-4 py-7 text-center text-ui text-txt-tertiary">
            {t('search:results.hint')}
          </div>
        )}

        {results.length > 0 && (
          <div className="p-1.5">
            <div className="label-mono px-2.5 pb-1 pt-1">
              {t('search:results.count', { count: totalCount })}
            </div>
            {results.map((msg) => (
              <SearchResultRow
                key={msg.id}
                msg={msg}
                origin={getChannelOrigin(channelId)}
                query={query}
                onJumpToMessage={onJumpToMessage}
              />
            ))}
            {results.length < totalCount && (
              <div className="pt-1.5">
                <button
                  type="button"
                  onClick={handleLoadMore}
                  disabled={isSearching}
                  aria-busy={isSearching}
                  className="btn-quiet btn-sm w-full"
                >
                  {isSearching ? t('common:states.loading') : t('search:results.loadMore', { remaining: totalCount - results.length })}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
