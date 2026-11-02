import { PROFILE_LIMITS, type ProfileLink } from './types.js';

// The profile card's own text fields, checked the same way by the instance
// that stores them and by the editor that previews them (docs/systems/auth.md,
// "Profile fields").

/** Control characters and bidirectional overrides, which would let a field disguise itself. */
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;

/**
 * Pronouns as stored: trimmed, null when empty, or undefined when they are not
 * a string, too long or contain characters that cannot be shown safely.
 */
export function normalizePronouns(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) return null;
  if (trimmed.length > PROFILE_LIMITS.MAX_PRONOUNS_LENGTH || UNSAFE_CHARACTERS.test(trimmed)) return undefined;
  return trimmed;
}

/** A link's address when it is a plain web address (http or https, no credentials), else null. */
export function normalizeProfileLinkUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > PROFILE_LIMITS.MAX_LINK_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || !url.hostname) return null;
  // The limit is the stored form's: percent-encoding can make it longer than
  // what was typed, and a stored link must read back as valid.
  if (url.href.length > PROFILE_LIMITS.MAX_LINK_URL_LENGTH) return null;
  return url.href;
}

/**
 * A profile's links as stored, in the order given: each a web address and an
 * optional label. Null (or an empty list) clears them; undefined means the
 * value is not a valid list (too many, a bad address, a label too long).
 */
export function normalizeProfileLinks(value: unknown): ProfileLink[] | null | undefined {
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  if (value.length === 0) return null;
  if (value.length > PROFILE_LIMITS.MAX_LINKS) return undefined;
  const links: ProfileLink[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return undefined;
    const { url, label } = entry as { url?: unknown; label?: unknown };
    const href = normalizeProfileLinkUrl(url);
    if (!href) return undefined;
    let cleanLabel: string | null = null;
    if (label !== undefined && label !== null) {
      if (typeof label !== 'string') return undefined;
      const trimmed = label.trim().replace(/\s+/g, ' ');
      if (trimmed.length > PROFILE_LIMITS.MAX_LINK_LABEL_LENGTH || UNSAFE_CHARACTERS.test(trimmed)) return undefined;
      cleanLabel = trimmed || null;
    }
    // The same address twice says nothing new.
    if (seen.has(href)) continue;
    seen.add(href);
    links.push({ url: href, label: cleanLabel });
  }
  return links;
}

/**
 * The stored JSON of a profile's links, read back. A link that does not read
 * as valid is left out on its own; unreadable JSON is no links.
 */
export function parseStoredProfileLinks(stored: string | null | undefined): ProfileLink[] {
  if (!stored) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const links: ProfileLink[] = [];
  for (const entry of parsed.slice(0, PROFILE_LIMITS.MAX_LINKS)) {
    const link = normalizeProfileLinks([entry])?.[0];
    if (link && !links.some((other) => other.url === link.url)) links.push(link);
  }
  return links;
}

/** What a link reads as on the card: its label, or the address's host without "www.". */
export function profileLinkText(link: ProfileLink): string {
  if (link.label) return link.label;
  try {
    return new URL(link.url).hostname.replace(/^www\./, '');
  } catch {
    return link.url;
  }
}
