import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// The instance store reaches the audio pipeline, which jsdom cannot build.
vi.mock('../../audio/AudioManager', () => ({
  AudioManager: { getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) },
}));

import { StickerMessage } from './StickerMessage';
import { useExternalMediaStore } from '../../stores/externalMediaStore';
import { useInstanceStore } from '../../stores/instanceStore';
import type { ConnectedInstance } from '../../stores/instanceStore';

const HASH = 'f'.repeat(64);
const tokenOn = (origin: string) => `sticker:${origin}/api/stickers/assets/${HASH}.webp`;

beforeEach(() => {
  useExternalMediaStore.setState({ alwaysAllow: false, allowedHosts: [] });
  useInstanceStore.setState({ instances: [] });
});

describe('a sticker message', () => {
  it('of this page\'s own server shows at once', () => {
    render(<StickerMessage token={tokenOn(window.location.origin)} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', `${window.location.origin}/api/stickers/assets/${HASH}.webp`);
  });

  it('from any other server is not fetched until the person says yes (the Reddit report)', () => {
    render(<StickerMessage token={tokenOn('https://tracker.example')} />);
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText(/tracker\.example/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    expect(screen.getByRole('img')).toHaveAttribute('src', `https://tracker.example/api/stickers/assets/${HASH}.webp`);
  });

  it('of an instance the person is signed into shows at once: that server sees them anyway', () => {
    useInstanceStore.setState({ instances: [{ origin: 'https://friend.example' } as ConnectedInstance] });
    render(<StickerMessage token={tokenOn('https://friend.example')} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', `https://friend.example/api/stickers/assets/${HASH}.webp`);
  });
});
