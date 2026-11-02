/**
 * Whether things may move: the person's own setting (Settings, Appearance) and
 * their system's. The stylesheet answers this by itself for what it animates; this
 * is for animation started from code.
 */
export function motionAllowed(): boolean {
  if (document.documentElement.dataset.motion === 'reduce') return false;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches !== true;
}
