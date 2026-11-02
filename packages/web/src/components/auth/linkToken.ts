import { useEffect, useState } from 'react';

/**
 * The token a mail's link carries in its fragment. It reaches no server log and no Referer
 * that way. Read once and taken out of the address bar, so it does not stay in the history
 * or get copied along with the address.
 */
export function useLinkToken(): string {
  const [token] = useState(() => window.location.hash.slice(1));
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname);
  }, []);
  return token;
}
