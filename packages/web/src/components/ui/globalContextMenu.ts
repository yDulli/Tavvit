import { useEffect } from 'react';
import i18n from '../../i18n';
import { useContextMenuStore, type ContextMenuItem } from '../../stores/contextMenuStore';
import { useUIStore } from '../../stores/uiStore';

// The right click everywhere (docs/systems/design-system.md, "Context menus").
// The browser's own menu never opens. An element with a menu of its own opens
// it from its onContextMenu handler; everything else gets the menu that fits
// what was clicked, or nothing at all on a plain surface:
//
//   a text field    Cut, Copy, Paste, Select all, and in the desktop app the
//                   spelling suggestions, which only the app can see
//   selected text   Copy
//   a link          Open link, Copy link
//
// Phones are left alone: a long press there belongs to the system's text
// selection and to useGlobalLongPress (ContextMenuRenderer).

type TextField = HTMLInputElement | HTMLTextAreaElement;

/** Input types that hold typed text and keep a selection (email and number keep none). */
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'password']);

/** How long a right click in a text field waits for the desktop app's answer. */
const DESKTOP_ANSWER_MS = 2_000;

interface Point { x: number; y: number }

/** A text field as it was at the right click: where its selection was, and how to put it back. */
interface EditTarget {
  readOnly: boolean;
  /** A password field: what it holds is never copied out, as in the browser's own menu. */
  secret: boolean;
  selectedText: string;
  /** Focus the field again and select what was selected, so a command acts where the person clicked. */
  restore: () => void;
  /** Replace the selection with `text` when the browser refuses `insertText`. */
  insert: (text: string) => void;
  selectAll: () => void;
}

function isTextField(element: Element): element is TextField {
  return element instanceof HTMLTextAreaElement
    || (element instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(element.type));
}

/** The text field a right click landed in, or null. */
function fieldOf(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const field = target.closest('input, textarea, [contenteditable]');
  if (!(field instanceof HTMLElement)) return null;
  if (isTextField(field)) return field;
  return field.isContentEditable ? field : null;
}

function textFieldTarget(field: TextField): EditTarget {
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? start;
  const direction = field.selectionDirection ?? 'none';
  const restore = () => {
    field.focus({ preventScroll: true });
    try { field.setSelectionRange(start, end, direction); } catch { /* a type that keeps no selection */ }
  };
  return {
    readOnly: field.readOnly || field.disabled,
    secret: field instanceof HTMLInputElement && field.type === 'password',
    selectedText: field.value.slice(start, end),
    restore,
    insert: (text) => {
      // The value setter React listens through, then the event it reacts to,
      // so a controlled field takes the new text as if it had been typed.
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')?.set;
      setter?.call(field, field.value.slice(0, start) + text + field.value.slice(end));
      const caret = start + text.length;
      try { field.setSelectionRange(caret, caret); } catch { /* a type that keeps no selection */ }
      field.dispatchEvent(new Event('input', { bubbles: true }));
    },
    selectAll: () => {
      field.focus({ preventScroll: true });
      field.select();
    },
  };
}

function editableTarget(field: HTMLElement): EditTarget {
  const selection = window.getSelection();
  const range = selection && selection.rangeCount > 0 && field.contains(selection.anchorNode)
    ? selection.getRangeAt(0).cloneRange()
    : null;
  const restore = () => {
    field.focus({ preventScroll: true });
    if (!range) return;
    const current = window.getSelection();
    current?.removeAllRanges();
    current?.addRange(range);
  };
  return {
    readOnly: false,
    secret: false,
    selectedText: range?.toString() ?? '',
    restore,
    insert: (text) => {
      restore();
      const current = window.getSelection();
      if (!current || current.rangeCount === 0) return;
      const at = current.getRangeAt(0);
      at.deleteContents();
      at.insertNode(document.createTextNode(text));
      at.collapse(false);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    },
    selectAll: () => {
      field.focus({ preventScroll: true });
      const current = window.getSelection();
      if (!current) return;
      const all = document.createRange();
      all.selectNodeContents(field);
      current.removeAllRanges();
      current.addRange(all);
    },
  };
}

function targetOf(field: HTMLElement): EditTarget {
  return isTextField(field) ? textFieldTarget(field) : editableTarget(field);
}

function pasteShortcut(): string {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? '⌘V' : 'Ctrl+V';
}

