import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { User } from '@backspace/shared';
import { useSpaceStore } from '../../stores/spaceStore';
import { useDmViewer } from '../../hooks/useDmViewer';
import { useCanonicalUserView } from '../../utils/userViewLookup';
import { extractDominantColors } from '../../utils/colorExtractor';
import { getAvatarGradient, getSpaceGradient } from '../../utils/gradients';
import { isMine } from '../../utils/identity';
import { lightFromColor } from '../../utils/placeLight';

const FALLBACK_USER = { id: '', username: '', createdAt: 0, isAdmin: false, replicatedInstances: [] } as unknown as User;

/** Which place a path is: a conversation at home, a space, or anywhere else. */
function placeOf(pathname: string): { dmId: string | null; spaceId: string | null } {
  const [, root, first, second] = pathname.split('/');
  if (root !== 'channels' || !first) return { dmId: null, spaceId: null };
  if (first === '@me') return { dmId: second || null, spaceId: null };
  return { dmId: null, spaceId: first };
}

/** The colour of a space: its picture's when it has one that can be read, else its tile's. */
function useSpaceColor(spaceId: string | null): string | null {
  const space = useSpaceStore((s) => (spaceId ? s.spaces.find((candidate) => candidate.id === spaceId) : undefined));
  const icon = space?.icon ?? null;
  const url = icon ? (icon.startsWith('http') || icon.startsWith('/') ? icon : `/api/uploads/${icon}`) : null;
  const [fromPicture, setFromPicture] = useState<{ url: string; color: string } | null>(null);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    extractDominantColors(url)
      .then((colors) => {
        if (!cancelled && colors[0]) setFromPicture({ url, color: colors[0] });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [url]);

  if (!space) return null;
  if (url && fromPicture?.url === url) return fromPicture.color;
  return getSpaceGradient(space.id, space.name, space.avatarColor).from;
}

/** The colour of a conversation with one person: their profile's, or their tile's. A group has none. */
function useConversationColor(dmId: string | null): string | null {
  const dm = useSpaceStore((s) => (dmId ? s.dmChannels.find((candidate) => candidate.id === dmId) : undefined));
  const viewer = useDmViewer(dm?.id);
  const partner = dm && !dm.ownerId ? dm.members.find((member) => !isMine(member, viewer.origin, viewer.self)) ?? null : null;
  const canonical = useCanonicalUserView(partner ?? FALLBACK_USER, viewer.origin);
  if (!partner) return null;
  return canonical.accentColor ?? getAvatarGradient(partner.id, canonical.username, canonical.avatarColor).from;
}

/**
 * Tells the lit panels (`.lit`) what colour the place you are in has. Home and the
 * pages around it, and a group, keep the accent, which is what the stylesheet says
 * when nothing is set here.
 */
export function AmbientLight(): null {
  const { pathname } = useLocation();
  const { dmId, spaceId } = placeOf(pathname);
  const spaceColor = useSpaceColor(spaceId);
  const conversationColor = useConversationColor(dmId);
  const color = spaceColor ?? conversationColor;
  const light = color ? lightFromColor(color) : null;

  useEffect(() => {
    const root = document.documentElement;
    if (light) root.style.setProperty('--place-target', light);
    else root.style.removeProperty('--place-target');
    return () => {
      root.style.removeProperty('--place-target');
    };
  }, [light]);

  return null;
}
