import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { useBump } from './useBump';
import { useExitGhost } from './useExitGhost';
import { usePlaceEntrance } from './usePlaceEntrance';

// What moves is for the browser to draw; what is tested here is when it is asked to.

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.motion;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function Count({ value }: { value: number }) {
  return <span data-testid="bumps">{useBump(value)}</span>;
}

describe('useBump', () => {
  it('leaves the first render out, and counts each change after it', () => {
    const { rerender, getByTestId } = render(<Count value={3} />);
    expect(getByTestId('bumps').textContent).toBe('0');
    rerender(<Count value={3} />);
    expect(getByTestId('bumps').textContent).toBe('0');
    rerender(<Count value={4} />);
    expect(getByTestId('bumps').textContent).toBe('1');
    rerender(<Count value={3} />);
    expect(getByTestId('bumps').textContent).toBe('2');
  });
});

function Dialog() {
  const ref = useRef<HTMLDivElement>(null);
  useExitGhost(ref);
  return (
    <div ref={ref} id="dialog" className="surface" data-testid="dialog">
      <input id="field" defaultValue="typed" />
      <iframe title="embed" src="about:blank" />
      <video />
      <canvas />
      <p>Words</p>
    </div>
  );
}

describe('useExitGhost', () => {
  const ghosts = () => document.querySelectorAll('.modal-leaving');

  describe('where the browser can animate', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // jsdom draws nothing, so it has no such method; every browser does.
      Element.prototype.getAnimations = () => [];
    });
    afterEach(() => {
      delete (Element.prototype as { getAnimations?: unknown }).getAnimations;
    });

    it('leaves a copy behind that answers nothing, and takes it away again', async () => {
      const { unmount } = render(<Dialog />);
      expect(ghosts()).toHaveLength(0);
      unmount();
      await Promise.resolve();
      expect(document.querySelector('[data-testid="dialog"]:not(.modal-leaving)')).toBe(null);
      expect(ghosts()).toHaveLength(1);
      const ghost = ghosts()[0] as HTMLElement;
      expect(ghost.textContent).toContain('Words');
      expect(ghost.getAttribute('aria-hidden')).toBe('true');
      expect(ghost.inert).toBe(true);
      vi.advanceTimersByTime(1000);
      expect(ghosts()).toHaveLength(0);
    });

    it('brings along nothing that would load or play again, and no id twice', async () => {
      const { unmount } = render(<Dialog />);
      unmount();
      await Promise.resolve();
      const ghost = ghosts()[0] as HTMLElement;
      expect(ghost.querySelector('iframe, video, canvas')).toBe(null);
      expect(ghost.id).toBe('');
      expect(ghost.querySelector('#field')).toBe(null);
      expect(ghost.querySelector('input')?.value).toBe('typed');
    });

    it('stays out of the way when motion is reduced', async () => {
      document.documentElement.dataset.motion = 'reduce';
      const { unmount } = render(<Dialog />);
      unmount();
      await Promise.resolve();
      expect(ghosts()).toHaveLength(0);
    });
  });

  it('does nothing where nothing can be animated', async () => {
    const { unmount } = render(<Dialog />);
    unmount();
    await Promise.resolve();
    expect(ghosts()).toHaveLength(0);
  });
});

function Stage({ place, animate }: { place: string; animate: (keyframes: unknown, options: unknown) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  usePlaceEntrance(ref, place);
  return (
    <div
      ref={(element) => {
        (ref as { current: HTMLDivElement | null }).current = element;
        if (element) (element as unknown as { animate: typeof animate }).animate = animate;
      }}
    />
  );
}

describe('usePlaceEntrance', () => {
  it('plays when the place changes, and not on the way in or when nothing changed', () => {
    const animate = vi.fn();
    const { rerender } = render(<Stage place="/a" animate={animate} />);
    expect(animate).not.toHaveBeenCalled();
    rerender(<Stage place="/a" animate={animate} />);
    expect(animate).not.toHaveBeenCalled();
    rerender(<Stage place="/b" animate={animate} />);
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it('stands still when motion is reduced', () => {
    document.documentElement.dataset.motion = 'reduce';
    const animate = vi.fn();
    const { rerender } = render(<Stage place="/a" animate={animate} />);
    rerender(<Stage place="/b" animate={animate} />);
    expect(animate).not.toHaveBeenCalled();
  });
});
