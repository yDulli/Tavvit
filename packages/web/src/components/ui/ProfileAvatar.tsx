import React from 'react';
import type { User } from '@backspace/shared';
import { Avatar } from './Avatar';
import { useUIStore, type ProfileMemberContext } from '../../stores/uiStore';
import { useStreaming } from '../../stores/activityStore';
import type { Placement } from '../../hooks/useFloatingPosition';

type AvatarProps = React.ComponentProps<typeof Avatar>;

interface ProfileAvatarProps extends Omit<AvatarProps, 'onClick' | 'user'> {
  /** Undefined while the user record is still resolving — the avatar then stays
   *  presentational rather than offering a click that opens nothing. */
  user?: User;
  /** The instance that issued `user` ('' = the page's own). */
  origin: string;
  /** Preferred side for the card; it flips automatically when there's no room. */
  placement?: Placement;
  /** The space member this avatar depicts, when it sits in a space surface. */
  member?: ProfileMemberContext;
}

/**
 * An avatar that opens the profile card for the user it depicts.
 *
 * This is deliberately a separate component from `Avatar`: `Avatar` takes a
 * `user` for the gradient, colour and status dot, and plenty of avatars carry
 * one without being a profile trigger — the picture inside the profile card
 * itself, the settings preview, rows inside modals. Folding the behaviour into
 * `Avatar` made every one of those a trigger by accident, which is what let the
 * profile card re-anchor to its own picture and walk across the screen.
 */
export function ProfileAvatar({ user, origin, placement = 'right', member, ...avatarProps }: ProfileAvatarProps) {
  const openUserProfile = useUIStore((s) => s.openUserProfile);

  const handleClick = user
    ? (e: React.MouseEvent) => {
        // Rows that hold an avatar usually have their own click target (open the
        // DM, select the member). Opening the profile is the more specific intent.
        e.stopPropagation();
        openUserProfile(user, origin, e.currentTarget.getBoundingClientRect(), placement, member);
      }
    : undefined;

  // Only an avatar with a status dot asks whether the person is streaming, so the many without
  // one (a message's) keep no subscription to the activities.
  return avatarProps.status && avatarProps.streaming === undefined
    ? <StreamingAvatar {...avatarProps} user={user} origin={origin} onClick={handleClick} />
    : <Avatar {...avatarProps} user={user} onClick={handleClick} />;
}

/** An avatar whose status dot turns to streaming while the person streams (`useStreaming`). */
function StreamingAvatar({ origin, ...avatarProps }: AvatarProps & { origin: string }) {
  const streaming = useStreaming(avatarProps.user, origin);
  return <Avatar {...avatarProps} streaming={streaming} />;
}
