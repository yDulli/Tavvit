import { useEffect, useRef } from 'react';
import { layoutPixels } from '../../platform/interfaceScale';
import { useAppearanceStore } from '../../stores/appearanceStore';

/** What the ring of light opens over: everything one can press or type into. */
const PRESSABLE = 'a, button, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="switch"], [role="radio"], [role="checkbox"], input, select, textarea, summary';

/**
 * The ring of light that trails the pointer, as on Showomat (docs/systems/design-system.md,
 * "Light"): a soft ring that follows a mouse a breath behind it and opens up over anything that can
 * be pressed. Mounted once in App. The cursor itself stays: this is light, not a replacement, and
 * it takes no pointer and no part in what a screen reader reads.
 *
 * It rests when the pointer does (no frame is asked for while nothing moves), and it is not there
 * at all on a touch screen, with Reduce motion, with the light switched off, under higher contrast
 * or in forced colours.
 */
export function PointerAura(): React.JSX.Element {
  const ring = useRef<HTMLDivElement>(null);
  const reduceMotion = useAppearanceStore((s) => s.reduceMotion);
  const light = useAppearanceStore((s) => s.light);
  const contrast = useAppearanceStore((s) => s.contrast);

  useEffect(() => {
    const element = ring.current;
    if (!element || reduceMotion || light === 'off' || contrast === 'high') return undefined;
    if (typeof window.matchMedia !== 'function') return undefined;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    let x = -200;
    let y = -200;
    let ax = x;
    let ay = y;
    let active = false;
    let frame = 0;

    const tick = () => {
      ax += (x - ax) * 0.2;
      ay += (y - ay) * 0.2;
      element.style.transform = `translate(${ax}px, ${ay}px) translate(-50%, -50%) scale(${active ? 1.65 : 1})`;
      element.dataset.active = active ? 'true' : 'false';
      // Rest once the ring has caught up: nothing is drawn while the pointer is still.
      frame = Math.abs(x - ax) + Math.abs(y - ay) > 0.1 ? window.requestAnimationFrame(tick) : 0;
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      x = layoutPixels(event.clientX);
      y = layoutPixels(event.clientY);
      const target = event.target instanceof Element ? event.target : null;
      active = Boolean(target?.closest(PRESSABLE));
      element.style.opacity = '1';
      if (!frame) frame = window.requestAnimationFrame(tick);
    };
    const onLeave = () => {
      element.style.opacity = '0';
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      element.style.opacity = '0';
    };
  }, [reduceMotion, light, contrast]);

  return <div ref={ring} aria-hidden="true" className="pointer-aura" />;
}
