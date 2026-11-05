import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFloatingPosition } from '../../hooks/useFloatingPosition';
import { usePortalContainer } from '../../hooks/usePortalContainer';
import { useUIStore } from '../../stores/uiStore';
import { TooltipBubble } from './TooltipBubble';

/** How long a mouse rests on a control before its name shows. */
export const TOOLTIP_DELAY_MS = 300;
/** A tooltip closed less than this long ago makes the next one show at once: reading along a toolbar. */
const WARM_MS = 500;

type Side = 'top' | 'right' | 'bottom' | 'left';

interface Tip {
  target: HTMLElement;
  name: string;
  /** A quieter second line: the text of the control's `aria-describedby`. */
  detail: string | null;
  /** A shortcut, as the control shows it (`data-tooltip-keys`, words split by spaces). */
  keys: string[];
  side: Side;
}

/** The control a pointer or focus is on, when it is one that takes a tooltip from this layer. */
export function tooltipControlOf(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  const control = node.closest<HTMLElement>('.icon-btn, [data-tooltip]');
  if (!control || control.getAttribute('data-tooltip') === 'off') return null;
  // A `Tooltip` of its own says more than a name: it is not doubled.
  if (control.closest('[data-tooltip-owner]')) return null;
  return control;
}

function textOfIds(ids: string | null): string {
  if (!ids) return '';
  return ids
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
    .filter(Boolean)
    .join(' ');
}

/** What the tooltip says: the control's accessible name, the one a screen reader reads. */
export function tooltipNameOf(control: HTMLElement): string {
  const label = control.getAttribute('aria-label')?.trim();
  if (label) return label;
  const labelled = textOfIds(control.getAttribute('aria-labelledby'));
  if (labelled) return labelled;
  // A mark that is not a control of its own (the gear inside a channel's row) names itself here.
  return control.getAttribute('data-tooltip')?.trim() ?? '';
}

function isShown(element: Element): boolean {
  return typeof element.checkVisibility === 'function' ? element.checkVisibility() : true;
}

/**
 * Whether a control shows words of its own (a letter in a text that is on screen; a count is not a
 * word, and what only a screen reader gets does not count): such a control needs no tooltip.
 */
export function showsWords(control: HTMLElement): boolean {
  const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || parent.closest('.sr-only') || !isShown(parent)) continue;
    if (/\p{L}/u.test(node.textContent ?? '')) return true;
  }
  return false;
}

function sideOf(control: HTMLElement): Side {
  const side = control.closest('[data-tooltip-side]')?.getAttribute('data-tooltip-side');
  return side === 'right' || side === 'bottom' || side === 'left' ? side : 'top';
}

function focusVisible(element: Element): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    return false;
  }
}

/**
 * One tooltip for the whole app (docs/systems/design-system.md, "Tooltips"). Every control that shows
 * only an icon names itself in `aria-label`, and that name appears beside it on the app's own bubble
 * when a mouse rests on it or the keyboard reaches it. Nothing is written or translated twice: the
 * words are the name a screen reader already reads, and a native `title` would only double them late
 * and in the system's look (a guard test keeps titles off these controls).
 *
 * A control takes part when it is an `.icon-btn` or carries `data-tooltip` (an icon-only control of
 * another shape: a composer button, an emoji, a swatch). `data-tooltip="off"` keeps one out, and so
 * does anything inside a `Tooltip` of its own. A control that shows words gets none, and neither does
 * one whose menu stands open (`aria-expanded="true"`). `aria-describedby` adds a quieter second line,
 * `data-tooltip-keys` a shortcut, and `data-tooltip-side` on the control or around it a side (a bar at
 * the top of the window asks for "bottom").
 *
 * It answers a mouse after a short rest (at once when another one closed a moment ago) and a keyboard
 * focus that is `:focus-visible`; never a touch, a device without hover, or a phone. A press, Escape
 * (until the pointer leaves and comes back, WCAG 1.4.13), a scroll or the control leaving the page
 * hides it.
 */
