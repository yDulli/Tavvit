import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { describeError } from '../../i18n/errors';
import { useQuickSwitcherStore } from '../../stores/quickSwitcherStore';
import { useUIStore } from '../../stores/uiStore';
import { openUserSettings } from '../../utils/openUserSettings';
import { usePortalContainer } from '../../hooks/usePortalContainer';
import { useSwitcherItems } from '../../hooks/useSwitcherItems';
import { openDirectMessage } from '../../utils/openDirectMessage';
import { rankSwitcherItems, type SwitcherItem, type SwitcherKind } from '../../utils/quickSwitcher';
import { ChannelIcon } from './ChannelIcon';
import { Icon, type IconName } from './Icon';

const RESULT_LIMIT = 12;

const KIND_LABEL_KEY = {
  dm: 'switcher.kind.dm',
  friend: 'switcher.kind.friend',
  space: 'switcher.kind.space',
  channel: 'switcher.kind.channel',
  page: 'switcher.kind.page',
} as const satisfies Record<SwitcherKind, string>;

const KIND_ICON = {
  dm: 'message',
  friend: 'user',
  space: 'grid',
  channel: 'hash',
  page: 'compass',
} as const satisfies Record<SwitcherKind, IconName>;

/** Ctrl+K, or Cmd+K on a Mac. Not while a text composition (IME) is in progress. */
function isSwitcherShortcut(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
    && event.key.toLowerCase() === 'k' && !event.isComposing;
}

/**
 * Mounted once in the app. Listens for Ctrl/Cmd+K anywhere and shows the
 * switcher; the dialog itself is only built while it is open.
 */
export function QuickSwitcher(): React.ReactElement | null {
  const open = useQuickSwitcherStore((s) => s.open);
  const toggle = useQuickSwitcherStore((s) => s.toggle);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSwitcherShortcut(event)) return;
      // Browsers use Ctrl+K for their own search box; inside the app it is ours.
      event.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle]);

  return open ? <QuickSwitcherDialog /> : null;
}

function QuickSwitcherDialog(): React.ReactElement {
  const { t } = useTranslation(['common', 'social']);
  const navigate = useNavigate();
  const container = usePortalContainer();
  const setOpen = useQuickSwitcherStore((s) => s.setOpen);
  const isMobile = useUIStore((s) => s.isMobile);
  const { items, friends } = useSwitcherItems();

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const returnFocusTo = useRef<Element | null>(document.activeElement);

  const results = useMemo(() => rankSwitcherItems(items, query, RESULT_LIMIT), [items, query]);
  const active = Math.min(selected, Math.max(0, results.length - 1));

  const close = useCallback(() => setOpen(false), [setOpen]);

  useEffect(() => {
    inputRef.current?.focus();
    const previous = returnFocusTo.current;
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView?.({ block: 'nearest' });
  }, [active, results]);

  /** The mobile shell is driven by its own tabs and screens, not by the address alone. */
  const goTo = useCallback((path: string) => {
    const ui = useUIStore.getState();
    if (isMobile) {
      if (path === '/friends') { ui.pushMobileScreen('friends'); return; }
      if (path === '/about') { ui.pushMobileScreen('about'); return; }
      if (path === '/explore') { ui.pushMobileScreen('explore'); return; }
      if (path === '/inbox') { ui.pushMobileScreen('inbox'); return; }
      if (path === '/channels/@me') { ui.setMobileTab('dms'); navigate(path); return; }
      if (/^\/channels\/[^/]+$/.test(path)) { ui.setMobileTab('spaces'); }
    }
    navigate(path);
  }, [isMobile, navigate]);

  const choose = useCallback(async (item: SwitcherItem) => {
    close();
    switch (item.target.type) {
      case 'route':
        goTo(item.target.path);
        return;
      case 'settings':
        openUserSettings();
        return;
      case 'friend': {
        const friend = friends.get(item.target.key);
        if (!friend) return;
        try {
          const dmId = await openDirectMessage(friend, friend._instanceOrigin);
          goTo(`/channels/@me/${dmId}`);
        } catch (error) {
          useUIStore.getState().addToast(t('social:sendMessage.failed', { reason: describeError(error) }), 'warning');
        }
      }
    }
  }, [close, friends, goTo, t]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      // This one and no more: a dialog under the switcher stays open.
      event.stopPropagation();
      close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelected(results.length === 0 ? 0 : (active + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected(results.length === 0 ? 0 : (active - 1 + results.length) % results.length);
    } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      const item = results[active];
      if (item) void choose(item);
    }
  };

  const optionId = (index: number) => `${listId}-option-${index}`;

  return createPortal(
    <div
      className="modal-scrim fixed inset-0 z-[300] flex items-start justify-center px-4 animate-fade-in"
      style={{ paddingTop: 'max(calc(12 * var(--app-vh)), var(--safe-top))' }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('common:switcher.title')}
        className="w-full max-w-xl overflow-hidden rounded-lg glass-modal"
      >
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={results.length > 0 ? optionId(active) : undefined}
          aria-autocomplete="list"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setSelected(0); }}
          onKeyDown={onKeyDown}
          placeholder={t('common:switcher.placeholder')}
          autoComplete="off"
          spellCheck={false}
          className="input-embedded w-full border-b border-border-hard px-4 py-3 text-lead"
        />

        {results.length > 0 ? (
          <ul ref={listRef} id={listId} role="listbox" className="max-h-[calc(50*var(--app-vh))] overflow-y-auto p-1.5">
            {results.map((item, index) => (
              <li
                key={item.id}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                onMouseMove={() => setSelected(index)}
                onClick={() => void choose(item)}
                className={`flex h-11 cursor-pointer items-center gap-3 rounded-md px-3 ${
                  index === active ? 'bg-interactive-selected' : ''
                }`}
              >
                {item.channel ? (
                  <ChannelIcon type={item.channel.type} icon={item.channel.icon} size={18} className="flex-shrink-0 text-txt-tertiary" />
                ) : (
                  <Icon name={KIND_ICON[item.kind]} size={18} className="flex-shrink-0 text-txt-tertiary" />
                )}
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-ui leading-[18px] text-txt-primary ${item.unread ? 'font-semibold' : 'font-medium'}`}>
                    {item.label}
                  </span>
                  {item.detail && <span className="block truncate text-meta leading-4 text-txt-tertiary">{item.detail}</span>}
                </span>
                {item.unread && <span aria-hidden="true" className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-txt-primary" />}
                <span className="flex-shrink-0 label-mono">
                  {t(`common:${KIND_LABEL_KEY[item.kind]}`)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p id={listId} role="status" className="px-4 py-8 text-center text-ui text-txt-tertiary [overflow-wrap:anywhere]">
            {t('common:switcher.noResults', { query: query.trim() })}
          </p>
        )}

        {!isMobile && (
          <div className="border-t border-border-hard px-4 py-2 text-label text-txt-tertiary">
            {t('common:switcher.hint')}
          </div>
        )}
      </div>
    </div>,
    container,
  );
}
