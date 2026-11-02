import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ROLE_GLYPH_IDS, parseRoleGlyph, roleGlyphValue, roleIconGlyph } from '@backspace/shared/src/roleGlyphs';
import { isRoleIcon } from '@backspace/shared/src/roleDisplay';
import { ROLE_LIMITS } from '@backspace/shared';
import { setLanguage } from '../i18n';
import { RoleIcon } from './RoleIcon';
import { RoleIconPicker } from './RoleIconPicker';
import { ROLE_GLYPH_PATHS } from './roleGlyphPaths';

beforeEach(async () => {
  cleanup();
  await setLanguage('en');
});

describe('the set', () => {
  it('has a drawing for every icon, and no drawing without one', () => {
    expect(Object.keys(ROLE_GLYPH_PATHS).sort()).toEqual([...ROLE_GLYPH_IDS].sort());
    for (const id of ROLE_GLYPH_IDS) expect(ROLE_GLYPH_PATHS[id].length, id).toBeGreaterThan(20);
  });

  it('fits what a role may store, and the server takes all of it', () => {
    for (const id of ROLE_GLYPH_IDS) {
      const value = roleGlyphValue(id);
      expect(value.length, id).toBeLessThanOrEqual(ROLE_LIMITS.MAX_ICON_LENGTH);
      expect(isRoleIcon(value), id).toBe(true);
      expect(parseRoleGlyph(value)).toBe(id);
    }
  });

  it('refuses names outside it', () => {
    for (const bad of ['glyph:', 'glyph:nope', 'glyph:crown ', 'GLYPH:crown', 'crown', 'glyph:<script>']) {
      expect(isRoleIcon(bad), bad).toBe(false);
    }
  });

  it('still takes an emoji, for roles from before and for Discord templates', () => {
    expect(isRoleIcon('⚔️')).toBe(true);
    expect(isRoleIcon('🐉')).toBe(true);
    expect(isRoleIcon('text')).toBe(false);
  });
});

describe('an icon', () => {
  it('is drawn in the role\'s colour', async () => {
    const { container } = render(<RoleIcon icon="glyph:crown" color="#ff0000" />);
    await waitFor(() => expect(container.querySelector('path')?.getAttribute('fill')).toBe('#ff0000'));
    expect(container.querySelector('path')?.getAttribute('d')).toBe(ROLE_GLYPH_PATHS.crown);
    expect(container.querySelector('linearGradient')).toBeNull();
  });

  it('is drawn across the role\'s gradient', async () => {
    const { container } = render(<RoleIcon icon="glyph:crown" color="#ff0000" colorSecondary="#0000ff" />);
    await waitFor(() => expect(container.querySelector('path')).not.toBeNull());
    const gradient = container.querySelector('linearGradient')!;
    expect(container.querySelector('path')?.getAttribute('fill')).toBe(`url(#${gradient.id})`);
    expect([...gradient.querySelectorAll('stop')].map((stop) => stop.getAttribute('stop-color'))).toEqual(['#ff0000', '#0000ff']);
  });

  it('takes the colour around it without a role\'s', async () => {
    const { container } = render(<RoleIcon icon="glyph:star" />);
    await waitFor(() => expect(container.querySelector('path')?.getAttribute('fill')).toBe('currentColor'));
  });
});

describe('an emoji from before', () => {
  it('is drawn with the icon meaning the same, with or without its variation selector', async () => {
    expect(roleIconGlyph('⚔️')).toBe('sword');
    expect(roleIconGlyph('⚔')).toBe('sword');
    expect(roleIconGlyph('👑')).toBe('crown');
    const { container } = render(<RoleIcon icon="⚔️" color="#ff0000" />);
    await waitFor(() => expect(container.querySelector('path')?.getAttribute('d')).toBe(ROLE_GLYPH_PATHS.sword));
  });

  it('stays as it is when no icon means the same', () => {
    expect(roleIconGlyph('🐉')).toBeNull();
    const { container } = render(<RoleIcon icon="🐉" color="#ff0000" />);
    expect(container.textContent).toBe('🐉');
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('choosing one', () => {
  const props = { color: '#ff0000', colorSecondary: null };

  it('offers the set by name, and gives back what a role stores', async () => {
    const onChange = vi.fn();
    render(<RoleIconPicker value="" onChange={onChange} {...props} />);
    expect(screen.getAllByRole('button').length).toBe(ROLE_GLYPH_IDS.length);
    await userEvent.click(screen.getByRole('button', { name: 'Sword' }));
    expect(onChange).toHaveBeenCalledWith('glyph:sword');
  });

  it('marks the chosen one, and offers taking it away', async () => {
    const onChange = vi.fn();
    render(<RoleIconPicker value="glyph:sword" onChange={onChange} {...props} />);
    expect(screen.getByRole('button', { name: 'Sword' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Crown' }).getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(screen.getByRole('button', { name: 'Remove icon' }));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('shows an old emoji as the icon it became', () => {
    render(<RoleIconPicker value="⚔️" onChange={vi.fn()} {...props} />);
    expect(screen.getByRole('button', { name: 'Sword' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('says so for an emoji that stays, and keeps it until something else is chosen', () => {
    const { container } = render(<RoleIconPicker value="🐉" onChange={vi.fn()} {...props} />);
    expect(container.textContent).toContain('🐉');
    expect(screen.getByText('An emoji from before')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove icon' })).toBeTruthy();
  });

  it('has nothing to take away without an icon', () => {
    render(<RoleIconPicker value="" onChange={vi.fn()} {...props} />);
    expect(screen.queryByRole('button', { name: 'Remove icon' })).toBeNull();
    expect(screen.getByText('No icon')).toBeTruthy();
  });
});
