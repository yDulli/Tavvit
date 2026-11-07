import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { CustomDecorationView } from '@backspace/shared/src/customDecorations';
import { Avatar } from './Avatar';
import { DecoratedName, NameplateLayer, ProfileEffectLayer } from './Decorations';
import { madeEffectParticles } from '../../utils/decorations';
import { useExternalMediaStore } from '../../stores/externalMediaStore';
import { useConnectedOriginsStore } from '../../stores/connectedOriginsStore';

// Decorations people made, as every surface draws them (docs/systems/decorations.md, "Made by
// people"): none of them may cover what it decorates.

const COLORS = { a: '#112233', b: '#445566' };

function view(over: Partial<CustomDecorationView>): CustomDecorationView {
  return { id: '7', kind: 'frame', name: 'Ring', image: '/api/decorations/7.webp', still: null, style: null, motion: null, ...over };
}

beforeEach(() => {
  useExternalMediaStore.setState({ alwaysAllow: false, allowedHosts: [] });
  useConnectedOriginsStore.setState({ origins: [] });
});

afterEach(cleanup);

describe('an effect someone made', () => {
  it('sends a few of its piece across the card in its motion, never one picture over it', () => {
    const effect = view({ kind: 'effect', image: '/api/decorations/9.webp', still: '/api/decorations/9-still.webp', motion: 'rise' });
    const { container } = render(<div className="relative"><ProfileEffectLayer effect={effect} className="z-20" /></div>);
    const layer = container.querySelector<HTMLElement>('[data-effect="made"]')!;
    expect(layer).toHaveAttribute('data-made-motion', 'rise');
    expect(layer).toHaveAttribute('aria-hidden', 'true');
    expect(layer.className).toContain('z-20');
    expect(layer.querySelectorAll('i')).toHaveLength(madeEffectParticles('rise').length);
    expect(layer.querySelector('img')).toBeNull();
    expect(layer.style.getPropertyValue('--made-moving')).toBe('url("/api/decorations/9.webp")');
    expect(layer.style.getPropertyValue('--made-still')).toBe('url("/api/decorations/9-still.webp")');
  });

  it('stands still on the same picture when it does not move, and falls without a motion', () => {
    const { container } = render(<ProfileEffectLayer effect={view({ kind: 'effect', image: '/api/decorations/9.webp' })} />);
    const layer = container.querySelector<HTMLElement>('[data-effect="made"]')!;
    expect(layer).toHaveAttribute('data-made-motion', 'fall');
    expect(layer.style.getPropertyValue('--made-still')).toBe('url("/api/decorations/9.webp")');
  });

  it('keeps every motion to a few small pieces', () => {
    for (const motion of ['fall', 'tumble', 'rise', 'float', 'twinkle'] as const) {
      const particles = madeEffectParticles(motion);
      expect(particles.length).toBeGreaterThan(0);
      expect(particles.length).toBeLessThanOrEqual(14);
      expect(Math.max(...particles.map((particle) => particle.size))).toBeLessThanOrEqual(30);
    }
  });

  it('waits for consent before drawing a piece from a server this client is not signed into', () => {
    const remote = view({ kind: 'effect', image: 'https://elsewhere.example/api/decorations/9.webp', motion: 'fall' });
    const { container, rerender } = render(<ProfileEffectLayer effect={remote} />);
    expect(container.querySelector('[data-effect]')).toBeNull();
    useConnectedOriginsStore.setState({ origins: ['https://elsewhere.example'] });
    rerender(<ProfileEffectLayer effect={remote} />);
    expect(container.querySelector('[data-effect="made"]')).not.toBeNull();
  });
});

describe('a frame someone made', () => {
  it('lies over the picture in the frame\'s view, where its middle is kept clear', () => {
    const { container } = render(<Avatar name="Mara" size={40} frame={view({})} frameMotion="on" />);
    const frame = container.querySelector('.deco-made-frame');
    expect(frame).toHaveAttribute('aria-hidden', 'true');
    expect(frame?.querySelector('img.deco-made-fill')).toHaveAttribute('src', '/api/decorations/7.webp');
  });

  it('shows the first frame of a moving one and fetches the moving one only where it may move', () => {
    const moving = view({ still: '/api/decorations/7-still.webp' });
    const { container } = render(<Avatar name="Mara" size={40} frame={moving} frameMotion="hover" />);
    expect(container.querySelector('img.deco-made-still')).toHaveAttribute('src', '/api/decorations/7-still.webp');
    expect(container.querySelector('img.deco-made-moving')).toHaveAttribute('loading', 'lazy');
  });
});

describe('a nameplate someone made', () => {
  it('is its picture behind the row, from the row\'s far end', () => {
    const { container } = render(<NameplateLayer nameplate={view({ kind: 'nameplate', image: '/api/decorations/8.webp' })} colors={COLORS} />);
    const layer = container.querySelector('[data-nameplate="made"]');
    expect(layer?.className).toContain('deco-nameplate');
    expect(layer?.querySelector('img.deco-made-plate')).toHaveAttribute('src', '/api/decorations/8.webp');
  });
});

describe('a name style someone made', () => {
  it('wears its look in its maker\'s colours', () => {
    const style = view({ kind: 'name', image: null, style: { look: 'retro', colors: ['#aa0000', '#00bb00', '#0000cc'] } });
    render(<DecoratedName font={null} effect={style} colors={COLORS}>Mara</DecoratedName>);
    const name = screen.getByText('Mara');
    expect(name).toHaveAttribute('data-name-made', 'retro');
    expect(name).not.toHaveAttribute('data-name-effect');
    expect(name.style.getPropertyValue('--c1')).toBe('#aa0000');
    expect(name.style.getPropertyValue('--c3')).toBe('#0000cc');
  });

  it('draws a wave letter by letter and keeps the name whole for a screen reader', () => {
    const wave = view({ kind: 'name', image: null, style: { look: 'wave', colors: ['#5cc491', '#60a5e6'] } });
    const { container } = render(<DecoratedName font={null} effect={wave} colors={COLORS}>Mara</DecoratedName>);
    expect(container.querySelectorAll('.deco-name-letter')).toHaveLength(4);
    expect(container.querySelector('.sr-only')?.textContent).toBe('Mara');
  });

  it('gives way to a role\'s colour', () => {
    const style = view({ kind: 'name', image: null, style: { look: 'sticker', colors: ['#ffffff'] } });
    render(<DecoratedName font={null} effect={style} colors={COLORS} roleColored>Mara</DecoratedName>);
    expect(screen.getByText('Mara')).not.toHaveAttribute('data-name-made');
  });
});
