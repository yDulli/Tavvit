import type { FederationProfileUpdatePayload } from '@backspace/shared';
import type { schema } from '../db/index.js';
import { appendMutationLog, queueOutboxEvent } from './federationOutbox.js';
import { getOurOrigin } from './federationAuth.js';
import { mediaOriginsFor, shownPicture } from './remoteMedia.js';

/**
 * A person's profile, sent to the other instances that hold a copy of them, after it changed here:
 * their own update (routes/users.ts) or an administrator removing parts of it
 * (routes/adminRemoval.ts), so a picture taken away here goes from there too.
 */

type UserRow = typeof schema.users.$inferSelect;

/**
 * A picture as other instances get it: a file here by its full address, and never an address
 * this instance would not show itself (utils/remoteMedia.ts).
 */
export function relayedPicture(value: string | null, origin: string, homeInstance: string | null): string | null {
  const picture = shownPicture(value, mediaOriginsFor(homeInstance));
  if (!picture || /^https?:\/\//i.test(picture)) return picture;
  return `${origin}/api/uploads/${picture.replace(/^\/api\/uploads\//, '')}`;
}

/** The new profile, to the other instances that hold a copy of this person. */
export function relayProfileUpdate(user: UserRow): void {
  const origin = getOurOrigin();
  const profilePayload: FederationProfileUpdatePayload = {
    homeUserId: user.id,
    homeInstance: origin,
    profileUpdatedAt: user.profileUpdatedAt ?? Date.now(),
    username: user.username,
    displayName: user.displayName,
    avatar: relayedPicture(user.avatar, origin, user.homeInstance),
    banner: relayedPicture(user.banner, origin, user.homeInstance),
    accentColor: user.accentColor,
    avatarColor: user.avatarColor,
    bio: user.bio,
  };
  appendMutationLog(user.id, user.id, 'profile_update', JSON.stringify({ profileUpdate: profilePayload }), 'profile');
  queueOutboxEvent(
    user.id,    // entityId — user's ID (queue `profile:<id>`: a newer edit replaces a queued one)
    user.id,    // contextId — user-scoped
    'profile_update',
    JSON.stringify({ profileUpdate: profilePayload }),
    undefined,  // targetPeerOrigins — broadcast to active and unreachable peers
    'profile',  // contextType
  );
}
