import { useLayoutEffect, useRef, type RefObject } from 'react';
import { motionAllowed } from '../utils/motion';

const ENTRANCE: Keyframe[] = [
  { opacity: 0, transform: 'translateY(6px)' },
  { opacity: 1, transform: 'none' },
];
const ENTRANCE_MS = 340;
const ENTRANCE_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';

/**
 * Plays a short entrance on `ref` whenever `place` changes, and not on the first
 * render. The element stays mounted: a key would throw away what is in it (a message
 * list and its scroll position) just to replay an animation. It leaves nothing behind
 * when it ends, so what is inside can still be `fixed` to the window.
 */
export function usePlaceEntrance(ref: RefObject<HTMLElement>, place: string | null): void {
  const last = useRef(place);
  useLayoutEffect(() => {
    if (last.current === place) return;
    last.current = place;
    const element = ref.current;
    if (!element || typeof element.animate !== 'function' || !motionAllowed()) return;
    element.animate(ENTRANCE, { duration: ENTRANCE_MS, easing: ENTRANCE_EASING });
  }, [place, ref]);
}
