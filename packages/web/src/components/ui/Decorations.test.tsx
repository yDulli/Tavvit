import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { User } from '@backspace/shared';
import { Avatar } from './Avatar';
import { CardTopEffect, DecoratedName, NameplateLayer, ProfileEffectLayer } from './Decorations';
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
});

describe('the frame of a picture', () => {
  it('draws no frame without one', () => {
    const { container } = render(<Avatar name="Mara" size={40} userId="u1" />);
    expect(container.querySelector('.deco-frame')).toBeNull();
  });

  it('draws the frame, still unless it is asked to move', () => {
    const { container } = render(<Avatar name="Mara" size={40} userId="u1" frame="gilded" />);
    const frame = container.querySelector('.deco-frame');
    expect(frame).toHaveAttribute('data-frame', 'gilded');
    expect(frame).toHaveAttribute('data-motion', 'off');
  });

  it('brings a frame\'s particles only where it can move', () => {
    const still = render(<Avatar name="Mara" size={40} userId="u1" frame="stardust" />);
    expect(still.container.querySelector('.deco-frame-sparks')).toBeNull();
    cleanup();
    const moving = render(<Avatar name="Mara" size={40} userId="u1" frame="stardust" frameMotion="hover" />);
    expect(moving.container.querySelectorAll('.deco-frame-sparks i').length).toBeGreaterThan(0);
  });
});

describe('effects and nameplates', () => {
  it('draw nothing without one', () => {
    const { container } = render(
      <div>
        <ProfileEffectLayer effect={null} />
        <CardTopEffect effect={null} height={96} />
        <NameplateLayer nameplate={null} colors={COLORS} />
      </div>,
    );
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('fall across the whole height they are given, and never speak', () => {
    const { container } = render(<ProfileEffectLayer effect="snow" height={56} />);
    const layer = container.querySelector('.deco-effect') as HTMLElement;
    expect(layer).toHaveAttribute('aria-hidden', 'true');
    expect(layer.style.getPropertyValue('--fall')).toBe('80px');
    expect(layer.querySelectorAll('i').length).toBeGreaterThan(0);
  });

  it('keep a nameplate\'s particles at the far end of the row', () => {
    const { container } = render(<NameplateLayer nameplate="starlit" colors={COLORS} motion="hover" />);
    const lefts = [...container.querySelectorAll<HTMLElement>('.deco-nameplate i')].map((i) => parseFloat(i.style.getPropertyValue('--x')));
    expect(lefts.length).toBeGreaterThan(0);
    for (const left of lefts) expect(left).toBeGreaterThanOrEqual(46);
  });
});

describe('personDecorations', () => {
  const person = (over: Partial<User> = {}) => ({ id: 'u1', ...over });

  it('shows the designs the client knows and none of the rest', () => {
    const decorations = personDecorations(person({ avatarFrame: 'frost', nameplate: 'sparkly' as User['nameplate'] }), 'Mara');
    expect(decorations).toMatchObject({ avatarFrame: 'frost', nameplate: null, profileEffect: null, nameFont: null, nameEffect: null });
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
