import { afterEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { Sensitive, SensitiveBlock, useSensitiveText } from './Sensitive';
import { STREAMER_MASK, useStreamerModeStore } from '../../streamer/streamerModeStore';

const SECRET = 'ada@example.org';

afterEach(() => {
  useStreamerModeStore.setState(useStreamerModeStore.getInitialState(), true);
});

describe('a personal value', () => {
  it('shows as it is while streamer mode is off', () => {
    render(<p>Mail: <Sensitive>{SECRET}</Sensitive></p>);
    expect(screen.getByText(SECRET, { exact: false })).toBeInTheDocument();
  });

  it('is not in the page at all while it is on: dots, read out as hidden', () => {
    useStreamerModeStore.setState({ on: true });
    const { container } = render(<p>Mail: <Sensitive>{SECRET}</Sensitive></p>);
    expect(container.textContent).not.toContain(SECRET);
    expect(container.textContent).toContain(STREAMER_MASK);
    expect(screen.getByText('Hidden in streamer mode')).toHaveClass('sr-only');
  });

  it('comes back when the mode goes off', () => {
    useStreamerModeStore.setState({ on: true });
    const { container } = render(<Sensitive>{SECRET}</Sensitive>);
    expect(container.textContent).not.toContain(SECRET);
    act(() => useStreamerModeStore.getState().setOn(false));
    expect(container.textContent).toBe(SECRET);
  });
});

describe('a personal block', () => {
  it('is replaced whole by a note with the way to turn the mode off', () => {
    useStreamerModeStore.setState({ on: true });
    render(<SensitiveBlock><ul><li>{SECRET}</li></ul></SensitiveBlock>);
    expect(screen.queryByText(SECRET)).toBeNull();
    expect(screen.getByText('Hidden while streamer mode is on.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off streamer mode' }));
    expect(useStreamerModeStore.getState().on).toBe(false);
    expect(screen.getByText(SECRET)).toBeInTheDocument();
  });
});

describe('a value in a sentence or a field', () => {
  it('is the value, or the dots', () => {
    const { result, rerender } = renderHook(() => useSensitiveText());
    expect(result.current(SECRET)).toBe(SECRET);
    useStreamerModeStore.setState({ on: true });
    rerender();
    expect(result.current(SECRET)).toBe(STREAMER_MASK);
  });
});
