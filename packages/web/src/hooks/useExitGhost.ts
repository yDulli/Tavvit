import { useLayoutEffect, type RefObject } from 'react';
import { motionAllowed } from '../utils/motion';

/** What a copy must not bring along: it would load or play again, or come out blank. */
const NOT_COPIED = 'iframe, video, audio, object, embed, canvas';
/** Longer than any of the animations in `.modal-leaving`, which hold their last frame. */
const GONE_AFTER_MS = 320;
/** What can have been scrolled. A copy starts at the top; this keeps it where the dialog was. */
const SCROLLERS = '[class*="overflow-"]';

function leaveAsGhost(surface: HTMLElement, parent: HTMLElement, offsets: ReadonlyMap<number, number>): void {
  const ghost = surface.cloneNode(true) as HTMLElement;
  const scrollers = ghost.querySelectorAll<HTMLElement>(SCROLLERS);
  const restored = [...offsets].map(([index, top]) => [scrollers[index], top] as const);
  ghost.querySelectorAll(NOT_COPIED).forEach((node) => node.remove());
  ghost.removeAttribute('id');
  ghost.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  ghost.classList.add('modal-leaving');
  parent.appendChild(ghost);
  for (const [scroller, top] of restored) {
    if (scroller) scroller.scrollTop = top;
  }
  window.setTimeout(() => ghost.remove(), GONE_AFTER_MS);
}

/**
 * Lets a dialog leave the way it came, whoever closes it and however. A dialog is
 * often unmounted by its parent the moment its state goes away, and what it shows
 * goes with that state, so keeping it mounted to animate it out would leave an empty
 * box on the screen. Instead, as it unmounts, an inert copy of what it last looked
 * like takes its place for the length of the animation. The copy answers nothing and
 * is hidden from assistive technology; the real dialog is gone at once.
 *
 * `ref` is the dialog's outermost element, the one holding `.modal-scrim` and
 * `.modal-panel` (or `.sheet-panel`), or carrying `.modal-whole` to fade as one.
 */
export function useExitGhost(ref: RefObject<HTMLElement>): void {
  useLayoutEffect(() => {
    const surface = ref.current;
    return () => {
      const parent = surface?.parentElement;
      if (!surface || !parent || typeof surface.getAnimations !== 'function' || !motionAllowed()) return;
      // Read now, while it is on the page; a detached element has no scroll position.
      const offsets = new Map<number, number>();
      surface.querySelectorAll<HTMLElement>(SCROLLERS).forEach((scroller, index) => {
        if (scroller.scrollTop > 0) offsets.set(index, scroller.scrollTop);
      });
      // Only a dialog that really went. React's strict mode runs this right after mounting
      // too, in development, and then the element is still on the page.
      queueMicrotask(() => {
        if (!surface.isConnected) leaveAsGhost(surface, parent, offsets);
      });
    };
  }, [ref]);
}
