import { ExternalGate } from '../ui/ExternalMedia';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import type { GifResult } from '@backspace/shared';

interface GifPickerProps {
  onGifSelect: (url: string) => void;
  /**
   * Mobile rendering: drop the desktop fixed dimensions and let the picker
   * fill its parent (a bottom sheet that controls width + max-height).
   */
  mobile?: boolean;
}

export function GifPicker({ onGifSelect, mobile = false }: GifPickerProps) {
  const { t } = useTranslation(['chat']);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [results, setResults] = useState<GifResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [nextPos, setNextPos] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Debounce search query
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Fetch results when debounced query changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setResults([]);
    setNextPos('');

    const fetchGifs = async () => {
      try {
        const data = debouncedQuery.trim()
          ? await api.gif.search(debouncedQuery.trim(), 30)
          : await api.gif.trending(30);
        if (!cancelled) {
          setResults(data.results);
          setNextPos(data.next);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };
    fetchGifs();
    return () => { cancelled = true; };
  }, [debouncedQuery]);

  // Infinite scroll
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || loadingMore || !nextPos) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
      setLoadingMore(true);
      const fetchMore = async () => {
        try {
          const data = debouncedQuery.trim()
            ? await api.gif.search(debouncedQuery.trim(), 30, nextPos)
            : await api.gif.trending(30, nextPos);
          setResults((prev) => [...prev, ...data.results]);
          setNextPos(data.next);
        } finally {
          setLoadingMore(false);
        }
      };
      fetchMore();
    }
  }, [loadingMore, nextPos, debouncedQuery]);

  // Prevent keyboard events from bubbling
  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
  };

  // Mobile: fill parent (sheet sets width + max-height). Desktop: fixed dims
  // matching the legacy popover footprint.
  const rootClass = mobile
    ? 'flex flex-col flex-1 min-h-0 w-full'
    : 'flex flex-col h-[390px] w-[390px]';

  return (
    <div className={rootClass} onKeyDown={handleKeyDown}>
      {/* Search */}
      <div className="px-3 pt-2 pb-1.5 shrink-0">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('chat:gif.searchPlaceholder')}
          className="input-search w-full"
          // Auto-focus only on desktop. On mobile this would force the OS
          // keyboard up the moment the sheet opens, hiding most of the grid.
          autoFocus={!mobile}
        />
      </div>

      {/* Results grid */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto scrollbar-thin px-2 pb-1"
        onScroll={handleScroll}
      >
        {loading ? (
          <div className="grid grid-cols-2 gap-1.5 p-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="skeleton skeleton-block"
                style={{ height: 100 + (i * 37) % 60 }}
              />
            ))}
          </div>
        ) : results.length === 0 ? (
          <div className="flex h-full items-center justify-center text-ui text-txt-tertiary">
            {debouncedQuery.trim() ? t('chat:gif.noResults') : t('chat:gif.noTrending')}
          </div>
        ) : (
          <ExternalGate url={results[0]?.previewUrl} className="m-2">
          <div className="columns-2 gap-1.5 p-1">
            {results.map((gif) => (
              <button
                key={gif.id}
                onClick={() => onGifSelect(gif.url)}
                className="mb-1.5 w-full overflow-hidden rounded-lg border border-transparent transition-colors break-inside-avoid hover:border-interactive-muted"
              >
                <img
                  src={gif.previewUrl}
                  alt={gif.title}
                  className="w-full object-cover"
                  loading="lazy"
                  style={{
                    aspectRatio: gif.width && gif.height ? `${gif.width}/${gif.height}` : undefined,
                  }}
                />
              </button>
            ))}
          </div>
          </ExternalGate>
        )}
        {loadingMore && (
          <div className="flex justify-center py-2">
            <div className="h-4 w-4 rounded-full border-[1.5px] border-txt-tertiary border-r-transparent animate-spin" />
          </div>
        )}
      </div>

      {/* Attribution */}
      <div className="shrink-0 border-t border-border-hard px-3 py-1 text-right text-2xs text-txt-tertiary">
        {t('chat:gif.attribution')}
      </div>
    </div>
  );
}
