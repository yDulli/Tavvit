import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import type { CustomEmoji } from '@backspace/shared/src/customEmoji';

vi.mock('../../audio/AudioManager', () => ({
  AudioManager: { getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) },
}));

import { MarkdownRenderer } from './MarkdownRenderer';
import { InlineMessageText } from './InlineMessageText';
import { useEmojiStore } from '../../stores/emojiStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { messageTextForPreview } from '../../utils/stickerMessages';

function emoji(id: string, name: string): CustomEmoji {
  return { id, name, animated: false, createdBy: null, createdAt: 1 };
}

beforeEach(() => {
  useEmojiStore.getState().reset();
  useEmojiStore.getState().upsert(emoji('11111', 'wave'));
  useEmojiStore.getState().upsert(emoji('22222', 'party'));
  useSpaceStore.setState({ channelOriginMap: new Map([['home-chan', ''], ['remote-chan', 'https://nova.example']]) });
});

afterEach(() => {
  cleanup();
  useEmojiStore.getState().reset();
  useSpaceStore.setState({ channelOriginMap: new Map() });
});

describe('MarkdownRenderer and custom emoji', () => {
  it('draws a token as the emoji\'s picture, with its name as the label', () => {
    render(<MarkdownRenderer content="hello <:wave:11111> there" channelId="home-chan" />);
    const img = screen.getByRole('img', { name: ':wave:' });
    expect(img).toHaveAttribute('src', '/api/emojis/11111.webp');
    expect(img.className).toContain('h-[1.375em]');
  });

  it('keeps the words around it', () => {
    const { container } = render(<MarkdownRenderer content="hello <:wave:11111> there" channelId="home-chan" />);
    expect(container.textContent).toContain('hello');
    expect(container.textContent).toContain('there');
  });

  it('draws a message of only emoji large', () => {
    render(<MarkdownRenderer content="<:wave:11111> <:party:22222>" channelId="home-chan" />);
    const images = screen.getAllByRole('img');
    expect(images).toHaveLength(2);
    for (const img of images) expect(img.className).toContain('h-12');
  });

  it('draws emoji small when there are words with them', () => {
    render(<MarkdownRenderer content="<:wave:11111> hi" channelId="home-chan" />);
    expect(screen.getByRole('img').className).toContain('h-[1.375em]');
  });

  it('leaves a token in code as text', () => {
    const { container } = render(<MarkdownRenderer content="`<:wave:11111>`" channelId="home-chan" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.textContent).toContain('<:wave:11111>');
  });

  it('shows :name: for an emoji whose picture is gone', () => {
    render(<MarkdownRenderer content="<:gone:99999>" channelId="home-chan" />);
    fireEvent.error(screen.getByRole('img', { name: ':gone:' }));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByTestId('emoji-fallback')).toHaveTextContent(':gone:');
  });

  it('shows the library\'s current name for a renamed emoji', () => {
    useEmojiStore.getState().upsert(emoji('11111', 'hello'));
    render(<MarkdownRenderer content="<:wave:11111>" channelId="home-chan" />);
    expect(screen.getByRole('img', { name: ':hello:' })).toBeInTheDocument();
  });

  it('shows :name: in a channel another instance hosts, whose ids mean nothing here', () => {
    const { container } = render(<MarkdownRenderer content="hi <:wave:11111>" channelId="remote-chan" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.textContent).toContain(':wave:');
  });

  it('does not turn a link or a mention into an emoji', () => {
    render(<MarkdownRenderer content="[a link](https://example.org)" channelId="home-chan" />);
    expect(screen.getByRole('link', { name: 'a link' })).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});

describe('reply previews and one-line text', () => {
  it('draws an emoji in a reply preview', () => {
    render(<InlineMessageText content="so <:party:22222> good" channelId="home-chan" />);
    expect(screen.getByRole('img', { name: ':party:' })).toBeInTheDocument();
  });

  it('shows an emoji as :name: where only text fits', () => {
    expect(messageTextForPreview('so <:party:22222> good')).toBe('so :party: good');
    expect(messageTextForPreview('plain')).toBe('plain');
  });
});
