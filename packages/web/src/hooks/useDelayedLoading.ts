import { useState, useEffect, useRef } from 'react';

/**
 * Gates a loading boolean behind a delay threshold to prevent skeleton flicker.
 * - Shows nothing for the first `threshold` ms (default 200)
 * - Once shown, keeps skeleton visible for at least `minDisplay` ms (default 300)
 *
 * Both effects follow `isLoading` and `show` together. The skeleton can appear in the same moment
 * the loading ends (the threshold timer's update and the store's land in one turn, and React
 * applies the store's first): an effect that followed `isLoading` alone saw "done" while nothing
 * was shown yet, never ran again once the skeleton did show, and left it on screen for good, its
 * shimmer running.
 */
export function useDelayedLoading(
  isLoading: boolean,
  options?: { threshold?: number; minDisplay?: number },
): boolean {
  const threshold = options?.threshold ?? 200;
  const minDisplay = options?.minDisplay ?? 300;

  const [show, setShow] = useState(false);
  // When the skeleton appeared: stamped once per showing, so loading that stops and starts again
  // while it shows does not push its end further out.
  const shownAtRef = useRef(0);

  // Appear once loading has lasted `threshold`.
  useEffect(() => {
    if (!isLoading || show) return undefined;
    const timer = setTimeout(() => {
      shownAtRef.current = Date.now();
      setShow(true);
    }, threshold);
    return () => clearTimeout(timer);
  }, [isLoading, show, threshold]);

  // Go once loading is over, after at least `minDisplay` on screen.
  useEffect(() => {
    if (isLoading || !show) return undefined;
    const remaining = minDisplay - (Date.now() - shownAtRef.current);
    if (remaining <= 0) {
      setShow(false);
      return undefined;
    }
    const timer = setTimeout(() => setShow(false), remaining);
    return () => clearTimeout(timer);
  }, [isLoading, show, minDisplay]);

  return show;
}
