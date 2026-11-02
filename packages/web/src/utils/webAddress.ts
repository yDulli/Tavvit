import { EMBED_FRAME_ORIGINS } from '@backspace/shared/src/constants';

/**
 * An address from a message, a link preview or a card, when a browser may open or fetch it: http
 * or https, and nothing else. What another instance sends arrives as that instance sent it; a
 * `javascript:` or `data:` address is dropped here rather than left to the page's policy alone.
 */
export function webAddress(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const { protocol } = new URL(value, window.location.href);
    return protocol === 'https:' || protocol === 'http:' ? value : undefined;
  } catch {
    return undefined;
  }
}

/** An embedded player's address, only on one of the players this app embeds (the server's frame-src). */
export function playerAddress(value: string | null | undefined): string | undefined {
  const address = webAddress(value);
  if (!address) return undefined;
  try {
    return EMBED_FRAME_ORIGINS.includes(new URL(address).origin) ? address : undefined;
  } catch {
    return undefined;
  }
}
