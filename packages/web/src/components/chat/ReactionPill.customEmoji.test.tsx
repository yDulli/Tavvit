import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Reaction, User } from '@backspace/shared';
import type { CustomEmoji } from '@backspace/shared/src/customEmoji';

vi.mock('../../audio/AudioManager', () => ({
  AudioManager: { getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) },
}));

import { ReactionPill } from './ReactionPill';
import { useAuthStore } from '../../stores/authStore';
import { useEmojiStore } from '../../stores/emojiStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';

const ME = { id: 'me', username: 'jannis', displayName: 'Jannis', avatar: null, createdAt: 1, homeInstance: null, homeUserId: null } as unknown as User;

function reaction(emoji: string): Reaction {
  return { id: 'r1', messageId: 'm1', userId: 'me', emoji, createdAt: 1, user: ME };
}

function library(): CustomEmoji {
  return { id: '11111', name: 'party', animated: false, createdBy: null, createdAt: 1 };
}

beforeEach(() => {
  vi.useFakeTimers();
  useAuthStore.setState({ user: ME });
  useUIStore.setState({ isMobile: false });
  useSpaceStore.setState({ userViews: new Map() });
  useEmojiStore.getState().reset();
  useEmojiStore.getState().upsert(library());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useEmojiStore.getState().reset();
});

describe('a reaction that is a custom emoji', () => {
  it('shows the emoji\'s picture and the count', () => {
    render(<ReactionPill emoji="emoji:11111" reactions={[reaction('emoji:11111')]} origin="" onToggle={() => {}} />);
    const picture = screen.getByRole('img', { name: ':party:' });
    expect(picture).toHaveAttribute('src', '/api/emojis/11111.webp');
    expect(screen.getByRole('button')).toHaveTextContent('1');
  });

  it('toggles on click like any reaction', () => {
    const onToggle = vi.fn();
    render(<ReactionPill emoji="emoji:11111" reactions={[reaction('emoji:11111')]} origin="" onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('shows who reacted in the tooltip, with the picture beside it', () => {
    render(<ReactionPill emoji="emoji:11111" reactions={[reaction('emoji:11111')]} origin="" onToggle={() => {}} />);
    fireEvent.mouseEnter(screen.getByRole('button'));
    act(() => { vi.advanceTimersByTime(400); });
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('You reacted');
    expect(tooltip.querySelector('img')).toHaveAttribute('src', '/api/emojis/11111.webp');
  });

  it('still shows a count for an emoji that has since been removed, as :emoji:', () => {
    render(<ReactionPill emoji="emoji:99999" reactions={[reaction('emoji:99999')]} origin="" onToggle={() => {}} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByTestId('emoji-fallback')).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveTextContent('1');
  });

  it('leaves a standard emoji as it was', () => {
    render(<ReactionPill emoji="🎉" reactions={[reaction('🎉')]} origin="" onToggle={() => {}} />);
    expect(screen.getByRole('button')).toHaveTextContent('🎉');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
