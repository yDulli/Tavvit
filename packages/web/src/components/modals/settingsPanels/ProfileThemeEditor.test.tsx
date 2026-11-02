import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileThemeEditor, type ProfileThemeColors } from './ProfileThemeEditor';
import { PROFILE_THEME_PRESETS } from '../../../utils/profileTheme';

afterEach(cleanup);

function setup(value: ProfileThemeColors) {
  const onChange = vi.fn();
  render(<ProfileThemeEditor value={value} onChange={onChange} />);
  return onChange;
}

const NONE: ProfileThemeColors = { primary: null, secondary: null };

describe('ProfileThemeEditor presets', () => {
  it('offers every preset by name and applies both of its colours at once', async () => {
    const onChange = setup(NONE);
    const first = PROFILE_THEME_PRESETS[0]!;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Nebula' }));
    expect(onChange).toHaveBeenCalledWith({ primary: first.primary, secondary: first.secondary });
    for (const name of ['Ember', 'Tide', 'Moss', 'Dusk', 'Sol', 'Slate']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('marks the preset the current colours are', () => {
    const first = PROFILE_THEME_PRESETS[0]!;
    setup({ primary: first.primary, secondary: first.secondary });
    expect(screen.getByRole('button', { name: 'Nebula' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Ember' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('marks none when the colours are the person\'s own', () => {
    setup({ primary: '#123456', secondary: '#654321' });
    for (const preset of PROFILE_THEME_PRESETS) {
      expect(screen.getByRole('button', { name: new RegExp(`^${preset.id}$`, 'i') })).toHaveAttribute('aria-pressed', 'false');
    }
  });
});

describe('ProfileThemeEditor colours', () => {
  it('sets the first colour from the hex field once it is complete, and keeps the second', () => {
    const onChange = setup({ primary: null, secondary: null });
    const field = screen.getByLabelText('First colour: hex code');
    fireEvent.change(field, { target: { value: '#12' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: '#123456' } });
    expect(onChange).toHaveBeenCalledWith({ primary: '#123456', secondary: null });
  });

  it('sets a colour from the picker', () => {
    const onChange = setup({ primary: '#7443fc', secondary: '#45affd' });
    fireEvent.change(screen.getByLabelText('Second colour: colour picker'), { target: { value: '#e8743b' } });
    expect(onChange).toHaveBeenCalledWith({ primary: '#7443fc', secondary: '#e8743b' });
  });

  it('does not take a malformed hex as a colour', () => {
    const onChange = setup({ primary: '#7443fc', secondary: null });
    fireEvent.change(screen.getByLabelText('Second colour: hex code'), { target: { value: 'red' } });
    fireEvent.change(screen.getByLabelText('Second colour: hex code'), { target: { value: '#12345g' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('leaves the second colour out of reach until there is a first', () => {
    setup(NONE);
    expect(screen.getByLabelText('Second colour: hex code')).toBeDisabled();
    expect(screen.getByLabelText('Second colour: colour picker')).toBeDisabled();
  });

  it('shows the colours it was given in the fields', () => {
    setup({ primary: '#7443fc', secondary: '#45affd' });
    expect((screen.getByLabelText('First colour: hex code') as HTMLInputElement).value).toBe('#7443fc');
    expect((screen.getByLabelText('Second colour: hex code') as HTMLInputElement).value).toBe('#45affd');
  });

  it('clears both colours', async () => {
    const onChange = setup({ primary: '#7443fc', secondary: '#45affd' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenCalledWith({ primary: null, secondary: null });
  });

  it('offers nothing to clear when there is no theme', () => {
    setup(NONE);
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
  });
});

describe('ProfileThemeEditor preview', () => {
  it('shows the card the colours make, and nothing without a first colour', () => {
    const { rerender } = render(<ProfileThemeEditor value={NONE} onChange={() => undefined} />);
    expect(screen.queryByTestId('profile-theme-preview')).not.toBeInTheDocument();
    rerender(<ProfileThemeEditor value={{ primary: '#7443fc', secondary: '#45affd' }} onChange={() => undefined} />);
    const preview = screen.getByTestId('profile-theme-preview');
    expect(preview.style.backgroundImage).toContain('linear-gradient(180deg');
    expect(preview.style.borderColor).not.toBe('');
  });
});
