import { describe, expect, it, vi } from 'vitest';
import type { WornCustomDecorations } from '@backspace/shared/src/customDecorations';

// The stores this reaches load the audio engine, which needs a browser's audio worklets.
vi.mock('../audio/AudioManager', () => ({
  AudioManager: { getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) },
}));

import { normalizeUserAssets } from './assetUrls';

// A person's made decorations come as paths on the instance that holds them; a client that reads
// that person from another instance draws them from there (docs/systems/decorations.md).

function worn(): WornCustomDecorations {
  return {
    avatarFrame: { id: '7', kind: 'frame', name: 'Ring', image: '/api/decorations/7.webp', still: '/api/decorations/7-still.webp', style: null, motion: null },
    nameEffect: { id: '8', kind: 'name', name: 'Wave', image: null, still: null, style: { look: 'wave', colors: ['#5cc491', '#60a5e6'] }, motion: null },
  };
}

describe('normalizeUserAssets and decorations people made', () => {
  it('makes the pictures of a person from another instance absolute on that instance', () => {
    const user = { id: 'u1', username: 'mara', customDecorations: worn() };
    normalizeUserAssets(user, 'https://orbit.example');
    expect(user.customDecorations.avatarFrame).toMatchObject({
      image: 'https://orbit.example/api/decorations/7.webp',
      still: 'https://orbit.example/api/decorations/7-still.webp',
    });
    expect(user.customDecorations.nameEffect).toMatchObject({ image: null, still: null });
  });

  it('leaves the pictures of this instance\'s own people as paths here', () => {
    const user = { id: 'u1', username: 'mara', customDecorations: worn() };
    normalizeUserAssets(user, '');
    expect(user.customDecorations.avatarFrame?.image).toBe('/api/decorations/7.webp');
  });

  it('changes nothing that is not a made design\'s picture path, and nothing twice', () => {
    const user = { id: 'u1', username: 'mara', customDecorations: worn() };
    user.customDecorations.avatarFrame = { ...user.customDecorations.avatarFrame!, image: 'https://orbit.example/api/decorations/7.webp', still: '/api/uploads/7.webp' };
    normalizeUserAssets(user, 'https://other.example');
    normalizeUserAssets(user, 'https://other.example');
    expect(user.customDecorations.avatarFrame).toMatchObject({ image: 'https://orbit.example/api/decorations/7.webp', still: '/api/uploads/7.webp' });
  });

  it('takes a person who wears none', () => {
    const user = { id: 'u1', username: 'mara', customDecorations: null };
    expect(() => normalizeUserAssets(user, 'https://orbit.example')).not.toThrow();
  });
});
