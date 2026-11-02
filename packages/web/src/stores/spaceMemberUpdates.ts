import type { MemberWithUser } from '@backspace/shared';
import { useSpaceStore } from './spaceStore';

/** HTTP replies and socket broadcasts share the same space/instance boundary. */
export function applySpaceMemberUpdate(origin: string, member: MemberWithUser): void {
  const state = useSpaceStore.getState();
  const space = state.spaces.find(s => s.id === member.spaceId && s._instanceOrigin === origin);
  if (!space || state.currentSpaceId !== member.spaceId) return;
  useSpaceStore.setState({
    members: state.members.map(existing => existing.spaceId === member.spaceId && existing.userId === member.userId
      // Profile/presence have their own live events; a database snapshot must not overwrite them.
      ? {
          ...existing,
          nickname: member.nickname,
          roles: member.roles,
          // A host that predates timeouts leaves the field out; one that has
          // them always sends it, null once a timeout is over or lifted.
          ...(member.timedOutUntil !== undefined ? { timedOutUntil: member.timedOutUntil } : {}),
          // The member's profile for this space, likewise only from a host
          // that has space profiles.
          ...(member.avatar !== undefined ? { avatar: member.avatar } : {}),
          ...(member.banner !== undefined ? { banner: member.banner } : {}),
          ...(member.bio !== undefined ? { bio: member.bio } : {}),
        }
      : existing),
  });
}
