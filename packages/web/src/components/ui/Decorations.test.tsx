import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { User } from '@backspace/shared';
import { Avatar } from './Avatar';
import { DecoratedName, NameplateLayer, ProfileEffectLayer } from './Decorations';
import { personDecorations } from '../../utils/decorations';

// Profile decorations as every surface draws them (docs/systems/decorations.md).

afterEach(cleanup);

const COLORS = { a: '#112233', b: '#445566' };

describe('DecoratedName', () => {
  it('is the plain name without a style', () => {
    render(<DecoratedName font={null} effect={null} colors={COLORS} className="name">Mara</DecoratedName>);
    const name = screen.getByText('Mara');
    expect(name.className).toBe('name');
    expect(name).not.toHaveAttribute('data-name-font');
  });

  it('wears the typeface and the effect, with the person\'s colours', () => {
    render(<DecoratedName font="serif" effect="theme" colors={COLORS} motion="hover">Mara</DecoratedName>);
    const name = screen.getByText('Mara');
    expect(name).toHaveAttribute('data-name-font', 'serif');
    expect(name).toHaveAttribute('data-name-effect', 'theme');
    expect(name).toHaveAttribute('data-motion', 'hover');
    expect(name.style.getPropertyValue('--deco-a')).toBe('#112233');
  });

  it('gives way to a role\'s colour: the effect goes, the typeface stays', () => {
    render(<DecoratedName font="pixel" effect="gold" colors={COLORS} roleColored style={{ color: 'rgb(1, 2, 3)' }}>Mara</DecoratedName>);
    const name = screen.getByText('Mara');
    expect(name).toHaveAttribute('data-name-font', 'pixel');
    expect(name).not.toHaveAttribute('data-name-effect');
    expect(name.style.color).toBe('rgb(1, 2, 3)');
  });

  it('is plain again when a role\'s colour leaves only an effect', () => {
    render(<DecoratedName font={null} effect="gold" colors={COLORS} roleColored>Mara</DecoratedName>);
    expect(screen.getByText('Mara')).not.toHaveClass('deco-name');
  });

  it('draws a wave letter by letter for the eye and keeps the name whole for a screen reader', () => {
    const { container } = render(<DecoratedName font={null} effect="wave" colors={COLORS}>Mia Sø</DecoratedName>);
    expect(screen.getByText('Mia Sø')).toHaveClass('sr-only');
    const letters = [...container.querySelectorAll<HTMLElement>('.deco-name-letter')];
    expect(letters.map((letter) => letter.textContent)).toEqual(['M', 'i', 'a', ' ', 'S', 'ø']);
    expect(letters[0]!.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(letters[5]!.style.getPropertyValue('--p')).toBe('1');
  });
});

describe('the frame of a picture', () => {
  it('draws no frame without one', () => {
    const { container } = render(<Avatar name="Mara" size={40} userId="u1" />);
    expect(container.querySelector('.deco-art')).toBeNull();
    expect(container.firstElementChild).not.toHaveClass('isolate');
  });

  it('draws a frame behind the picture and in front of it, still unless it is asked to move', () => {
    const { container } = render(<Avatar name="Mara" size={40} userId="u1" frame="headphones" />);
    const layers = [...container.querySelectorAll('svg.deco-art')];
    expect(layers.map((layer) => layer.getAttribute('data-layer'))).toEqual(['back', 'front']);
    for (const layer of layers) {
      expect(layer).toHaveAttribute('data-frame', 'headphones');
      expect(layer).toHaveAttribute('data-motion', 'off');
      expect(layer).toHaveAttribute('aria-hidden', 'true');
    }
    // The picture sits between the two layers, and the avatar keeps the back one above what it sits on.
    expect(container.firstElementChild).toHaveClass('isolate');
    expect(layers[0]!.nextElementSibling?.querySelector('.avatar-fallback')).not.toBeNull();
  });

  it('draws only the layers a design has', () => {
    const { container } = render(<Avatar name="Mara" size={40} userId="u1" frame="catears" frameMotion="hover" />);
    const layers = [...container.querySelectorAll('svg.deco-art')];
    expect(layers.map((layer) => layer.getAttribute('data-layer'))).toEqual(['back']);
    expect(layers[0]).toHaveAttribute('data-motion', 'hover');
  });

  it('leaves the status dot free and draws "your colours" in the person\'s colours', () => {
    const person = { id: 'u1', accentColor: '#7443fc', accentColorSecondary: '#45affd' } as User;
    const { container } = render(<Avatar name="Mara" size={40} userId="u1" user={person} status="online" frame="theme" />);
    const layer = container.querySelector('svg.deco-art') as SVGElement;
    expect(layer.style.getPropertyValue('--deco-a')).toBe('#7443fc');
    expect(layer.style.maskImage || layer.style.getPropertyValue('-webkit-mask-image')).toContain('radial-gradient');
  });
});

describe('effects and nameplates', () => {
  it('draw nothing without one', () => {
    const { container } = render(
      <div>
        <ProfileEffectLayer effect={null} />
        <NameplateLayer nameplate={null} colors={COLORS} />
      </div>,
    );
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('cross the card with small drawings, and never speak', () => {
    const { container } = render(<ProfileEffectLayer effect="snow" className="z-20" />);
    const layer = container.querySelector('.deco-effect') as HTMLElement;
    expect(layer).toHaveAttribute('aria-hidden', 'true');
    expect(layer).toHaveClass('z-20');
    expect(layer.style.getPropertyValue('--sprite-a')).toMatch(/^url\("data:image\/svg\+xml,/);
    expect(layer.querySelectorAll('i').length).toBeGreaterThan(0);
  });

  it('bring a scene of their own where the design has one', () => {
    const { container } = render(<ProfileEffectLayer effect="stars" />);
    expect(container.querySelector('svg.deco-art-corner')).not.toBeNull();
  });

  it('keep what falls in a nameplate inside its scene at the end of the row', () => {
    const { container } = render(<NameplateLayer nameplate="starlit" colors={COLORS} motion="hover" />);
    expect(container.querySelector('svg.deco-art-scene')).not.toBeNull();
    const field = container.querySelector('.deco-plate-field');
    const lefts = [...(field?.querySelectorAll<HTMLElement>('i') ?? [])].map((i) => parseFloat(i.style.getPropertyValue('--x')));
    expect(lefts.length).toBeGreaterThan(0);
    for (const left of lefts) {
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left).toBeLessThanOrEqual(100);
    }
  });
});

describe('personDecorations', () => {
  const person = (over: Partial<User> = {}) => ({ id: 'u1', ...over });

  it('shows the designs the client knows and none of the rest', () => {
    const decorations = personDecorations(person({ avatarFrame: 'frost', nameplate: 'sparkly' as User['nameplate'] }), 'Mara');
    expect(decorations).toMatchObject({ avatarFrame: 'frost', nameplate: null, profileEffect: null, nameFont: null, nameEffect: null });
  });

  it('shows a retired design as the drawing that took its place', () => {
    const decorations = personDecorations(person({ avatarFrame: 'gilded' as User['avatarFrame'], profileEffect: 'fireflies' as User['profileEffect'] }), 'Mara');
    expect(decorations).toMatchObject({ avatarFrame: 'crown', profileEffect: 'lanterns' });
  });

  it('takes "your colours" from the profile theme, else from the picture\'s tile', () => {
    expect(personDecorations(person({ accentColor: '#7443fc', accentColorSecondary: '#45affd' }), 'Mara').colors).toEqual({ a: '#7443fc', b: '#45affd' });
    const fromTile = personDecorations(person(), 'Mara').colors;
    expect(fromTile.a).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('has nothing for nobody', () => {
    expect(personDecorations(null, 'Group')).toMatchObject({ avatarFrame: null, profileEffect: null, nameplate: null, nameFont: null, nameEffect: null });
  });
});