function toast(message: string): void {
  useUIStore.getState().addToast(message, 'warning');
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Where a menu opens: at the pointer, or under the element for the menu key (reported at 0,0). */
function positionOf(event: MouseEvent, fallback: Element | null): Point {
  if (event.clientX !== 0 || event.clientY !== 0 || !fallback) return { x: event.clientX, y: event.clientY };
  const rect = fallback.getBoundingClientRect();
  return { x: rect.left + 16, y: rect.bottom };
}

// ── The browser's text field menu ─────────────────────────────────────────

async function paste(target: EditTarget): Promise<void> {
  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    // The browser did not let the page read the clipboard (it asks once, and
    // Firefox only lets the keyboard paste); the keyboard always can.
    useUIStore.getState().addToast(i18n.t('common:contextMenu.pasteBlocked', { shortcut: pasteShortcut() }), 'info');
    return;
  }
  target.restore();
  if (!document.execCommand('insertText', false, text)) target.insert(text);
}

function textFieldItems(target: EditTarget): ContextMenuItem[] {
  const canTake = !target.secret && target.selectedText.length > 0;
  return [
    {
      type: 'action', key: 'cut', label: i18n.t('common:contextMenu.cut'),
      disabled: !canTake || target.readOnly,
      onClick: () => {
        target.restore();
        if (!document.execCommand('cut')) toast(i18n.t('common:contextMenu.clipboardFailed'));
      },
    },
    {
      type: 'action', key: 'copy', label: i18n.t('common:actions.copy'),
      disabled: !canTake,
      onClick: () => {
        target.restore();
        if (document.execCommand('copy')) return;
        void writeClipboard(target.selectedText).then((ok) => { if (!ok) toast(i18n.t('common:contextMenu.clipboardFailed')); });
      },
    },
    {
      type: 'action', key: 'paste', label: i18n.t('common:contextMenu.paste'),
      disabled: target.readOnly,
      onClick: () => { void paste(target); },
    },
    { type: 'separator', key: 'edit-separator' },
    {
      type: 'action', key: 'select-all', label: i18n.t('common:contextMenu.selectAll'),
      onClick: () => target.selectAll(),
    },
  ];
}

// ── The desktop app's text field menu ─────────────────────────────────────

function desktopEditItems(field: HTMLElement, params: DesktopEditMenuParams, bridge: DesktopEditBridge): ContextMenuItem[] {
  // Read now, not at the click: Chromium selects the misspelled word under the
  // pointer while it prepares the menu, after the page saw the event.
  const target = targetOf(field);
  const run = (command: DesktopEditCommand) => () => {
    target.restore();
    bridge.editCommand(command);
  };
  const items: ContextMenuItem[] = [];
  if (params.misspelledWord) {
    if (params.suggestions.length === 0) {
      items.push({ type: 'action', key: 'no-suggestions', label: i18n.t('common:contextMenu.noSuggestions'), disabled: true, onClick: () => undefined });
    }
    params.suggestions.forEach((suggestion, index) => {
      items.push({
        type: 'action', key: `suggestion-${index}`, label: suggestion,
        onClick: () => {
          target.restore();
          bridge.replaceMisspelling(suggestion);
        },
      });
    });
    items.push(
      {
        type: 'action', key: 'add-to-dictionary', label: i18n.t('common:contextMenu.addToDictionary'),
        onClick: () => bridge.addToDictionary(params.misspelledWord),
      },
      { type: 'separator', key: 'spelling-separator' },
    );
  }
  items.push(
    { type: 'action', key: 'cut', label: i18n.t('common:contextMenu.cut'), disabled: !params.canCut || target.secret, onClick: run('cut') },
    { type: 'action', key: 'copy', label: i18n.t('common:actions.copy'), disabled: !params.canCopy || target.secret, onClick: run('copy') },
    { type: 'action', key: 'paste', label: i18n.t('common:contextMenu.paste'), disabled: !params.canPaste, onClick: run('paste') },
    { type: 'separator', key: 'edit-separator' },
    { type: 'action', key: 'select-all', label: i18n.t('common:contextMenu.selectAll'), disabled: !params.canSelectAll, onClick: run('selectAll') },
  );
  return items;
}

interface DesktopEditBridge {
  onEditContextMenu: (callback: (params: DesktopEditMenuParams) => void) => () => void;
  editCommand: (command: DesktopEditCommand) => void;
  replaceMisspelling: (word: string) => void;
  addToDictionary: (word: string) => void;
}

