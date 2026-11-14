import { useLayoutEffect, useRef } from 'react';

/** The active row of a navigation list. */
const ACTIVE_ROW = ".nav-item[data-active='true'], .nav-item[aria-current='page']";
/** What can make the active element a different one. */
const WATCHED_ATTRIBUTES = ['data-active', 'aria-current', 'aria-checked'];

/** Spelled out, so the stylesheet's build can see they are in use. */
const VARIANT_CLASS = {
  row: 'sliding-mark-row',
  line: 'sliding-mark-line',
  pill: 'sliding-mark-pill',
  tile: 'sliding-mark-tile',
} as const;

interface Offset {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where `element` lies inside `list`, walking up the positioned parents. These are
 * layout pixels, the ones a transform inside the list is written in, whatever the
 * interface scale is and however far the list has scrolled. Null when it does not
 * lie inside the list, or takes up no room (a hidden panel).
 */
function offsetWithin(element: HTMLElement, list: HTMLElement): Offset | null {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = element;
  while (node && node !== list) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  if (node !== list || element.offsetWidth === 0) return null;
  return { x, y, width: element.offsetWidth, height: element.offsetHeight };
}

/**
 * The one mark of a list, which slides from the place you left to the place you
 * chose: a lit row, a line under a tab, the fill of a segment. It goes first inside
 * the element that scrolls or holds the list, which needs `.sliding-list`. It reads
 * which element is active from the DOM, so the rows go on saying `data-active` as
 * they always have, and it moves when they change, are added or removed, or the list
 * changes size. While it has a place, `data-marked` on the list turns off the row's
 * own highlight (globals.css), so a list where it finds nothing looks as it always does.
 */
export function SlidingMark({ variant, selector = ACTIVE_ROW }: {
  variant: keyof typeof VARIANT_CLASS;
  selector?: string;
}): React.JSX.Element {
  const markRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const mark = markRef.current;
    const list = mark?.parentElement;
    if (!mark || !list) return;
    let frame = 0;
    let settle = 0;

    const place = () => {
      frame = 0;
      const target = list.querySelector<HTMLElement>(selector);
      const at = target ? offsetWithin(target, list) : null;
      if (!at) {
        mark.dataset.on = 'false';
        mark.dataset.placed = 'false';
        delete list.dataset.marked;
        return;
      }
      mark.style.width = `${at.width}px`;
      mark.style.height = `${at.height}px`;
      mark.style.transform = `translate3d(${at.x}px, ${at.y}px, 0)`;
      mark.dataset.on = 'true';
      list.dataset.marked = 'true';
      // It arrives where it belongs without travelling; from then on it travels.
      if (mark.dataset.placed !== 'true') settle = requestAnimationFrame(() => { mark.dataset.placed = 'true'; });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };

    place();
    const changes = new MutationObserver(schedule);
    changes.observe(list, { subtree: true, childList: true, attributes: true, attributeFilter: WATCHED_ATTRIBUTES });
    const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    sizes?.observe(list);
    // A web font arriving moves everything in a row of tabs without changing the row's size.
    void document.fonts?.ready.then(schedule);

    return () => {
      changes.disconnect();
      sizes?.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(settle);
      frame = 1;
      delete list.dataset.marked;
    };
  }, [selector]);

  return <span ref={markRef} aria-hidden="true" data-sliding-mark="" data-placed="false" className={`sliding-mark ${VARIANT_CLASS[variant]}`} />;
}
