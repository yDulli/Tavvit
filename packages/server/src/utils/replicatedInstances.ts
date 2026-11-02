import type { ReplicatedInstance } from '@backspace/shared';
import { canonicalizeHomeInstance } from './federationAuth.js';

/**
 * The other instances an account says it also has an account on (`users.replicated_instances`).
 * Only the account's own client reads the list, so only its own view carries it
 * (`sanitizeUser`); everyone else's copy of a person never names it.
 */

/** The client keeps no more than this, and the route refuses more. */
export const MAX_REPLICATED_INSTANCES = 20;
const MAX_USERNAME_LENGTH = 255;

/**
 * Canonicalize a caller-supplied remote instance origin to the single storage
 * form `https://host[:port]` (lowercased, no path, no trailing slash) so that
 * `orbit.test`, `orbit.test/`, and `https://Tavvit.test` all resolve to the same
 * credential row instead of minting three unrelated secrets for one instance.
 * Returns null when the value is not a usable http(s) origin.
 */
export function canonicalRemoteOrigin(value: string): string | null {
  const canonical = canonicalizeHomeInstance(value);
  if (!canonical) return null;
  if (canonical.length > 512) return null;
  let url: URL;
  try {
    url = new URL(canonical);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  // Same host charset the registration route enforces on `homeInstance`.
  if (!/^[a-z0-9.-]+$/.test(url.hostname) || url.hostname.length > 253) return null;
  return url.origin.toLowerCase();
}

/**
 * One entry as it is kept: the name and the origin, the origin in its one form (a legacy entry
 * that named only a domain becomes `https://domain`), and nothing else the caller sent. Null when
 * either is missing or unusable.
 */
export function replicatedInstanceOf(entry: unknown): ReplicatedInstance | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const { origin, domain, username } = entry as Record<string, unknown>;
  if (typeof username !== 'string') return null;
  const name = username.trim();
  if (name.length === 0 || name.length > MAX_USERNAME_LENGTH) return null;
  const given = typeof origin === 'string' ? (/^https?:\/\//i.test(origin) ? origin : null)
    : typeof domain === 'string' && !domain.includes('/') ? `https://${domain}` : null;
  const canonical = given === null ? null : canonicalRemoteOrigin(given);
  return canonical === null ? null : { origin: canonical, username: name };
}

/** The entries that survive {@link replicatedInstanceOf}, each origin once, at most the cap. */
export function cleanReplicatedInstances(entries: readonly unknown[]): ReplicatedInstance[] {
  const kept: ReplicatedInstance[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const clean = replicatedInstanceOf(entry);
    if (clean === null || seen.has(clean.origin)) continue;
    seen.add(clean.origin);
    kept.push(clean);
    if (kept.length === MAX_REPLICATED_INSTANCES) break;
  }
  return kept;
}

/** The stored list read back: whatever a row holds, the same bounded shape comes out. */
export function storedReplicatedInstances(raw: string | null | undefined): ReplicatedInstance[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? cleanReplicatedInstances(parsed) : [];
}
