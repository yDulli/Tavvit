import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useAppearanceStore } from '../../stores/appearanceStore';
import { PointerAura } from './PointerAura';

/** A device as the page is told about it: which media queries are true. */
function device(matching: readonly string[]) {
  window.matchMedia = ((query: string) => ({ matches: matching.includes(query) })) as unknown as typeof window.matchMedia;
}

const MOUSE = ['(hover: hover) and (pointer: fine)'];

/** Runs every frame the ring asks for at once, so one move settles it. */
function runFrames() {
  let pending: FrameRequestCallback | null = null;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    pending = callback;
    return 1;
  });
  return () => {
    for (let turn = 0; turn < 200 && pending; turn += 1) {
      const next: FrameRequestCallback = pending;
      pending = null;
      next(0);
    }
  };
}

function move(target: Element, x: number, y: number, pointerType = 'mouse') {
  const event = new Event('pointermove', { bubbles: true });
  Object.assign(event, { clientX: x, clientY: y, pointerType });
  target.dispatchEvent(event);
}

const savedMatchMedia = window.matchMedia;

beforeEach(() => {
  localStorage.clear();
  useAppearanceStore.getState().reset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.matchMedia = savedMatchMedia;
});

describe('PointerAura', () => {
  it('is light, not a control: hidden from assistive technology, and unseen until a mouse moves', () => {
    device(MOUSE);
    const { container } = render(<PointerAura />);
    const ring = container.querySelector('.pointer-aura') as HTMLElement;
    expect(ring).toHaveAttribute('aria-hidden', 'true');
    expect(ring.style.opacity).toBe('');
  });

  it('follows a mouse and opens over what can be pressed', () => {
    device(MOUSE);
    const settle = runFrames();
    const { container } = render(<><button type="button">Go</button><p>Words</p><PointerAura /></>);
    const ring = container.querySelector('.pointer-aura') as HTMLElement;

    move(container.querySelector('p')!, 120, 80);
    settle();
    expect(ring.style.opacity).toBe('1');
    expect(ring.dataset.active).toBe('false');
    expect(ring.style.transform).toContain('scale(1)');

    move(container.querySelector('button')!, 40, 30);
    settle();
    expect(ring.dataset.active).toBe('true');
    expect(ring.style.transform).toContain('scale(1.65)');
    // It has caught up with the pointer, and then rests.
    expect(ring.style.transform).toMatch(/^translate\(4\d(\.\d+)?px, (29|30)(\.\d+)?px\)/);
  });

  it('leaves a finger and a pen alone', () => {
    device(MOUSE);
    const frames = vi.spyOn(window, 'requestAnimationFrame');
    const { container } = render(<PointerAura />);
    move(document.body, 10, 10, 'touch');
    expect((container.querySelector('.pointer-aura') as HTMLElement).style.opacity).toBe('');
    expect(frames).not.toHaveBeenCalled();
  });

  it('fades when the pointer leaves the window', () => {
    device(MOUSE);
    const settle = runFrames();
    const { container } = render(<PointerAura />);
    const ring = container.querySelector('.pointer-aura') as HTMLElement;
    move(document.body, 10, 10);
    settle();
    document.documentElement.dispatchEvent(new Event('pointerleave'));
    expect(ring.style.opacity).toBe('0');
  });

  it.each([
    ['on a touch screen', () => device([])],
    ['when the system asks for less motion', () => device([...MOUSE, '(prefers-reduced-motion: reduce)'])],
    ['with Reduce motion', () => { device(MOUSE); useAppearanceStore.getState().setReduceMotion(true); }],
    ['with the light switched off', () => { device(MOUSE); useAppearanceStore.getState().setLook({ light: 'off' }); }],
    ['under higher contrast', () => { device(MOUSE); useAppearanceStore.getState().setLook({ contrast: 'high' }); }],
  ])('listens to nothing %s', (_name, arrange) => {
    arrange();
    const listen = vi.spyOn(window, 'addEventListener');
    const { container } = render(<PointerAura />);
    expect(listen.mock.calls.filter(([type]) => type === 'pointermove')).toHaveLength(0);
    move(document.body, 10, 10);
    expect((container.querySelector('.pointer-aura') as HTMLElement).style.opacity).toBe('');
  });

  it('stops listening when it leaves the page', () => {
    device(MOUSE);
    const unlisten = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<PointerAura />);
    unmount();
    expect(unlisten.mock.calls.some(([type]) => type === 'pointermove')).toBe(true);
  });
});
