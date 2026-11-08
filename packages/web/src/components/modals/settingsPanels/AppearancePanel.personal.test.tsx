import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The way into the theme studio asks the session store whether someone is signed in, and that
// store reaches the voice code, whose noise filter needs Web Audio, which jsdom does not have.
vi.mock('../../../audio/AudioManager', () => ({
  AudioManager: { getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) },
}));

import { AccessibilityPanel } from './AccessibilityPanel';
import { AppearancePanel } from './AppearancePanel';
import { useAppearanceStore } from '../../../stores/appearanceStore';
import { CARBON_SETTINGS, THEME_PRESETS } from '../../../utils/appTheme';

beforeEach(() => {
  localStorage.clear();
  useAppearanceStore.getState().reset();
});

afterEach(cleanup);

const state = () => useAppearanceStore.getState();

describe('the theme', () => {
  it('offers Carbon, the ready-made themes and the person\'s own, marking the one in use', () => {
    render(<AppearancePanel />);
    for (const name of ['Carbon', 'Slate', 'Ink', 'Lichen', 'Clay', 'Harbour', 'Plum', 'Your own']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Carbon' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Clay' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('applies a theme as soon as it is chosen', async () => {
    render(<AppearancePanel />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Clay' }));
    expect(state().theme).toBe('clay');
    expect(screen.getByRole('button', { name: 'Clay' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Carbon' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows the three sliders only for the person\'s own theme', async () => {
    render(<AppearancePanel />);
    expect(screen.queryByLabelText('Hue')).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Your own' }));
    expect(screen.getByLabelText('Hue')).toBeInTheDocument();
    expect(screen.getByLabelText('Colour')).toBeInTheDocument();
    expect(screen.getByLabelText('Depth')).toBeInTheDocument();
  });

  it('turns a slider into the custom theme, keeping the other two', async () => {
    render(<AppearancePanel />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Your own' }));
    fireEvent.change(screen.getByLabelText('Hue'), { target: { value: '120' } });
    expect(state().theme).toBe('custom');
    // The custom theme starts from Carbon's own point, so only the hue moved.
    expect(state().custom).toMatchObject({ hue: 120, strength: CARBON_SETTINGS.strength, depth: 0 });
    fireEvent.change(screen.getByLabelText('Depth'), { target: { value: '2.5' } });
    expect(state().custom).toEqual({ hue: 120, strength: CARBON_SETTINGS.strength, depth: 2.5 });
  });

  it('goes back to Carbon from the custom settings', async () => {
    render(<AppearancePanel />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Your own' }));
    await user.click(screen.getByRole('button', { name: 'Back to Carbon' }));
    expect(state().theme).toBe('carbon');
    expect(screen.queryByLabelText('Hue')).not.toBeInTheDocument();
  });

  it('starts the custom theme from the last custom settings, not from a preset', async () => {
    state().setCustom({ hue: 33, strength: 66, depth: 1 });
    state().setTheme(Object.keys(THEME_PRESETS)[0] as 'slate');
    render(<AppearancePanel />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Your own' }));
    expect(state().custom).toEqual({ hue: 33, strength: 66, depth: 1 });
  });
});

describe('the accent colour', () => {
  it('sets a ready-made colour and marks it', async () => {
    render(<AppearancePanel />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Teal' }));
    expect(state().accent).toBe('#0e8f7e');
    expect(screen.getByRole('button', { name: 'Teal' })).toHaveAttribute('aria-pressed', 'true');
    expect((screen.getByLabelText('Your own colour (hex)') as HTMLInputElement).value).toBe('#0e8f7e');
  });

  it('takes a hex colour once it is complete and usable', () => {
    render(<AppearancePanel />);
    const field = screen.getByLabelText('Your own colour (hex)');
    fireEvent.change(field, { target: { value: '#2f6' } });
    expect(state().accent).toBeNull();
    fireEvent.change(field, { target: { value: '#2f6fed' } });
    expect(state().accent).toBe('#2f6fed');
  });

  it('says why a colour is refused and keeps the one it had', () => {
    render(<AppearancePanel />);
    act(() => { state().setAccent('#2f6fed'); });
    const field = screen.getByLabelText('Your own colour (hex)');
    fireEvent.change(field, { target: { value: '#ffffff' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Too light');
    expect(state().accent).toBe('#2f6fed');
    fireEvent.change(field, { target: { value: '#050505' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Too dark');
    expect(state().accent).toBe('#2f6fed');
    fireEvent.change(field, { target: { value: '#c2410c' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(state().accent).toBe('#c2410c');
  });

  it('offers to go back to the server\'s colour only while one is chosen', async () => {
    render(<AppearancePanel />);
    expect(screen.queryByRole('button', { name: "Use the server's colour" })).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Rose' }));
    await user.click(screen.getByRole('button', { name: "Use the server's colour" }));
    expect(state().accent).toBeNull();
  });
});

describe('reading', () => {
  it('changes the chat text size to one of the offered sizes', async () => {
    render(<AccessibilityPanel />);
    await userEvent.setup().selectOptions(screen.getByLabelText('Chat text size'), '125%');
    expect(state().chatTextScale).toBe(1.25);
  });

  it('switches reduced motion on and off', async () => {
    render(<AccessibilityPanel />);
    const user = userEvent.setup();
    const toggle = screen.getByRole('switch', { name: 'Reduce motion' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);
    expect(state().reduceMotion).toBe(true);
    await user.click(toggle);
    expect(state().reduceMotion).toBe(false);
  });
});

describe('the look', () => {
  it('draws messages in the chosen style, picked from a radio group', async () => {
    render(<AppearancePanel />);
    const style = screen.getByRole('radiogroup', { name: 'Style' });
    expect(within(style).getByRole('radio', { name: /Rows/ })).toHaveAttribute('aria-checked', 'true');
    await userEvent.setup().click(within(style).getByRole('radio', { name: /Bubbles/ }));
    expect(state().messageStyle).toBe('bubbles');
  });

  it('moves a choice with the arrow keys, as a native radio group does', async () => {
    render(<AppearancePanel />);
    const corners = screen.getByRole('radiogroup', { name: 'Corners' });
    within(corners).getByRole('radio', { name: /Standard/ }).focus();
    await userEvent.setup().keyboard('[ArrowRight]');
    expect(state().corners).toBe('round');
  });

  it('sets the typeface, the clock and the spacing', async () => {
    render(<AppearancePanel />);
    const user = userEvent.setup();
    await user.click(within(screen.getByRole('radiogroup', { name: 'Typeface' })).getByRole('radio', { name: /Mono/ }));
    await user.click(within(screen.getByRole('radiogroup', { name: 'Clock' })).getByRole('radio', { name: '24-hour' }));
    await user.click(within(screen.getByRole('radiogroup', { name: 'Spacing' })).getByRole('radio', { name: /Compact/ }));
    expect(state()).toMatchObject({ font: 'mono', timeFormat: '24h', density: 'compact' });
  });

  it('switches the reading aids on', async () => {
    render(<AccessibilityPanel />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('switch', { name: 'Higher contrast' }));
    await user.click(screen.getByRole('switch', { name: 'Colour-blind friendly status' }));
    await user.click(screen.getByRole('switch', { name: 'Underline links' }));
    expect(state()).toMatchObject({ contrast: 'high', statusPalette: 'accessible', underlineLinks: true });
  });
});
