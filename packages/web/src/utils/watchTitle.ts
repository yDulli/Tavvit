import type { WatchProvider } from '@backspace/shared/src/watch';

/**
 * A video's provider as named to a person, for a video the provider gave no title for
 * (`voice:watch.untitled`, docs/systems/watch-together.md "Links"). A file always has a title of
 * its own, so the word for it is a fallback that should not show.
 */
const PROVIDER_NAMES: Record<WatchProvider, string> = { youtube: 'YouTube', vimeo: 'Vimeo', file: 'Video' };

export function watchProviderName(provider: WatchProvider): string {
  return PROVIDER_NAMES[provider];
}
