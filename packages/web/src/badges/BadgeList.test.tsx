import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BADGES } from '@backspace/shared/src/badges';
import { setLanguage } from '../i18n';
import { BadgeList } from './BadgeList';

// Badges say their name on the pointer, and what they mean when clicked. They sit beside a
// handle and on things that open themselves, so a click must stay with the badge.

beforeEach(async () => {
  cleanup();
  await setLanguage('en');
});

describe('a badge', () => {
  it('says what it means when clicked, and not before', async () => {
    render(<BadgeList badges={['staff']} />);
    const mark = screen.getByRole('button', { name: 'Staff' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(mark);
    const card = screen.getByRole('dialog', { name: 'Staff' });
    expect(card.textContent).toContain('Runs this instance');
    expect(mark.getAttribute('aria-expanded')).toBe('true');
  });

  it('closes on a second click, on Escape, and on a press elsewhere', async () => {
    render(<div><BadgeList badges={['staff']} /><p>elsewhere</p></div>);
    const mark = screen.getByRole('button', { name: 'Staff' });
    await userEvent.click(mark);
    await userEvent.click(mark);
    expect(screen.queryByRole('dialog')).toBeNull();

    await userEvent.click(mark);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();

    await userEvent.click(mark);
    await userEvent.click(screen.getByText('elsewhere'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stays open for a press on the card itself', async () => {
    render(<BadgeList badges={['staff']} />);
    await userEvent.click(screen.getByRole('button', { name: 'Staff' }));
    await userEvent.click(screen.getByRole('dialog', { name: 'Staff' }));
    expect(screen.getByRole('dialog', { name: 'Staff' })).toBeTruthy();
  });

  it('keeps its click from whatever it sits on', async () => {
    const onParent = vi.fn();
    render(<button type="button" onClick={onParent}><BadgeList badges={['verified']} /></button>);
    await userEvent.click(screen.getByRole('button', { name: 'Verified' }));
    expect(onParent).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Verified' })).toBeTruthy();
  });

  it('opens from the keyboard', async () => {
    render(<BadgeList badges={['staff']} />);
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Staff' })).toBeTruthy();
  });

  it('says a note with its name, such as an owner title', async () => {
    render(<BadgeList badges={['server_owner']} notes={{ server_owner: 'Captain' }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Space owner · Captain' }));
    expect(screen.getByRole('dialog').textContent).toContain('Space owner · Captain');
  });
});

describe('a row of badges', () => {
  it('keeps the fixed order, and counts what it leaves out', () => {
    const { container } = render(<BadgeList badges={['helper', 'staff', 'founder']} max={2} />);
    expect(screen.getAllByRole('button').map((mark) => mark.getAttribute('aria-label'))).toEqual(['Staff', 'Helper']);
    expect(container.textContent).toContain('+1');
  });

  it('is nothing without any', () => {
    expect(render(<BadgeList badges={[]} />).container.textContent).toBe('');
  });
});

describe('a badge\'s picture', () => {
  it('is a picture of its own for every badge, at the size asked, and silent', () => {
    const { container } = render(<BadgeList badges={[...BADGES.map((badge) => badge.id)]} size="md" />);
    const pictures = [...container.querySelectorAll('img')];
    expect(pictures).toHaveLength(BADGES.length);
    expect(new Set(pictures.map((picture) => picture.getAttribute('src'))).size).toBe(BADGES.length);
    for (const picture of pictures) {
      expect(picture.getAttribute('width')).toBe('18');
      expect(picture.getAttribute('alt')).toBe('');
      expect(picture.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('sits on its card without a light of its own', async () => {
    render(<BadgeList badges={['founder']} />);
    await userEvent.click(screen.getByRole('button', { name: 'Founder' }));
    const tile = screen.getByRole('dialog', { name: 'Founder' }).querySelector('img')?.parentElement;
    expect(tile?.getAttribute('style')).toBeNull();
    expect(tile?.className).toContain('bg-surface-input');
  });
});
