import React, { useEffect, useRef, useState } from 'react';

/**
 * The top of a space's channel column when the space has a banner (docs/systems/spaces.md, "The
 * banner"): the picture as the owner framed it (16:9), the column's bar laid over its top on a shade,
 * and both inside what scrolls, so the picture slides away under the bar as the channels scroll. Once
 * it has gone the bar is the column's own again, with its surface, light and hairline
 * (`.panel-bar-over`). Under higher contrast the bar never lies over the picture.
 *
 * A fragment, not a wrapper: a sticky bar sticks only as a direct child of the scroller. Whether the
 * bar lies over the picture comes from a mark at the picture's foot less the bar's height, watched
 * against the scroller, so no pixel is counted here and every sidebar width and interface scale works.
 * Without `IntersectionObserver` (tests) the bar is solid.
 */
export function SpaceBannerHeader({ src, onError, scrollRef, barClassName, bandClassName = '', children }: {
  src: string;
  onError: () => void;
  /** The column's scroller: the bar sticks to it, and the mark is watched against it. */
  scrollRef: React.RefObject<HTMLElement | null>;
  barClassName: string;
  bandClassName?: string;
  /** The bar's content, told whether it lies over the picture now, when its words and marks are drawn in the primary colour. */
  children: (overBanner: boolean) => React.ReactNode;
}) {
  const mark = useRef<HTMLSpanElement>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    const root = scrollRef.current;
    const target = mark.current;
    if (!root || !target || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setOver(entry.boundingClientRect.top >= (entry.rootBounds?.top ?? 0));
    }, { root });
    observer.observe(target);
    return () => observer.disconnect();
  }, [scrollRef, src]);

  return (
    <>
      <div className={`panel-bar panel-bar-over ${barClassName}`} data-over-banner={over ? 'true' : 'false'}>
        {children(over)}
      </div>
      <div aria-hidden="true" className={`space-banner ${bandClassName}`}>
        <img src={src} alt="" decoding="async" draggable={false} onError={onError} />
        <span ref={mark} className="space-banner-mark" />
      </div>
    </>
  );
}
