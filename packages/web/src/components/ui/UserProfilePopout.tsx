import { StatusPicker } from './StatusPicker';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '../../i18n/formatters';
import { useNavigate } from 'react-router-dom';
import type { User } from '@backspace/shared';
import { normalizePronouns } from '@backspace/shared/src/profileFields';
import { Avatar } from '../ui/Avatar';
import { Username } from '../ui/Username';
import { ProfileBio } from './ProfileBio';
import { useSpaceStore } from '../../stores/spaceStore';
import { api } from '../../api/client';
import { useSelfIdentity } from '../../stores/authStore';
import { openDirectMessage } from '../../utils/openDirectMessage';
import { describeError } from '../../i18n/errors';
import { useUIStore, type ProfileMemberContext } from '../../stores/uiStore';
import { getAvatarGradient } from '../../utils/gradients';
import { bannerFill } from '../../utils/placeLight';
import { bannerBackground, cardEdge, cardTint, profileThemeOf } from '../../utils/profileTheme';
import { isMine, parseFederatedUsername } from '../../utils/identity';
import { useCanonicalUserView } from '../../utils/userViewLookup';
import { loadFederatedMutuals } from '../../utils/mutuals';
import { replaceEmojiShortcodes, useEmojiShortcodeNames } from '../../utils/emojiShortcodes';
import { computeFloatingPosition, type AnchorRect, type Placement } from '../../hooks/useFloatingPosition';
import { useProfileBadges, useProfileMemberRoles, useProfileNameStyle, useSpaceProfile } from '../../hooks/useProfileMember';
import { BadgeList } from '../../badges/BadgeList';
import { ProfileActivity } from './ProfileActivity';
import { profileHeaderLook, profileLayoutOf } from '../../utils/profileLayout';
import { useShownStatus } from '../../hooks/useShownStatus';
import { viewerCanEditMemberRoles } from '../../utils/roleHierarchy';
import { ProfileRoles } from './ProfileRoles';
import { ProfileSpaceNickname } from './ProfileSpaceNickname';
import { BlockUserButton } from '../social/BlockUserButton';
import { ProfileLinks } from './ProfileLinks';
import { ProfileBanner } from './ProfileBanner';

/** Gap between the card and the element it was opened from. */
const ANCHOR_OFFSET = 8;

interface UserProfilePopoutProps {
  user: User;
  /** The instance that issued `user` ('' = the page's own). */
  origin: string;
  onClose: () => void;
  /** Rect of the element the card was opened from. */
  anchor: AnchorRect;
  placement?: Placement;
  /** The space member the card was opened for; shows their roles in that space. */
  member?: ProfileMemberContext | null;
}

