import type { WatchSource } from '@backspace/shared/src/watch';
import { createFilePlayer } from './file';
import type { WatchPlayer, WatchPlayerEvents } from './types';
import { createVimeoPlayer } from './vimeo';
import { createYouTubePlayer } from './youtube';

export type { WatchPlayer, WatchPlayerEvents } from './types';

/** The player for a session's video. */
export function createWatchPlayer(source: WatchSource, startMs: number, events: WatchPlayerEvents): WatchPlayer {
  switch (source.provider) {
    case 'youtube':
      return createYouTubePlayer(source, startMs, events);
    case 'vimeo':
      return createVimeoPlayer(source, startMs, events);
    case 'file':
      return createFilePlayer(source, startMs, events);
  }
}

/**
 * The address a person's consent is asked for before the player loads (components/ui/ExternalMedia.tsx):
 * the player's own host, or the file's.
 */
export function watchPlayerAddress(source: WatchSource): string {
  switch (source.provider) {
    case 'youtube':
      return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(source.ref)}`;
    case 'vimeo':
      return `https://player.vimeo.com/video/${encodeURIComponent(source.ref.split(':')[0] ?? '')}`;
    case 'file':
      return source.ref;
  }
}