export function TooltipLayer() {
  const isMobile = useUIStore((s) => s.isMobile);
  const portal = usePortalContainer();
  const [tip, setTip] = useState<Tip | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  anchorRef.current = tip?.target ?? null;
  const { style } = useFloatingPosition(anchorRef, bubbleRef, {
    placement: tip?.side ?? 'top',
    offset: 8,
    enabled: tip !== null,
    followAnchor: true,
  });

  useEffect(() => {
    if (isMobile) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let shown = false;
    let closedAt = 0;
    // The control the pointer or the focus is on, and one pressed or escaped: quiet until left.
    let current: HTMLElement | null = null;
    let quiet: HTMLElement | null = null;
    const noHover = typeof window.matchMedia === 'function' ? window.matchMedia('(hover: none)') : null;

    const hide = () => {
      clearTimeout(timer);
      timer = undefined;
      if (shown) closedAt = Date.now();
      shown = false;
      setTip(null);
    };
    const show = (control: HTMLElement) => {
      if (!control.isConnected || control !== current || control === quiet) return;
      if (control.getAttribute('aria-expanded') === 'true' || showsWords(control)) return;
      const name = tooltipNameOf(control);
      if (!name) return;
      const keys = control.getAttribute('data-tooltip-keys')?.trim();
      shown = true;
      setTip({
        target: control,
        name,
        detail: textOfIds(control.getAttribute('aria-describedby')) || null,
        keys: keys ? keys.split(/\s+/) : [],
        side: sideOf(control),
      });
    };
    const arm = (control: HTMLElement | null) => {
      if (control === current) return;
      // Leaving a control that was pressed or escaped lets it answer again next time.
      if (quiet === current) quiet = null;
      current = control;
      hide();
      if (!control) return;
      if (Date.now() - closedAt < WARM_MS) show(control);
      else timer = setTimeout(() => show(control), TOOLTIP_DELAY_MS);
    };

    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || noHover?.matches) return;
      arm(tooltipControlOf(event.target));
    };
    const onPointerOut = (event: PointerEvent) => {
      // Out of the window altogether.
      if (event.relatedTarget === null) arm(null);
    };
    const onPointerDown = () => {
      quiet = current;
      hide();
    };
    const onFocusIn = (event: FocusEvent) => {
      const control = tooltipControlOf(event.target);
      if (control && event.target instanceof Element && focusVisible(event.target)) arm(control);
    };
    const onFocusOut = (event: FocusEvent) => {
      if (tooltipControlOf(event.target) === current) arm(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const pressed = (event.key === 'Enter' || event.key === ' ') && current !== null && event.target === current;
      if (event.key === 'Escape' || pressed) {
        quiet = current;
        hide();
      }
    };
    const onScroll = () => { if (shown || timer) hide(); };

    document.addEventListener('pointerover', onPointerOver);
    document.addEventListener('pointerout', onPointerOut);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerover', onPointerOver);
      document.removeEventListener('pointerout', onPointerOut);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', onScroll, true);
      setTip(null);
    };
  }, [isMobile]);

  // A control that leaves the page (a toolbar that unmounts) takes its tooltip with it.
  useEffect(() => {
    if (!tip || typeof MutationObserver === 'undefined') return undefined;
    const observer = new MutationObserver(() => {
      if (!tip.target.isConnected) setTip(null);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [tip]);

  if (isMobile || !tip) return null;
  return createPortal(
    <TooltipBubble ref={bubbleRef} wrap style={{ ...style, zIndex: 400 }}>
      <span className="flex items-center gap-2">
        <span>{tip.name}</span>
        {tip.keys.length > 0 && (
          <span className="flex flex-shrink-0 items-center gap-0.5">
            {tip.keys.map((key) => <kbd key={key} className="kbd">{key}</kbd>)}
          </span>
        )}
      </span>
      {tip.detail && <span className="mt-0.5 block font-normal text-txt-secondary">{tip.detail}</span>}
    </TooltipBubble>,
    portal,
  );
}
