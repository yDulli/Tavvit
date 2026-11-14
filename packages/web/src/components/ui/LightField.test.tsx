import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useAppearanceStore } from '../../stores/appearanceStore';
import { LightField } from './LightField';

/** A pen that draws nothing and remembers what it was asked. */
function pen() {
  return {
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    globalCompositeOperation: '',
    strokeStyle: '',
    lineWidth: 1,
  };
}

/** Gives every canvas a size, as a browser that lays the page out does, and a pen to draw with. */
function layOut(width = 600, height = 200) {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(width);
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(height);
  const context = pen();
  const asked = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  const frames = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  return { context, asked, frames };
}

beforeEach(() => {
  localStorage.clear();
  useAppearanceStore.getState().reset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('LightField', () => {
  it('is decoration: a canvas hidden from assistive technology that says how strong it is', () => {
    const { container } = render(<LightField intensity="quiet" className="light-field-top" />);
    const canvas = container.querySelector('canvas');
    expect(canvas).toHaveAttribute('aria-hidden', 'true');
    expect(canvas).toHaveAttribute('data-intensity', 'quiet');
    expect(canvas).toHaveClass('light-field', 'light-field-top');
  });

  // A document that lays nothing out (a test's, a hidden page's) has nothing to draw on.
  it('asks for no pen while the canvas has no size', () => {
    const asked = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
    render(<LightField />);
    expect(asked).not.toHaveBeenCalled();
  });

  it('draws its threads once it has a size, and keeps moving', () => {
    const { context, asked, frames } = layOut();
    render(<LightField />);
    expect(asked).toHaveBeenCalledWith('2d');
    // Three bands of twenty-two threads at full strength.
    expect(context.stroke).toHaveBeenCalledTimes(66);
    expect(frames).toHaveBeenCalled();
  });

  it('draws one dim band behind the opening of a page of the app', () => {
    const { context } = layOut();
    render(<LightField intensity="quiet" />);
    expect(context.stroke).toHaveBeenCalledTimes(22);
  });

  it('draws one still frame with Reduce motion', () => {
    useAppearanceStore.getState().setReduceMotion(true);
    const { context, frames } = layOut();
    render(<LightField />);
    expect(context.stroke).toHaveBeenCalledTimes(66);
    expect(frames).not.toHaveBeenCalled();
  });

  it('draws nothing at all with the light switched off or under higher contrast', () => {
    const { asked, frames } = layOut();
    useAppearanceStore.getState().setLook({ light: 'off' });
    const first = render(<LightField />);
    first.unmount();
    useAppearanceStore.getState().setLook({ light: 'on', contrast: 'high' });
    render(<LightField />);
    expect(asked).not.toHaveBeenCalled();
    expect(frames).not.toHaveBeenCalled();
  });

  it('stops asking for frames when it leaves the page', () => {
    layOut();
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const { unmount } = render(<LightField />);
    unmount();
    expect(cancel).toHaveBeenCalled();
  });
});