/** The desktop app's edit menu bridge, when this app is new enough to have one. */
function desktopEditBridge(): DesktopEditBridge | null {
  const bridge = typeof window === 'undefined' ? undefined : window.backspace;
  if (!bridge?.onEditContextMenu || !bridge.editCommand || !bridge.replaceMisspelling || !bridge.addToDictionary) return null;
  return {
    onEditContextMenu: bridge.onEditContextMenu,
    editCommand: bridge.editCommand,
    replaceMisspelling: bridge.replaceMisspelling,
    addToDictionary: bridge.addToDictionary,
  };
}

// ── Everything else ───────────────────────────────────────────────────────

/** Links the menu opens: web pages (the desktop app hands them to the browser). */
const LINK_PROTOCOLS = new Set(['http:', 'https:']);

function fallbackItems(target: EventTarget | null): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  const selected = window.getSelection()?.toString() ?? '';
  if (selected.trim().length > 0) {
    items.push({
      type: 'action', key: 'copy-selection', label: i18n.t('common:actions.copy'),
      onClick: () => { void writeClipboard(selected).then((ok) => { if (!ok) toast(i18n.t('common:contextMenu.clipboardFailed')); }); },
    });
  }
  const anchor = target instanceof Element ? target.closest('a[href]') : null;
  if (anchor instanceof HTMLAnchorElement) {
    let href: URL | null = null;
    try { href = new URL(anchor.href); } catch { href = null; }
    if (href && LINK_PROTOCOLS.has(href.protocol)) {
      const url = href.href;
      items.push(
        { type: 'separator', key: 'link-separator' },
        {
          type: 'action', key: 'open-link', label: i18n.t('chat:menu.openLink'),
          onClick: () => { window.open(url, '_blank', 'noopener,noreferrer'); },
        },
        {
          type: 'action', key: 'copy-link', label: i18n.t('chat:menu.copyLink'),
          onClick: () => {
            void writeClipboard(url).then((ok) => {
              if (ok) useUIStore.getState().addToast(i18n.t('chat:menu.linkCopied'), 'success', 2000);
              else toast(i18n.t('chat:menu.linkCopyFailed'));
            });
          },
        },
      );
    }
  }
  return items;
}

/**
 * Installs the right-click rules above. Two listeners: one in the capture
 * phase, before any element sees the event, which keeps the browser's menu
 * shut (and remembers which menu was open), and one at the document, after
 * every element's own handler, which opens the fallback menu only when no
 * element opened one of its own.
 */
export function useGlobalContextMenu(isMobile: boolean): void {
  useEffect(() => {
    if (isMobile) return;
    const bridge = desktopEditBridge();
    let menuBefore: unknown = null;
    let pendingField: { field: HTMLElement; position: Point; at: number } | null = null;

    const onCapture = (event: MouseEvent) => {
      menuBefore = useContextMenuStore.getState().menu;
      // In the desktop app a text field's menu waits for the app, which only
      // reports a right click the page did not cancel (and draws nothing itself).
      if (bridge && fieldOf(event.target)) return;
      event.preventDefault();
    };

    const onBubble = (event: MouseEvent) => {
      // An element opened its own menu for this click.
      if (useContextMenuStore.getState().menu !== menuBefore) return;
      const field = fieldOf(event.target);
      if (field) {
        const position = positionOf(event, field);
        if (bridge) {
          pendingField = { field, position, at: performance.now() };
          return;
        }
        event.preventDefault();
        useContextMenuStore.getState().open(position, textFieldItems(targetOf(field)));
        return;
      }
      event.preventDefault();
      const items = fallbackItems(event.target);
      if (items.length === 0) return;
      useContextMenuStore.getState().open(positionOf(event, event.target instanceof Element ? event.target : null), items);
    };

    window.addEventListener('contextmenu', onCapture, { capture: true });
    document.addEventListener('contextmenu', onBubble);
    let stopDesktop: (() => void) | undefined;
    if (bridge) {
      stopDesktop = bridge.onEditContextMenu((params) => {
        const pending = pendingField;
        pendingField = null;
        if (!pending || performance.now() - pending.at > DESKTOP_ANSWER_MS || !pending.field.isConnected) return;
        useContextMenuStore.getState().open(pending.position, desktopEditItems(pending.field, params, bridge));
      });
    }
    return () => {
      window.removeEventListener('contextmenu', onCapture, { capture: true });
      document.removeEventListener('contextmenu', onBubble);
      stopDesktop?.();
    };
  }, [isMobile]);
}
