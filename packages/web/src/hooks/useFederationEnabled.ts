import { useHomeInstanceInfo } from './useHomeInstanceInfo';

/**
 * Whether this instance talks to other instances at all.
 *
 * An Tavvit server for one group of friends has federation off (the operator
 * enables it with FEDERATION_ENABLED). Then the endpoints behind account linking,
 * peering and cross-server friends do not exist, so the screens that lead to them
 * must not be offered: a tab that can only answer "not found" is a bug.
 *
 * `null` while the answer has not arrived. Callers that hide something should
 * hide it until the answer is `true`, so a private server never flashes an entry
 * it cannot honour; the info is cached for the session, so by the time a menu is
 * opened it is known. A server that does not report the field at all (an older
 * Backspace one) is treated as federating, which is what it does.
 */
export function useFederationEnabled(): boolean | null {
  const info = useHomeInstanceInfo();
  if (info === null) return null;
  return info.federationEnabled !== false;
}
