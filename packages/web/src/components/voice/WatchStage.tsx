import { useLayoutEffect, useRef } from 'react';
import { useWatchStore } from '../../stores/watchStore';

/**
 * The place in the call's view the video of watching together shows (docs/systems/watch-together.md).
 * It holds no player: the one player lives in `WatchPlayerHost`, which never unmounts while the call
 * watches something and lies over this place, so the video goes on, unbroken, when the person opens
 * another channel (it floats then) and comes back.
 */
export function WatchStage({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  // Before the view is painted, so the player is over this place from its first frame.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    useWatchStore.getState().setSlot(element);
    return () => {
      // Another view may have put its own place in meanwhile (the phone's call screen over the desktop's).
      if (useWatchStore.getState().slot === element) useWatchStore.getState().setSlot(null);
    };
  }, []);

  return <div ref={ref} data-watch-slot="" className={className} />;
}
