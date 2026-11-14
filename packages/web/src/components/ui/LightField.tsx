import { useEffect, useRef } from 'react';
import { useAppearanceStore } from '../../stores/appearanceStore';

/**
 * The moving light of the "Schwarzlicht" look (docs/systems/design-system.md, "Light"): bands of
 * fine light threads that flow like fabric in a breeze, white and a cooler grey. A canvas, thirty
 * frames a second, paused while off screen or in a hidden tab. It is decoration and nothing else:
 * hidden from assistive technology, behind the content, taking no pointer. With Reduce motion (the
 * person's setting or the system's) it draws one still frame; with the light switched off (Settings,
 * Appearance), under higher contrast and in forced colours the stylesheet hides it and nothing is drawn.
 */

interface Band {
  /** Vertical centre as a share of the height. */
  y: number;
  amplitude: number;
  /** The band's light as channels: white, or the grey of the counter-light. */
  light: string;
  speed: number;
  phase: number;
}

export type LightIntensity = 'hero' | 'quiet';

const BANDS: Record<LightIntensity, readonly Band[]> = {
  // The pages outside the app (signing in, an invite, the download): three bright bands.
  hero: [
    { y: 0.58, amplitude: 0.11, light: '242 242 242', speed: 0.22, phase: 0 },
    { y: 0.7, amplitude: 0.08, light: '158 158 158', speed: 0.16, phase: 2.1 },
    { y: 0.38, amplitude: 0.07, light: '242 242 242', speed: 0.12, phase: 4.2 },
  ],
  // Behind the opening of a page of the app: one dim band.
  quiet: [{ y: 0.6, amplitude: 0.16, light: '242 242 242', speed: 0.14, phase: 1.3 }],
};

/** Threads per band: many thin lines with a soft falloff read as one fabric of light. */
const THREADS = 22;
/** Frames per second: the light drifts, it never needs sixty. */
const FPS = 30;

export function LightField({ intensity = 'hero', className = '' }: { intensity?: LightIntensity; className?: string }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduceMotion = useAppearanceStore((s) => s.reduceMotion);
  const light = useAppearanceStore((s) => s.light);
  const contrast = useAppearanceStore((s) => s.contrast);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || light === 'off' || contrast === 'high') return undefined;
    const still = reduceMotion || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
    const bands = BANDS[intensity];
    let pen: CanvasRenderingContext2D | null = null;
    let width = 0;
    let height = 0;
    let frame = 0;
    let visible = true;
    let last = 0;

    /** Takes the canvas's size, and its pen the first time there is something to draw on. */
    const measure = (): boolean => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      if (width === 0 || height === 0) return false;
      pen ??= canvas.getContext('2d');
      if (!pen) return false;
      const ratio = Math.min(1.5, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      pen.setTransform(ratio, 0, 0, ratio, 0, 0);
      return true;
    };

    const draw = (time: number) => {
      if (!pen) return;
      const t = time / 1000;
      pen.clearRect(0, 0, width, height);
      pen.globalCompositeOperation = 'lighter';
      const step = Math.max(6, width / 180);
      for (const band of bands) {
        const base = band.y * height;
        const amplitude = band.amplitude * height;
        for (let thread = 0; thread < THREADS; thread += 1) {
          // Threads near the middle of the band are the brightest: a soft, fabric-like falloff.
          const offset = thread / (THREADS - 1) - 0.5;
          const alpha = (intensity === 'hero' ? 0.16 : 0.1) * Math.exp(-(offset * offset) * 10);
          pen.strokeStyle = `rgb(${band.light} / ${alpha.toFixed(3)})`;
          pen.lineWidth = 1;
          pen.beginPath();
          for (let x = -step; x <= width + step; x += step) {
            const u = x / Math.max(1, width);
            const y = base
              + offset * amplitude * 1.6
              + amplitude * Math.sin(u * 5.2 + t * band.speed * 2 + band.phase + offset * 1.4)
              + amplitude * 0.45 * Math.sin(u * 11.5 - t * band.speed * 3.1 + band.phase * 1.7 - offset * 2.2);
            if (x < 0) pen.moveTo(x, y);
            else pen.lineTo(x, y);
          }
          pen.stroke();
        }
      }
      pen.globalCompositeOperation = 'source-over';
    };

    const loop = (time: number) => {
      frame = window.requestAnimationFrame(loop);
      if (!visible || document.hidden || time - last < 1000 / FPS) return;
      last = time;
      draw(time);
    };

    const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (measure()) draw(still ? 4000 : performance.now());
    });
    sizes?.observe(canvas);
    const sight = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
    });
    sight?.observe(canvas);

    if (measure()) draw(4000);
    if (!still) frame = window.requestAnimationFrame(loop);
    return () => {
      window.cancelAnimationFrame(frame);
      sizes?.disconnect();
      sight?.disconnect();
    };
  }, [intensity, reduceMotion, light, contrast]);

  return <canvas ref={canvasRef} aria-hidden="true" data-intensity={intensity} className={`light-field ${className}`} />;
}
