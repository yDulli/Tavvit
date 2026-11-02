import { layoutPixels } from '../../platform/interfaceScale';
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { User, DmChannel, UserSearchResult } from '@backspace/shared';
import { Avatar } from '../ui/Avatar';
import { AvatarStack } from '../ui/AvatarStack';
import { useSpaceStore } from '../../stores/spaceStore';
import { useSelfIdentity } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { api } from '../../api/client';
import { isMine, parseFederatedUsername, userKey } from '../../utils/identity';
import { openDirectMessage } from '../../utils/openDirectMessage';
import { useCanonicalUserView, usernameQueryOf, useSearchResultView } from '../../utils/userViewLookup';
import { useFloatingPosition } from '../../hooks/useFloatingPosition';
import { Icon } from '../ui/Icon';

/** A result row of the dropdown: the keyboard's current row is the selected one. */
function resultRowClass(isSelected: boolean): string {
  return `mx-1 flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 transition-colors ${
    isSelected ? 'bg-interactive-selected' : 'hover:bg-interactive-hover'
  }`;
}

/**
 * Avatar + display-name row for a user result in the DM search bar.
 * Extracted as a component so useCanonicalUserView can be called at the top
 * of a stable component rather than inside a variable-length .map().
 */
function DmSearchUserRow({ user, isSelected, selectedRef, onClick }: {
  /** A username search result from the page's own instance. */
  user: UserSearchResult;
  isSelected: boolean;
  selectedRef?: React.Ref<HTMLDivElement>;
  onClick: () => void;
}) {
  const canonical = useSearchResultView(user, '');
  const displayName = canonical.displayName ?? canonical.username;
  return (
    <div
      ref={isSelected ? selectedRef : undefined}
      onClick={onClick}
      className={resultRowClass(isSelected)}
    >
      <Avatar
        src={canonical.avatar}
        name={displayName}
        size={24}
        status={canonical.status}
        userId={user.homeUserId ?? user.id}
      />
      <div className="flex-1 min-w-0 flex items-baseline gap-1.5">
        <span className="text-ui font-medium text-txt-primary truncate">
          {displayName}
        </span>
        {canonical.displayName && (
          <span className="font-mono text-label text-txt-tertiary truncate">
            @{canonical.username}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Full row for a DM conversation item in the DM search bar dropdown.
 * For 1-on-1 DMs, routes the partner through useCanonicalUserView.
 * For group DMs, the group's picture is the shared AvatarStack.
 */
function DmSearchDmRow({ item, isSelected, selectedRef, onClick }: {
  item: DmItem;
  isSelected: boolean;
  selectedRef?: React.Ref<HTMLDivElement>;
  onClick: () => void;
}) {
  // For 1-on-1 DMs: canonicalize the single partner. For groups: pass through
  // unchanged (AvatarStack canonicalizes per slot).
  const rawPartner = !item.isGroup ? (item.otherMembers[0] ?? null) : null;
  // Call the hook unconditionally — pass a stable fallback (empty User shape)
  // for group DMs so hooks are always called the same number of times.
  const FALLBACK_USER = { id: '', username: '', createdAt: 0, isAdmin: false, replicatedInstances: [] } as unknown as User;
  const canonicalPartner = useCanonicalUserView(rawPartner ?? FALLBACK_USER, item.origin);
  const partner = rawPartner ? canonicalPartner : null;

  return (
    <div
      ref={isSelected ? selectedRef : undefined}
      onClick={onClick}
      className={resultRowClass(isSelected)}
    >
      {item.isGroup ? (
        <AvatarStack members={item.otherMembers} origin={item.origin} size={24} border="modal" iconUrl={item.dm.icon} />
      ) : (
        <Avatar
          src={partner?.avatar}
          name={partner?.displayName ?? parseFederatedUsername(partner?.username ?? '').baseName}
          size={24}
          status={partner?.status as 'online' | 'idle' | 'dnd' | 'offline' | undefined}
          userId={partner?.homeUserId ?? partner?.id}
          user={partner ?? undefined}
        />
      )}
      <span className="text-ui font-medium text-txt-primary truncate">{item.displayName}</span>
    </div>
  );
}

const MAX_RECENT = 8;
const SEARCH_DEBOUNCE = 300;

interface DmItem {
  type: 'dm';
  dm: DmChannel;
  /** The instance that issued the DM's member rows. */
  origin: string;
  displayName: string;
  otherMembers: DmChannel['members'];
  isGroup: boolean;
}

interface UserItem {
  type: 'user';
  user: UserSearchResult;
}

type ResultItem = DmItem | UserItem;

export function DmSearchBar() {
  const { t } = useTranslation(['dm', 'common']);
  const [active, setActive] = useState(false);
  const [query, setQuery] = useState('');
  const [userResults, setUserResults] = useState<UserSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const dmChannels = useSpaceStore((s) => s.dmChannels);
  const channelOriginMap = useSpaceStore((s) => s.channelOriginMap);
  const self = useSelfIdentity();
  const navigate = useNavigate();

  const anchorRef = useRef<HTMLDivElement>(null);
  const floatingRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  const { style } = useFloatingPosition(anchorRef, floatingRef, {
    placement: 'bottom',
    offset: 4,
    enabled: active,
  });

  // Build filtered DM items
  const dmItems = useMemo((): DmItem[] => {
    const q = query.toLowerCase().trim();
    return dmChannels
      .map((dm): DmItem | null => {
        const origin = channelOriginMap.get(dm.id) ?? '';
        const otherMembers = dm.members.filter(m => !isMine(m, origin, self));
        const isGroup = !!dm.ownerId;
        if (otherMembers.length === 0 && !isGroup) return null;
        const displayName = isGroup
          ? (otherMembers.length > 0
            ? otherMembers.map(m => m.displayName ?? parseFederatedUsername(m.username).baseName).join(', ')
            : t('dm:names.emptyGroup'))
          : otherMembers[0]?.displayName ?? otherMembers[0]?.username ?? '';
        return { type: 'dm', dm, origin, displayName, otherMembers, isGroup };
      })
      .filter((item): item is DmItem => {
        if (!item) return false;
        if (!q) return true;
        // Match against display name or any member username
        if (item.displayName.toLowerCase().includes(q)) return true;
        return item.otherMembers.some(m =>
          m.username.toLowerCase().includes(q) ||
          (m.displayName?.toLowerCase().includes(q) ?? false)
        );
      })
      .slice(0, MAX_RECENT);
  }, [dmChannels, channelOriginMap, query, self, t]);

  // De-duplicate user results against shown 1-on-1 DMs: the same person
  // (`userKey`), whichever instance's row each side holds. Results come from
  // the page's own instance.
  const filteredUserResults = useMemo((): UserItem[] => {
    const dmPeople = new Set<string>();
    for (const item of dmItems) {
      if (!item.isGroup && item.otherMembers.length === 1) {
        dmPeople.add(userKey(item.otherMembers[0]!, item.origin));
      }
    }
    return userResults
      .filter(u => !isMine(u, '', self) && !dmPeople.has(userKey(u, '')))
      .map(u => ({ type: 'user' as const, user: u }));
  }, [userResults, dmItems, self]);

  // Flat unified list
  const allItems = useMemo((): ResultItem[] => {
    return [...dmItems, ...filteredUserResults];
  }, [dmItems, filteredUserResults]);

  // Clamp selectedIndex when items change
  useEffect(() => {
    setSelectedIndex(prev => Math.min(prev, Math.max(0, allItems.length - 1)));
  }, [allItems.length]);

  // Scroll selected item into view
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Debounced user search
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    // People are found by username only (social.md, "Finding people").
    const username = usernameQueryOf(query);
    if (username === null) {
      setUserResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const users = await api.social.search(username);
        setUserResults(users);
      } catch {
        setUserResults([]);
      } finally {
        setIsSearching(false);
      }
    }, SEARCH_DEBOUNCE);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [query]);

  // Click outside handler
  useEffect(() => {
    if (!active) return;
    const handleClick = (e: MouseEvent) => {
      const anchor = anchorRef.current;
      const floating = floatingRef.current;
      if (anchor?.contains(e.target as Node)) return;
      if (floating?.contains(e.target as Node)) return;
      close();
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [active]);

  const open = useCallback(() => {
    setActive(true);
    setQuery('');
    setUserResults([]);
    setError('');
    setSelectedIndex(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const close = useCallback(() => {
    setActive(false);
    setQuery('');
    setUserResults([]);
    setError('');
  }, []);

  const selectItem = useCallback(async (item: ResultItem) => {
    setError('');
    if (item.type === 'dm') {
      close();
      useUIStore.getState().setShowDms(true);
      navigate(`/channels/@me/${item.dm.id}`);
    } else {
      try {
        const rowId = await openDirectMessage(item.user, '');
        close();
        useUIStore.getState().setShowDms(true);
        navigate(`/channels/@me/${rowId}`);
      } catch (err) {
        setError((err as Error).message || t('dm:search.createFailed'));
      }
    }
  }, [close, navigate, t]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, allItems.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = allItems[selectedIndex];
      if (item) selectItem(item);
    }
  }, [close, allItems, selectedIndex, selectItem]);

  // Compute dropdown width to match anchor
  const [dropdownWidth, setDropdownWidth] = useState(0);
  useEffect(() => {
    if (!active || !anchorRef.current) return;
    const update = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (rect) setDropdownWidth(layoutPixels(rect.width));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(anchorRef.current);
    return () => ro.disconnect();
  }, [active]);

  const showSections = allItems.length > 0 || isSearching || (query.trim().length >= 2 && !isSearching);

  const dropdown = active ? createPortal(
    <div
      ref={floatingRef}
      style={{ ...style, width: dropdownWidth > 0 ? dropdownWidth : undefined }}
      className="animate-fade-in"
    >
      <div className="glass rounded-lg max-h-[360px] overflow-y-auto scrollbar-thin py-1">
        {error && (
          <div className="px-3 py-2 text-txt-danger text-ui">{error}</div>
        )}

        {allItems.length === 0 && !isSearching && query.trim().length === 0 && dmItems.length === 0 && (
          <div className="px-3 py-4 text-center text-txt-tertiary text-ui">
            {t('dm:search.emptyHint')}
          </div>
        )}

        {/* DM conversations section */}
        {dmItems.length > 0 && (
          <>
            {query.trim().length >= 2 && (
              <div className="px-3 pt-1.5 pb-1 label-mono">
                {t('dm:search.conversations')}
              </div>
            )}
            {dmItems.map((item, i) => {
              const globalIndex = i;
              const isSelected = globalIndex === selectedIndex;
              return (
                <DmSearchDmRow
                  key={item.dm.id}
                  item={item}
                  isSelected={isSelected}
                  selectedRef={isSelected ? selectedRef : undefined}
                  onClick={() => selectItem(item)}
                />
              );
            })}
          </>
        )}

        {/* Users section */}
        {(filteredUserResults.length > 0 || (isSearching && query.trim().length >= 2)) && (
          <>
            <div className="px-3 pt-1.5 pb-1 label-mono">
              {t('dm:search.users')}
            </div>
            {isSearching && filteredUserResults.length === 0 && (
              <div className="px-3 py-2 text-center text-txt-tertiary text-ui">{t('dm:search.searching')}</div>
            )}
            {filteredUserResults.map((item, i) => {
              const globalIndex = dmItems.length + i;
              const isSelected = globalIndex === selectedIndex;
              return (
                <DmSearchUserRow
                  key={item.user.id}
                  user={item.user}
                  isSelected={isSelected}
                  selectedRef={isSelected ? selectedRef : undefined}
                  onClick={() => selectItem(item)}
                />
              );
            })}
          </>
        )}

        {/* No results */}
        {!isSearching && usernameQueryOf(query) !== null && allItems.length === 0 && (
          <div className="px-3 py-4 text-center text-txt-tertiary text-ui">{t('dm:search.noResults')}</div>
        )}
      </div>
      {/* i18n-check: allow-literal — what follows is the createPortal argument list, not JSX text */}
    </div>,
    document.body,
  ) : null;

  return (
    <div ref={anchorRef} className="flex-1 min-w-0">
      {active ? (
        <div className="flex h-8 flex-1 items-center gap-2 rounded-md border border-accent-primary bg-surface-input px-2.5 ring-1 ring-accent-primary/40">
          <Icon name="search" size={14} className="flex-shrink-0 text-txt-tertiary" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
            placeholder={t('dm:search.placeholder')}
            aria-label={t('dm:search.trigger')}
            className="input-embedded flex-1 min-w-0 text-ui py-[5px]"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={open}
          title={t('dm:search.trigger')}
          className="flex h-8 w-full items-center gap-2 rounded-md border border-border-soft bg-surface-input px-2.5 text-left text-ui text-txt-tertiary transition-colors hover:border-interactive-muted hover:text-txt-secondary active:bg-interactive-hover"
        >
          <Icon name="search" size={14} className="flex-shrink-0" />
          <span className="min-w-0 flex-1 truncate">{t('dm:search.trigger')}</span>
        </button>
      )}
      {dropdown}
    </div>
  );
}
