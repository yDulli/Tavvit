import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { accentColorProblem } from '@backspace/shared/src/color.js';
import { DEFAULT_ACCENT_COLOR } from '@backspace/shared/src/constants.js';
import { ACCENT_PRESETS, AccentColorField } from './AccentColorField';

describe('ACCENT_PRESETS', () => {
  it.each(ACCENT_PRESETS)('%s is a colour the server would accept', (hex) => {
    expect(accentColorProblem(hex)).toBeNull();
  });

  it('starts with the built-in colour', () => {
    expect(ACCENT_PRESETS[0]).toBe(DEFAULT_ACCENT_COLOR);
  });
});

describe('AccentColorField', () => {
  it('marks the swatch of the current colour as pressed', () => {
    render(<AccentColorField value="#12907f" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: '#12907f' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '#2f7de1' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows the built-in colour as chosen when none is set', () => {
    render(<AccentColorField value={null} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: DEFAULT_ACCENT_COLOR })).toHaveAttribute('aria-pressed', 'true');
  });

  it('reports a swatch as that colour', async () => {
    const onChange = vi.fn();
    render(<AccentColorField value={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: '#d6407a' }));
    expect(onChange).toHaveBeenCalledWith('#d6407a');
  });

  it('reports the built-in swatch as "no choice" (null), so the default can change later', async () => {
    const onChange = vi.fn();
    render(<AccentColorField value="#d6407a" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: DEFAULT_ACCENT_COLOR }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('accepts a typed colour once it is complete and usable, with or without the #', async () => {
    const onChange = vi.fn();
    render(<AccentColorField value={null} onChange={onChange} />);
    const input = screen.getByRole('textbox');
    await userEvent.clear(input);
    await userEvent.type(input, '2563EB');
    expect(onChange).toHaveBeenLastCalledWith('#2563eb');
  });

  it('does not report a half-typed colour', async () => {
    const onChange = vi.fn();
    render(<AccentColorField value={null} onChange={onChange} />);
    const input = screen.getByRole('textbox');
    await userEvent.clear(input);
    await userEvent.type(input, '#2563');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a colour like #7466e8.');
  });

  it('ignores characters that cannot be part of a colour', async () => {
    render(<AccentColorField value={null} onChange={vi.fn()} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, '#zz12');
    expect(input.value).toBe('#12');
  });

  it('says a colour is too light for white button text, and does not report it', async () => {
    const onChange = vi.fn();
    render(<AccentColorField value={null} onChange={onChange} />);
    const input = screen.getByRole('textbox');
    await userEvent.clear(input);
    await userEvent.type(input, '#f5e663');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('too light');
  });

  it('says a colour is too dark for the dark panels, and does not report it', async () => {
    const onChange = vi.fn();
    render(<AccentColorField value={null} onChange={onChange} />);
    const input = screen.getByRole('textbox');
    await userEvent.clear(input);
    await userEvent.type(input, '#101018');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('too dark');
  });

  it('returns to the default with one click, and offers that only when something else is set', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<AccentColorField value={null} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Use the default' })).toBeDisabled();

    rerender(<AccentColorField value="#d6407a" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Use the default' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
