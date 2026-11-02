import { useMemo } from 'react';
import { useInstanceStore } from '../stores/instanceStore';

/**
 * The origins this client already talks to: this page's and every instance the person is signed
 * into. Those servers see the person's address anyway, so a file of theirs needs no yes before it
 * is fetched (docs/systems/legal.md, "Content from other servers"); any other server does.
 */
export function useConnectedOrigins(): readonly string[] {
  const instances = useInstanceStore((s) => s.instances);
  return useMemo(
    () => [window.location.origin, ...instances.map((instance) => instance.origin).filter(Boolean)],
    [instances],
  );
}
