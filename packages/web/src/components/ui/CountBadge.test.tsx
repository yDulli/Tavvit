import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CountBadge, countDigits } from './CountBadge';

describe('countDigits', () => {
  it('draws the number up to 99 and "99+" above it', () => {
    expect(countDigits(1)).toBe('1');
    expect(countDigits(99)).toBe('99');
    expect(countDigits(100)).toBe('99+');
    expect(countDigits(4000)).toBe('99+');
  });
});

describe('CountBadge', () => {
  it('reads its label instead of the bare figures', () => {
    render(<CountBadge count={12} label="12 unread messages" />);
    expect(screen.getByText('12')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('12 unread messages')).toHaveClass('sr-only');
  });

  it('keeps the figures readable when the control around it says nothing of the count', () => {
    render(<CountBadge count={3} />);
    expect(screen.getByText('3')).not.toHaveAttribute('aria-hidden');
  });

  it('draws a muted place in the neutral colour and any other in the signal colour', () => {
    const { rerender } = render(<CountBadge count={7} />);
    expect(screen.getByText('7')).toHaveClass('count-badge');
    expect(screen.getByText('7')).not.toHaveClass('count-badge-muted');
    rerender(<CountBadge count={7} muted />);
    expect(screen.getByText('7')).toHaveClass('count-badge-muted');
  });
});
