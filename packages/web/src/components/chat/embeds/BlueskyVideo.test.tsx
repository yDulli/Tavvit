import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { BlueskyVideo as BlueskyVideoInfo } from '@backspace/shared/src/bluesky';

// A Bluesky post's video (docs/systems/embeds.md, "Bluesky posts"): a still and a play button
// until played; hls.js loaded only then; Tavvit's own controls once it plays; Bluesky's own page
// when it cannot play here.

const hls = vi.hoisted(() => ({
  supported: true,
  instances: [] as Array<{ loadSource: ReturnType<typeof vi.fn>; attachMedia: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }>,
}));
vi.mock('hls.js/light', () => {
  class Hls {
    static isSupported() { return hls.supported; }
    static Events = { ERROR: 'hlsError' };
    loadSource = vi.fn();
    attachMedia = vi.fn();
    on = vi.fn();
    destroy = vi.fn();
    constructor() { hls.instances.push(this); }
  }
  return { default: Hls };
});

import { initI18n } from '../../../i18n';
import { BlueskyVideo } from './BlueskyVideo';

const VIDEO: BlueskyVideoInfo = {
  playlist: 'https://video.bsky.app/watch/did%3Aplc%3Ax/bafkrei/playlist.m3u8',
  thumbnail: 'https://video.bsky.app/watch/did%3Aplc%3Ax/bafkrei/thumbnail.jpg',
  alt: 'A tablet in the clouds',
  width: 1280,
  height: 720,
  loops: false,
};
const POST_URL = 'https://bsky.app/profile/bsky.app/post/3myi2ihquwk26';

beforeAll(async () => {
  await initI18n();
});

beforeEach(() => {
  hls.supported = true;
  hls.instances.length = 0;
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function play(this: HTMLMediaElement) {
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function pause(this: HTMLMediaElement) {
    this.dispatchEvent(new Event('pause'));
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a Bluesky video', () => {
  it('shows its still and a play button, and loads nothing else until played', () => {
    render(<BlueskyVideo video={VIDEO} postUrl={POST_URL} />);
    expect(document.querySelector('video')).toHaveAttribute('poster', VIDEO.thumbnail);
    expect(document.querySelector('video')).toHaveAttribute('preload', 'none');
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(hls.instances).toHaveLength(0);
  });

  it('plays its playlist through hls.js, then offers its own controls', async () => {
    render(<BlueskyVideo video={VIDEO} postUrl={POST_URL} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Play' })); });
    expect(hls.instances).toHaveLength(1);
    expect(hls.instances[0]!.loadSource).toHaveBeenCalledWith(VIDEO.playlist);
    expect(hls.instances[0]!.attachMedia).toHaveBeenCalledWith(document.querySelector('video'));
    for (const name of ['Pause', 'Position in the video', 'Mute', 'Volume', 'Full screen']) {
      expect(screen.getByLabelText(name)).toBeInTheDocument();
    }
  });

  it('leads to Bluesky when the browser cannot play it here', async () => {
    hls.supported = false;
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
    render(<BlueskyVideo video={VIDEO} postUrl={POST_URL} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Play' })); });
    expect(screen.getByRole('link', { name: 'Watch on Bluesky' })).toHaveAttribute('href', POST_URL);
  });

  it('plays a GIF in a loop without sound, and offers no sound to turn on', async () => {
    render(<BlueskyVideo video={{ ...VIDEO, loops: true }} postUrl={POST_URL} />);
    expect(screen.getByText('GIF')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Play' })); });
    const element = document.querySelector('video')!;
    expect(element.loop).toBe(true);
    expect(element.muted).toBe(true);
    expect(screen.queryByLabelText('Mute')).toBeNull();
    expect(screen.queryByLabelText('Unmute')).toBeNull();
  });
});