export function UserProfilePopout({ user: propUser, origin, onClose, anchor, placement = 'right', member = null }: UserProfilePopoutProps) {
  useEmojiShortcodeNames();
  const { t } = useTranslation(['social', 'common']);
  const navigate = useNavigate();
  const f = useFormatters();
  const openModal = useUIStore((s) => s.openModal);
  const addToast = useUIStore((s) => s.addToast);
  // How this person looks at best (the userViews cache). The prop can be a
  // copy from another instance; the cache surfaces their home's view. The
  // row's identity fields and `origin` stay what every request below uses.
  const user = useCanonicalUserView(propUser, origin);
  const { baseName } = parseFederatedUsername(user.username);
  const displayName = user.displayName ?? baseName;
  const shownStatus = useShownStatus(user, origin, user.status);
  const self = useSelfIdentity();
  const isYou = isMine(user, origin, self);

  const roles = useProfileMemberRoles(member);
  // Opened in a space, the name wears the member's top role colour or
  // gradient, as in the member list.
  const nameStyle = useProfileNameStyle(member);
  const { badges, ownerTitle } = useProfileBadges(user, member);
  // What the person set for the space the card was opened in stands in for
  // their account's picture, banner and bio.
  const spaceProfile = useSpaceProfile(member);
  const look = profileHeaderLook(profileLayoutOf(user), 'card');
  const pronouns = normalizePronouns(user.pronouns) ?? null;
  const bio = spaceProfile.bio ?? user.bio;
  const isMobile = useUIStore((s) => s.isMobile);
  // Edit Roles opens the member role editor, which is desktop-only. It is
  // offered by the rule the editor gates with (permissions.md, "Role
  // hierarchy"), read from the loaded space the card was opened in.
  const canEditRoles = useSpaceStore((s) => {
    if (!member || s.currentSpaceId !== member.spaceId) return false;
    const space = s.spaces.find((sp) => sp.id === member.spaceId);
    const target = s.members.find((m) => m.userId === member.userId);
    if (!space || !target) return false;
    return viewerCanEditMemberRoles(space, s.members, s.roles, s.spacePermissions.get(space.id), target);
  }) && !isMobile;

  const [mutualCounts, setMutualCounts] = useState<{ friends: number; spaces: number } | null>(null);

  useEffect(() => {
    loadFederatedMutuals(user.id, user.homeUserId)
      .then((data) => setMutualCounts({ friends: data.mutualFriends.length, spaces: data.mutualSpaces.length }))
      .catch(() => {});
  }, [user.id, user.homeUserId]);

  // Placed off the card's *measured* size rather than a guessed height: the card
  // grows with the bio, the custom status and the mutuals row, so any constant
  // here would cut tall cards off at the bottom of the viewport.
  const cardRef = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    const place = () => {
      const { width, height } = card.getBoundingClientRect();
      // 'start': the card's top edge lines up with the row it came from, the
      // way it always has — centring a tall card on a 32px avatar would drag it
      // up over unrelated content.
      const next = computeFloatingPosition(anchor, width, height, placement, ANCHOR_OFFSET, 'start');
      setPlaced((prev) =>
        prev && prev.top === next.top && prev.left === next.left
          ? prev
          : { top: next.top, left: next.left },
      );
    };

    place();
    const observer = new ResizeObserver(place);
    observer.observe(card);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [anchor, placement]);

  const handleSendMessage = async () => {
    try {
      const rowId = await openDirectMessage(user, origin);
      useUIStore.getState().setShowDms(true);
      onClose();
      navigate(`/channels/@me/${rowId}`);
    } catch (err) {
      addToast(t('social:sendMessage.failed', { reason: describeError(err) }), 'warning');
    }
  };

  const handleViewFullProfile = () => {
    onClose();
    openModal('userProfile', { userId: user.id, user, origin, member });
  };

  const handleEditRoles = () => {
    if (!member) return;
    onClose();
    openModal('memberRoles', { spaceId: member.spaceId, userId: member.userId });
  };

  const handleEditProfile = () => {
    onClose();
    openModal('userSettings', { tab: 'account' });
  };

  const handleEditSpaceProfile = () => {
    if (!member) return;
    onClose();
    openModal('spaceProfile', { spaceId: member.spaceId });
  };

  const handleAvatarClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    handleViewFullProfile();
  };

  // Banner display. Another instance's assets arrive as absolute URLs
  // (`normalizeUserAssets`); a bare filename is the page's own instance's.
  const bannerFile = spaceProfile.banner ?? user.banner;
  const bannerSrc = bannerFile
    ? (bannerFile.startsWith('http') || bannerFile.startsWith('/') ? bannerFile : api.uploads.url(bannerFile))
    : null;
  const theme = profileThemeOf(user);
  const bannerFallback = theme
    ? bannerBackground(theme)
    : (() => {
        const g = getAvatarGradient(user.homeUserId ?? user.id, displayName, user.avatarColor);
        return bannerFill(g.from);
      })();
  // A profile theme lifts the top of the card to about the tone of the plain
  // hairline, which would vanish there; on a tinted card the lines take the
  // control edge's tone instead.
  const divider = theme ? 'my-3.5 h-px bg-border-soft' : 'divider-fade my-3.5';

  // Parked off-screen for the one layout pass before the card knows how tall it
  // is; `useLayoutEffect` places it before the browser paints, so it never
  // renders visibly in the wrong spot.
  const cardStyle = {
    ...(placed ?? { top: -9999, left: -9999 }),
    // The person's profile theme: a faint tint down the card and an edge in their first colour.
    ...(theme ? { backgroundImage: cardTint(theme), borderColor: cardEdge(theme) } : {}),
  };

  return (
    <div
      ref={cardRef}
      data-user-profile-popout
      className="fixed z-[200] w-[340px] rounded-lg overflow-hidden animate-pop select-none glass-modal"
      style={cardStyle}
    >
      {/* Banner; the compact layout has none */}
      {look.banner && <ProfileBanner className={look.banner} src={bannerSrc} fallback={bannerFallback} />}

      {/* Body */}
      <div className="px-4 pb-4 relative">

        <div className={look.header}>
          {/* Avatar */}
          {/* The picture escalates to the full profile — the card is a preview, and
              clicking the face is the obvious way to ask for the whole thing. It
              deliberately does NOT reopen the card (see issue #37). */}
          <Avatar
            src={spaceProfile.avatar ?? user.avatar}
            name={displayName}
            size={look.avatarSize}
            status={shownStatus}
            userId={user.homeUserId ?? user.id}
            user={user}
            onClick={handleAvatarClick}
            ring={{ width: 5, color: 'rgb(var(--bg-elevated))' }}
            className={look.avatar}
          />

          {/* Name & info */}
          <div className="min-w-0">
            <ProfileSpaceNickname member={member} />
            <span className="text-title font-semibold tracking-[-0.02em] leading-tight" style={nameStyle}>{displayName}</span>
            {/* The badges sit beside the handle, in its line (badges.md). */}
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-ui text-txt-tertiary">
              <Username username={user.username} showAt className="text-ui text-txt-tertiary" />
              {badges.length > 0 && (
                <BadgeList badges={badges} size="sm" notes={ownerTitle ? { server_owner: ownerTitle } : undefined} />
              )}
              {pronouns && <span>· {pronouns}</span>}
            </div>
            {user.customStatus && (
              <div className="text-ui text-txt-secondary italic mt-1">
                {replaceEmojiShortcodes(user.customStatus)}
              </div>
            )}
            <ProfileActivity subject={user} origin={origin} isSelf={isYou} />
          </div>
        </div>

        {/* Bio */}
        {bio && (
          <>
            <div className={divider} />
            <div>
              <span className="label-mono">
                {t('social:profile.aboutMe')}
              </span>
              <ProfileBio bio={bio} />
            </div>
          </>
        )}

        {(user.profileLinks?.length ?? 0) > 0 && (
          <>
            <div className={divider} />
            <ProfileLinks links={user.profileLinks} variant="chips" />
          </>
        )}

        {roles.length > 0 && (
          <>
            <div className={divider} />
            <ProfileRoles roles={roles} />
          </>
        )}

        <div className={divider} />

        {/* Member since + Mutuals */}
        <div className="space-y-1.5">
          <div>
            <span className="label-mono">
              {t('social:profile.memberSince')}
            </span>
            <span className="text-meta text-txt-secondary ml-2">
              {f.formatMediumDate(user.createdAt)}
            </span>
          </div>
          {mutualCounts && (mutualCounts.friends > 0 || mutualCounts.spaces > 0) && (
            <div className="text-meta text-txt-tertiary">
              {mutualCounts.friends > 0 && (
                <span>{t('social:mutuals.friends', { count: mutualCounts.friends })}</span>
              )}
              {mutualCounts.friends > 0 && mutualCounts.spaces > 0 && (
                <span className="mx-1">&middot;</span>
              )}
              {mutualCounts.spaces > 0 && (
                <span>{t('social:mutuals.spaces', { count: mutualCounts.spaces })}</span>
              )}
            </div>
          )}
        </div>

        {isYou && <StatusPicker className="mt-3.5" />}

        {/* Actions. Nobody sends themselves a message; on their own card a
            person edits their profile, and in a space their profile there.
            One outlined button for what the card is mostly for, the quieter
            ones in a line under it so a full card still fits a small window. */}
        <button
          type="button"
          onClick={isYou ? handleEditProfile : handleSendMessage}
          className="btn-outline mt-3.5 w-full"
        >
          {isYou ? t('social:profile.editProfile') : t('social:profile.sendMessage')}
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-x-1">
          {isYou && member && (
            <button
              type="button"
              onClick={handleEditSpaceProfile}
              className="btn-quiet btn-sm flex-auto"
            >
              {t('social:profile.editSpaceProfile')}
            </button>
          )}
          {canEditRoles && (
            <button
              type="button"
              onClick={handleEditRoles}
              className="btn-quiet btn-sm flex-auto"
            >
              {t('social:profile.editRoles')}
            </button>
          )}
          <button
            type="button"
            onClick={handleViewFullProfile}
            className="btn-quiet btn-sm flex-auto"
          >
            {t('social:profile.viewFull')}
          </button>
          <BlockUserButton
            user={user}
            origin={origin}
            onDone={onClose}
            className="btn-quiet btn-sm flex-auto text-txt-tertiary hover:text-txt-danger"
          />
        </div>
      </div>
    </div>
  );
}
