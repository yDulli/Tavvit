import { useSpaceStore } from '../stores/spaceStore';
import { useSelfIdentity } from '../stores/authStore';
import { useSpaceOrigin } from './useSpaceOrigin';

/**
 * Whether the signed-in person owns the space: its owner id against their own
 * row id on the instance that hosts it, which issued that owner id. Owning is
 * this one fact, never a role or the owner group (permissions.md).
 */
export function useIsSpaceOwner(spaceId: string): boolean {
  const space = useSpaceStore((s) => s.spaces.find((sp) => sp.id === spaceId));
  const self = useSelfIdentity();
  const origin = useSpaceOrigin(spaceId);
  const myIdHere = self?.rowIds.get(origin);
  return !!space && myIdHere !== undefined && space.ownerId === myIdHere;
}
