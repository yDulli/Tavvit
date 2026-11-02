import dns from 'dns';
import type { LookupAddress, LookupOptions } from 'dns';
import { Agent } from 'undici';
import { classifyAddress } from './ipClass.js';

/**
 * True for any address that is not safely routable on the public internet.
 *
 * Kept as a named export with its original signature: four modules import it
 * and `spaceInviteSnapshot.test.ts` mocks it by name. The classification moved
 * to ipClass.ts; this is the adapter.
 */
export function isPrivateIp(ip: string): boolean {
  return classifyAddress(ip) !== 'public';
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

function refusedName(hostname: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`Private IP not allowed: ${hostname}`), { code: 'ENOTFOUND' });
}

/**
 * The resolver of every connection safeFetch opens: a name is refused when ANY of its addresses
 * is not public, and only the addresses checked here are connected to. Checking a name before the
 * request is not enough on its own, because fetch resolves it again: a server that answers
 * differently the second time (DNS rebinding) or offers a private address beside a public one
 * would otherwise be reached. An IP literal is never looked up, and validateExternalUrl has
 * already classified it.
 */
export function publicOnlyLookup(hostname: string, options: LookupOptions, callback: LookupCallback): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) {
      callback(err, '');
      return;
    }
    const first = addresses[0];
    if (!first || addresses.some((entry) => isPrivateIp(entry.address))) {
      callback(refusedName(hostname), '');
      return;
    }
    if (options.all) callback(null, addresses);
    else callback(null, first.address, first.family);
  });
}

/**
 * Connections that only ever reach public addresses (`publicOnlyLookup`), for Node's own fetch.
 * It takes any undici dispatcher of its major version; @types/node describes an older undici's,
 * which TypeScript cannot match with this one, so the type is named here once.
 */
export const publicOnlyDispatcher = new Agent({ connect: { lookup: publicOnlyLookup } }) as unknown as NonNullable<RequestInit['dispatcher']>;

/**
 * Validate that a URL is safe for outbound fetch (not private/internal).
 * Throws on invalid scheme, DNS failure, or a private address among those the name resolves to.
 * The connection itself is held to the same rule by publicOnlyDispatcher; this answers early.
 */
export async function validateExternalUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Invalid URL scheme');
  }

  // URL.hostname keeps the square brackets around an IPv6 literal, and
  // dns.lookup('[::1]') fails ENOTFOUND. That produced the right refusal for
  // the wrong reason and made every legitimate IPv6 literal unreachable.
  // Strip them and let the classifier decide.
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');

  let addresses: LookupAddress[];
  try {
    addresses = await dns.promises.lookup(hostname, { all: true });
  } catch {
    throw new Error('DNS lookup failed');
  }

  if (addresses.length === 0 || addresses.some((entry) => isPrivateIp(entry.address))) {
    throw new Error('Private IP not allowed');
  }
}

const MAX_REDIRECTS = 5;

/**
 * SSRF-safe fetch. Validates the target URL and re-validates the destination of
 * every redirect hop before following it, so a hostile server cannot 30x-redirect
 * an outbound request to an internal address (loopback, link-local, RFC1918).
 *
 * Use this instead of bare `fetch()` for any request to a user- or peer-supplied
 * URL. Redirects are followed manually (Node/undici exposes the 3xx + Location
 * with `redirect: 'manual'`), capped at MAX_REDIRECTS. Every connection goes
 * through publicOnlyDispatcher, so the address connected to is one that was
 * checked: no second lookup decides where the request goes.
 */
export async function safeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let currentUrl = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await validateExternalUrl(currentUrl);
    const response = await fetch(currentUrl, { ...init, redirect: 'manual', dispatcher: publicOnlyDispatcher });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return response; // 3xx without a target — hand back as-is
      // Resolve relative redirects against the current URL, then loop to re-validate.
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    return response;
  }
  throw new Error('Too many redirects');
}
