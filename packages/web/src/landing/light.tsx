import React, { useContext, useEffect, useRef } from 'react';
import type { CssVars } from './parts';
import { MotionContext } from './visuals';

/**
 * The light of the product page (docs/systems/landing.md, "Design"), as on Showomat: a field of fine
 * light threads that flow like fabric behind the opening, the name in polished chrome, and a ring of
 * light that trails the pointer. All of it is decoration: hidden from assistive technology, still
 * when the page does not move (`MotionContext`: the footer's switch, or the system asks for less
 * motion), and nothing here is needed to read or use the page.
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

const BANDS: readonly Band[] = [
  { y: 0.52, amplitude: 0.11, light: '242 242 242', speed: 0.22, phase: 0 },
  { y: 0.66, amplitude: 0.08, light: '158 158 158', speed: 0.16, phase: 2.1 },
  { y: 0.34, amplitude: 0.07, light: '242 242 242', speed: 0.12, phase: 4.2 },
];

/** Threads per band: many thin lines with a soft falloff read as one fabric of light. */
const THREADS = 22;
/** Frames per second: the light drifts, it never needs sixty. */
const FPS = 30;

/**
 * The moving ground of the opening: three bands of light threads on a canvas, thirty frames a second,
 * paused while off screen or in a hidden tab, and one still frame when the page does not move.
 */
export function LightField(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const moving = useContext(MotionContext);

  useEffect(() => {
    const canvas = canvasRef.current;
    // A canvas with no size (a document that lays nothing out) has nothing to draw on: no pen is asked for.
    if (!canvas || canvas.clientWidth === 0) return undefined;
    const pen = canvas.getContext('2d');
    if (!pen) return undefined;
    let width = 0;
    let height = 0;
    let frame = 0;
    let visible = true;
    let last = 0;

    const resize = () => {
      const ratio = Math.min(1.5, window.devicePixelRatio || 1);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      pen.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const draw = (time: number) => {
      const t = time / 1000;
      pen.clearRect(0, 0, width, height);
      pen.globalCompositeOperation = 'lighter';
      const step = Math.max(6, width / 180);
      for (const band of BANDS) {
        const base = band.y * height;
        const amplitude = band.amplitude * height;
        for (let thread = 0; thread < THREADS; thread += 1) {
          // Threads near the middle of the band are the brightest: a soft, fabric-like falloff.
          const offset = thread / (THREADS - 1) - 0.5;
          const alpha = 0.16 * Math.exp(-(offset * offset) * 10);
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

    resize();
    const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      resize();
      draw(performance.now());
    });
    sizes?.observe(canvas);
    const sight = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
    });
    sight?.observe(canvas);

    if (moving) frame = window.requestAnimationFrame(loop);
    else draw(4000);
    return () => {
      window.cancelAnimationFrame(frame);
      sizes?.disconnect();
      sight?.disconnect();
    };
  }, [moving]);

  return <canvas ref={canvasRef} className="lp-light-field" aria-hidden="true" />;
}

/** Tilt (degrees) and lift (em) per letter: the letters stand a little crooked, like cut metal set by hand. */
const POSES: readonly (readonly [number, number])[] = [
  [-7, 0.02],
  [4, -0.04],
  [-3, 0.03],
  [6, -0.02],
  [-5, 0.04],
  [3, -0.03],
  [-4, 0.02],
  [7, -0.04],
];

/** Where the light catches an edge: the letter, where on it, and when in the loop. */
const GLINTS: readonly (readonly [number, string, string, number])[] = [
  [0, '8%', '12%', 0],
  [2, '70%', '8%', 1.4],
  [4, '30%', '78%', 2.6],
  [5, '82%', '20%', 0.8],
];

/**
 * A word in polished, extruded chrome: every letter has a dark body behind a moving metal face,
 * stands at its own angle, and a few edges catch the light. The face is painted by the stylesheet
 * from the letter itself (`data-letter`), so the word stands in the page's text once. Decoration:
 * the page names the product in its heading and its brand link, so this is hidden from assistive
 * technology.
 */
export function ChromeWord({ word }: { word: string }): React.JSX.Element {
  return (
    <span className="lp-chrome-word" aria-hidden="true">
      {Array.from(word).map((letter, index) => {
        const [tilt, lift] = POSES[index % POSES.length] ?? [0, 0];
        const glint = GLINTS.find(([at]) => at === index);
        return (
          <span key={index} className="lp-chrome-letter" style={{ '--tilt': `${tilt}deg`, '--lift': `${lift}em`, '--i': index } as CssVars}>
            <span className="lp-chrome-body" data-letter={letter}>{letter}</span>
            {glint && <span className="lp-chrome-glint" style={{ left: glint[1], top: glint[2], animationDelay: `${glint[3]}s` }} />}
          </span>
        );
      })}
    </span>
  );
}

/** What the ring of light opens over: everything one can press or type into. */
const PRESSABLE = 'a, button, [role="tab"], [role="radio"], [role="switch"], input, select, textarea, summary';

/**
 * Light that answers the pointer, for a mouse only: a soft ring that trails it and opens up over
 * anything pressable, and frames marked `data-tilt`, which lean towards it with a glare that follows.
 * The cursor itself stays. Nothing moves when the page does not.
 */
export function PointerAura(): React.JSX.Element {
  const aura = useRef<HTMLDivElement>(null);
  const moving = useContext(MotionContext);

  useEffect(() => {
    const ring = aura.current;
    if (!ring || !moving || typeof window.matchMedia !== 'function') return undefined;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return undefined;

    let x = -200;
    let y = -200;
    let ax = x;
    let ay = y;
    let active = false;
    let frame = 0;
    let tilted: HTMLElement | null = null;

    const settle = () => {
      if (!tilted) return;
      tilted.style.setProperty('--tx', '0deg');
      tilted.style.setProperty('--ty', '0deg');
      tilted.removeAttribute('data-tilt-on');
      tilted = null;
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      x = event.clientX;
      y = event.clientY;
      const target = event.target instanceof Element ? event.target : null;
      active = Boolean(target?.closest(PRESSABLE));
      const next = target?.closest<HTMLElement>('[data-tilt]') ?? null;
      if (tilted !== next) settle();
      tilted = next;
      if (tilted) {
        // At most six degrees, towards the pointer; the glare falls where the pointer is.
        const box = tilted.getBoundingClientRect();
        const px = (x - box.left) / Math.max(1, box.width) - 0.5;
        const py = (y - box.top) / Math.max(1, box.height) - 0.5;
        tilted.style.setProperty('--ty', `${(px * 12).toFixed(2)}deg`);
        tilted.style.setProperty('--tx', `${(-py * 12).toFixed(2)}deg`);
        tilted.style.setProperty('--gx', `${((px + 0.5) * 100).toFixed(1)}%`);
        tilted.style.setProperty('--gy', `${((py + 0.5) * 100).toFixed(1)}%`);
        tilted.setAttribute('data-tilt-on', '');
      }
      ring.style.opacity = '1';
    };
    const onLeave = () => {
      ring.style.opacity = '0';
      settle();
    };
    const tick = () => {
      frame = window.requestAnimationFrame(tick);
      ax += (x - ax) * 0.2;
      ay += (y - ay) * 0.2;
      ring.style.transform = `translate(${ax}px, ${ay}px) translate(-50%, -50%) scale(${active ? 1.65 : 1})`;
      ring.dataset.active = active ? 'true' : 'false';
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      ring.style.opacity = '0';
      settle();
    };
  }, [moving]);

  return <div ref={aura} className="lp-aura" aria-hidden="true" />;
}
