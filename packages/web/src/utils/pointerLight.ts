import { layoutPixels } from '../platform/interfaceScale';

/** What catches the pointer's light (globals.css): cards, the rows of every list, pills, outlined buttons. */
const LIT_BY_POINTER = '.spotlight, .surface-card, .nav-item, .list-row, .glass-pill, .btn-outline';

/**
 * The light that follows the pointer across a card or a row (`.spotlight`, `.surface-card`,
 * `.nav-item`, `.list-row`, `.glass-pill`, `.btn-outline` in globals.css). One listener for the
 * whole document, however many there are: it finds the nearest one under the pointer and tells it
 * where the pointer is, at most once a frame. A touch has no pointer resting anywhere, so it is left out.
 */
export function startPointerLight(): () => void {
  let frame = 0;
  let last: PointerEvent | null = null;

  const paint = () => {
    frame = 0;
    if (!last) return;
    const target = last.target;
    if (!(target instanceof Element)) return;
    const card = target.closest<HTMLElement>(LIT_BY_POINTER);
    if (!card) return;
    const box = card.getBoundingClientRect();
    card.style.setProperty('--pointer-x', `${layoutPixels(last.clientX - box.left)}px`);
    card.style.setProperty('--pointer-y', `${layoutPixels(last.clientY - box.top)}px`);
  };

  const onMove = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    last = event;
    if (!frame) frame = requestAnimationFrame(paint);
  };

  document.addEventListener('pointermove', onMove, { passive: true });
  return () => {
    document.removeEventListener('pointermove', onMove);
    if (frame) cancelAnimationFrame(frame);
  };
}
