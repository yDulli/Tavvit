import { getFriendshipStatus, type FriendshipStatus } from '../../utils/friendshipStatus';
import { ProfileSpaceNickname } from '../ui/ProfileSpaceNickname';
import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '../../i18n/formatters';
import { describeError } from '../../i18n/errors';
import { useNavigate } from 'react-router-dom';
import type { User } from '@backspace/shared';
import { normalizePronouns } from '@backspace/shared/src/profileFields';
import { Avatar } from '../ui/Avatar';
import { Username } from '../ui/Username';
import { ProfileBio } from '../ui/ProfileBio';
import { useUIStore, type ProfileMemberContext } from '../../stores/uiStore';
import { useSpaceStore, getApiForOrigin } from '../../stores/spaceStore';
import { api } from '../../api/client';
import { useSocialStore } from '../../stores/socialStore';
import { useSelfIdentity } from '../../stores/authStore';
import { getAvatarGradient, getSpaceGradient } from '../../utils/gradients';
import { bannerFill } from '../../utils/placeLight';
import { bannerBackground, cardEdge, cardTint, profileThemeOf } from '../../utils/profileTheme';
import { isMine, parseFederatedUsername } from '../../utils/identity';
import { openDirectMessage } from '../../utils/openDirectMessage';
import { normalizeUserAssets } from '../../utils/assetUrls';
import { loadFederatedMutuals, type TaggedMutualFriend, type MutualSpace } from '../../utils/mutuals';
import { friendRequestTarget } from '../../utils/friendRequestTarget';
import { BlockUserButton } from '../social/BlockUserButton';
import { presenceLabel } from '../../i18n/presence';
import { replaceEmojiShortcodes, useEmojiShortcodeNames } from '../../utils/emojiShortcodes';
import { getProfileMember, useProfileBadges, useProfileMemberRoles, useProfileNameStyle, useSpaceProfile } from '../../hooks/useProfileMember';
import { BadgeList } from '../../badges/BadgeList';
import { ProfileActivity } from '../ui/ProfileActivity';
import { profileHeaderLook, profileLayoutOf } from '../../utils/profileLayout';
import { ProfileLinks } from '../ui/ProfileLinks';
import { useShownStatus } from '../../hooks/useShownStatus';
import { ProfileRoles } from '../ui/ProfileRoles';
import { Icon } from '../ui/Icon';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { ProfileBanner } from '../ui/ProfileBanner';
import { DecoratedName, ProfileEffectLayer } from '../ui/Decorations';
import { personDecorations } from '../../utils/decorations';
import { SpaceTagChip, shownSpaceTag } from '../ui/SpaceTag';
import { GatedPicture } from '../ui/ExternalMedia';

type Tab = 'about' | 'friends' | 'spaces';

/** What the badge hook reads before the profile has loaded. */
const EMPTY_PROFILE: Pick<User, 'badges'> = { badges: [] };

export function UserProfileModal() {
  useEmojiShortcodeNames();
  const { t } = useTranslation(['social', 'common']);
  const activeModal = useUIStore((s) => s.activeModal);
  const modalData = useUIStore((s) => s.modalData);
  const closeModal = useUIStore((s) => s.closeModal);
  const addToast = useUIStore((s) => s.addToast);
  const isMobile = useUIStore((s) => s.isMobile);
  const navigate = useNavigate();
  const f = useFormatters();
  const friends = useSocialStore((s) => s.friends);
  const requests = useSocialStore((s) => s.requests);
  const sendFriendRequest = useSocialStore((s) => s.sendFriendRequest);
  const removeFriend = useSocialStore((s) => s.removeFriend);
  const updateFriendRequest = useSocialStore((s) => s.updateFriendRequest);
  const cancelFriendRequest = useSocialStore((s) => s.cancelFriendRequest);
  const self = useSelfIdentity();

  const [user, setUser] = useState<User | null>(null);
  const [userOrigin, setUserOrigin] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('about');
  const [mutualFriends, setMutualFriends] = useState<TaggedMutualFriend[]>([]);
  const [mutualSpaces, setMutualSpaces] = useState<MutualSpace[]>([]);
  const [loadingMutuals, setLoadingMutuals] = useState(false);
  const [friendActionLoading, setFriendActionLoading] = useState(false);

  const isOpen = activeModal === 'userProfile';
  const userId = modalData?.userId as string | undefined;
  const passedUser = modalData?.user as User | undefined;
  const passedOrigin = (modalData?.origin as string | undefined) ?? '';
  const memberContext = (modalData?.member as ProfileMemberContext | null | undefined) ?? null;
  const memberSpaceId = memberContext?.spaceId;
  const memberUserId = memberContext?.userId;
  const roles = useProfileMemberRoles(memberContext);
  // Opened in a space, the name wears the member's top role colour or
  // gradient, as in the member list.
  const nameStyle = useProfileNameStyle(memberContext);
  const { badges, ownerTitle } = useProfileBadges(user ?? EMPTY_PROFILE, memberContext);
  // What the person set for the space the profile was opened in stands in for
  // their account's picture, banner and bio.
  const spaceProfile = useSpaceProfile(memberContext);

  // Determine friendship status (federation-safe canonical matching)
  const friendship: FriendshipStatus = user
    ? getFriendshipStatus({ viewedUser: user, origin: userOrigin, self, friends, requests })
    : { state: 'none' };

  const loadUser = useCallback(async (id: string, origin: string) => {
    try {
      const targetApi = getApiForOrigin(origin);
      const u = await targetApi.users.get(id);
      // Another instance's assets as absolute URLs, like every other row.
      if (origin) normalizeUserAssets(u, origin);
      setUser(u);
      useSpaceStore.getState().upsertUserView(u, origin);
    } catch {
      // User not found
    }
  }, []);

  const loadMutuals = useCallback(async (id: string, targetUser?: User) => {
    setLoadingMutuals(true);
    try {
      const data = await loadFederatedMutuals(id, targetUser?.homeUserId);
      setMutualFriends(data.mutualFriends);
      setMutualSpaces(data.mutualSpaces);
    } catch {
      setMutualFriends([]);
      setMutualSpaces([]);
    } finally {
      setLoadingMutuals(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && userId) {
      setActiveTab('about');
      // Opened with ids only (the mobile profile screen): a space member's
      // user comes from the space it was opened in, whose instance is the one
      // that id belongs to. Looking it up on the home instance would miss for
      // any member of a federated space.
      const fromSpace = !passedUser && memberSpaceId && memberUserId
        ? getProfileMember({ spaceId: memberSpaceId, userId: memberUserId })
        : undefined;
      const knownUser = passedUser ?? fromSpace?.row.user;
      // The instance that issued the row: every opener names it; a member
      // opened by ids alone is its space's.
      const origin = passedUser || !fromSpace ? passedOrigin : fromSpace.origin;
      setUserOrigin(origin);
      // Use a user already in hand (avoids 404 for federated users on local API)
      if (knownUser) {
        setUser(knownUser);
      } else {
        loadUser(userId, origin);
      }
      // One's own profile has nothing in common with itself: no mutuals to ask for.
      if (isMine(knownUser ?? { id: userId }, origin, self)) {
        setMutualFriends([]);
        setMutualSpaces([]);
      } else {
        loadMutuals(userId, knownUser);
      }
    }
  }, [isOpen, userId, passedUser, passedOrigin, memberSpaceId, memberUserId, loadUser, loadMutuals, self]);

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setUser(null);
      setUserOrigin('');
      setMutualFriends([]);
      setMutualSpaces([]);
    }
  }, [isOpen]);

  // Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, closeModal]);

  const shownStatus = useShownStatus(user, userOrigin, user?.status);

  if (!isOpen || !user) return null;

  const { baseName } = parseFederatedUsername(user.username);
  const displayName = user.displayName ?? baseName;
  const look = profileHeaderLook(profileLayoutOf(user), 'full');
  const decorations = personDecorations(user, displayName);
  const spaceTag = shownSpaceTag(user);
  const pronouns = normalizePronouns(user.pronouns) ?? null;
  const bio = spaceProfile.bio ?? user.bio;

  // Banner. Another instance's assets are absolute URLs
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

  const handleSendMessage = async () => {
    try {
      const rowId = await openDirectMessage(user, userOrigin);
      useUIStore.getState().setShowDms(true);
      closeModal();
      navigate(`/channels/@me/${rowId}`);
    } catch (err) {
      addToast(t('social:sendMessage.failed', { reason: describeError(err) }), 'warning');
    }
  };

  const handleAddFriend = async () => {
    setFriendActionLoading(true);
    try {
      await sendFriendRequest(friendRequestTarget(user, userOrigin));
    } catch (err) {
      addToast(describeError(err), 'warning');
    } finally {
      setFriendActionLoading(false);
    }
  };

  const handleRemoveFriend = async () => {
    if (friendship.state !== 'friends') return;
    setFriendActionLoading(true);
    try { await removeFriend(friendship.friend, friendship.friend._instanceOrigin); }
    catch (err) { addToast(describeError(err), 'warning'); }
    finally { setFriendActionLoading(false); }
  };

  const handleCancelRequest = async () => {
    if (friendship.state !== 'outbound_pending') return;
    setFriendActionLoading(true);
    try { await cancelFriendRequest(friendship.request.id, friendship.request._instanceOrigin); }
    catch (err) { addToast(describeError(err), 'warning'); }
    finally { setFriendActionLoading(false); }
  };

  const handleAcceptRequest = async () => {
    if (friendship.state !== 'inbound_pending') return;
    setFriendActionLoading(true);
    try { await updateFriendRequest(friendship.request.id, friendship.request._instanceOrigin, 'accepted'); }
    catch (err) { addToast(describeError(err), 'warning'); }
    finally { setFriendActionLoading(false); }
  };

  const handleDeclineRequest = async () => {
    if (friendship.state !== 'inbound_pending') return;
    setFriendActionLoading(true);
    try { await updateFriendRequest(friendship.request.id, friendship.request._instanceOrigin, 'declined'); }
    catch (err) { addToast(describeError(err), 'warning'); }
    finally { setFriendActionLoading(false); }
  };

  const handleViewFriend = (friend: TaggedMutualFriend) => {
    const friendOrigin = friend._instanceOrigin;
    setUserOrigin(friendOrigin);
    setUser(friend);
    loadMutuals(friend.id, friend);
    setActiveTab('about');
    // Update modal data so re-opening preserves context
    useUIStore.getState().openModal('userProfile', { userId: friend.id, user: friend, origin: friendOrigin });
  };

  const handleGoToSpace = (spaceId: string) => {
    closeModal();
    navigate(`/channels/${spaceId}`);
  };

  // On the phone the settings are a screen of their own, not a dialog. The
  // profile screen they are opened from gives way to them, so Back from the
  // settings returns to where the profile was opened rather than to an empty
  // screen.
  const handleEditProfile = () => {
    const ui = useUIStore.getState();
    ui.closeModal();
    if (!isMobile) {
      ui.openModal('userSettings', { tab: 'account' });
      return;
    }
    if (ui.mobileStack.at(-1)?.screen === 'user-profile') ui.popMobileScreen();
    ui.pushMobileScreen('settings-account');
  };

  const handleEditSpaceProfile = () => {
    if (!memberContext) return;
    const ui = useUIStore.getState();
    // The phone shows this profile as a screen; leave it, so closing the
    // editor shows the space again rather than an empty screen.
    if (isMobile && ui.mobileStack.at(-1)?.screen === 'user-profile') ui.popMobileScreen();
    ui.openModal('spaceProfile', { spaceId: memberContext.spaceId });
  };

  // One's own profile shows only what it says: friends and spaces "in common"
  // with oneself would be all of one's own, so those tabs, and the bar with a
  // single tab left, are not there.
  const isSelf = friendship.state === 'self';
  const tabs: { key: Tab; label: string; count?: number }[] = isSelf
    ? [{ key: 'about', label: t('social:profile.tabs.about') }]
    : [
      { key: 'about', label: t('social:profile.tabs.about') },
      { key: 'friends', label: t('social:profile.tabs.mutualFriends'), count: mutualFriends.length },
      { key: 'spaces', label: t('social:profile.tabs.mutualSpaces'), count: mutualSpaces.length },
    ];
  const shownTab: Tab = isSelf ? 'about' : activeTab;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="modal-scrim absolute inset-0" onClick={closeModal} />
      <div
        className="relative isolate max-w-lg w-full mx-4 max-h-[calc(calc(100*var(--app-vh))-2rem)] flex flex-col glass-modal rounded-lg modal-panel overflow-hidden"
        style={theme ? { backgroundImage: cardTint(theme), borderColor: cardEdge(theme) } : undefined}
      >
        {/* Banner; the compact layout has none, and its close button sits on the header */}
        {look.banner && <ProfileBanner className={`${look.banner} flex-shrink-0`} src={bannerSrc} fallback={bannerFallback} />}
        {/* Over a banner, which can be any picture, the close control carries its own dark ground. */}
        <button
          data-tooltip=""
          type="button"
          onClick={closeModal}
          aria-label={t('common:actions.close')}
          className={look.banner
            ? 'absolute top-3 right-3 z-10 w-8 h-8 rounded-md bg-black/60 hover:bg-black/80 active:bg-black/90 text-white flex items-center justify-center transition-colors'
            : 'icon-btn-lg absolute top-3 right-3 z-10'}
        >
          <Icon name="x" size={16} />
        </button>

        {/* Header (avatar + name) */}
        <div className={`px-6 flex-shrink-0 relative ${look.header}`}>
          <Avatar
            src={spaceProfile.avatar ?? user.avatar}
            name={displayName}
            size={look.avatarSize}
            status={shownStatus}
            userId={user.homeUserId ?? user.id}
            user={user}
            ring={{ width: 5, color: 'rgb(var(--bg-elevated))' }}
            frame={decorations.avatarFrame}
            frameMotion="on"
            className={look.avatar}
          />

          <div className={look.banner ? 'mb-3 min-w-0' : 'min-w-0 pr-10'}>
            <ProfileSpaceNickname member={memberContext} />
            <DecoratedName
              font={decorations.nameFont}
              effect={decorations.nameEffect}
              colors={decorations.colors}
              roleColored={nameStyle !== undefined}
              className="text-title font-semibold tracking-[-0.02em] leading-tight"
              style={nameStyle}
            >
              {displayName}
            </DecoratedName>
            {spaceTag && <SpaceTagChip tag={spaceTag} origin={userOrigin} className="ml-2" />}
            {/* The badges sit beside the handle, in its line (badges.md). */}
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-body text-txt-tertiary">
              <Username username={user.username} showAt className="text-body text-txt-tertiary" />
              {badges.length > 0 && (
                <BadgeList badges={badges} size="md" notes={ownerTitle ? { server_owner: ownerTitle } : undefined} />
              )}
              {pronouns && <span>· {pronouns}</span>}
            </div>
            {user.customStatus && (
              <div className="text-ui text-txt-secondary italic mt-1">
                {replaceEmojiShortcodes(user.customStatus)}
              </div>
            )}
            <ProfileActivity subject={user} origin={userOrigin} isSelf={friendship.state === 'self'} />
          </div>
        </div>

        {/* Tab bar, where there is more than one tab */}
        {tabs.length > 1 && <div className="px-6 flex-shrink-0 border-b border-border-hard">
          <div role="tablist" className="-mx-2 flex gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`relative flex h-9 min-w-0 items-center gap-1.5 px-2 text-ui font-medium transition-colors ${
                  activeTab === tab.key
                    ? 'text-txt-primary'
                    : 'text-txt-tertiary hover:text-txt-secondary'
                }`}
              >
                <span className="truncate">{tab.label}</span>
                {tab.count !== undefined && !loadingMutuals && (
                  <span className="tabular flex-shrink-0 font-mono text-label text-txt-tertiary">{tab.count}</span>
                )}
                {activeTab === tab.key && (
                  <span aria-hidden="true" className="absolute inset-x-2 -bottom-px h-[2px] bg-accent-primary" />
                )}
              </button>
            ))}
          </div>
        </div>}

        {/* Tab content */}
        <div className={`flex-1 overflow-y-auto scrollbar-thin p-6 min-h-[200px] ${tabs.length > 1 ? '' : 'border-t border-border-hard'}`}>
          {shownTab === 'about' && (
            <div className="space-y-4">
              {/* Bio */}
              {bio && (
                <div>
                  <span className="label-mono">
                    {t('social:profile.aboutMe')}
                  </span>
                  <ProfileBio bio={bio} />
                </div>
              )}

              <ProfileLinks links={user.profileLinks} linkedAccounts={user.linkedAccounts} variant="list" />

              <ProfileRoles roles={roles} />

              {/* Member Since */}
              <div>
                <span className="label-mono">
                  {t('social:profile.memberSince')}
                </span>
                <div className="text-ui text-txt-secondary mt-1">
                  {f.formatLongDate(user.createdAt)}
                </div>
              </div>

            </div>
          )}

          {shownTab === 'friends' && (
            <div>
              {loadingMutuals ? (
                <LoadingSpinner size={20} className="py-8 text-txt-tertiary" />
              ) : mutualFriends.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-state-icon" aria-hidden="true">
                    <Icon name="users" size={18} />
                  </span>
                  <p className="empty-state-body">{t('social:mutuals.noFriends')}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2 desktop:grid-cols-2">
                  {mutualFriends.map((friend) => {
                    const fname = friend.displayName ?? parseFederatedUsername(friend.username).baseName;
                    return (
                      <button
                        key={friend.id}
                        type="button"
                        onClick={() => handleViewFriend(friend)}
                        className="surface-card flex min-w-0 items-center gap-2.5 rounded-lg p-2.5 text-left transition-colors hover:border-border-soft hover:bg-interactive-hover active:bg-interactive-active"
                      >
                        <Avatar
                          src={friend.avatar}
                          name={fname}
                          size={32}
                          status={friend.status as 'online' | 'idle' | 'dnd' | 'offline' | null}
                          userId={friend.homeUserId ?? friend.id}
                          avatarColor={friend.avatarColor}
                        />
                        <div className="min-w-0">
                          <div className="text-ui font-medium text-txt-primary truncate">
                            {fname}
                          </div>
                          <div className="text-meta text-txt-tertiary truncate">
                            {presenceLabel(t, friend.status)}
                          </div>
                          {friend._instanceOrigin && (
                            <div className="flex items-center gap-1 font-mono text-2xs text-txt-tertiary">
                              <Icon name="globe" size={10} className="flex-shrink-0" />
                              <span className="truncate">{(() => { try { return new URL(friend._instanceOrigin).host; } catch { return '?'; } })()}</span>
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {shownTab === 'spaces' && (
            <div>
              {loadingMutuals ? (
                <LoadingSpinner size={20} className="py-8 text-txt-tertiary" />
              ) : mutualSpaces.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-state-icon" aria-hidden="true">
                    <Icon name="grid" size={18} />
                  </span>
                  <p className="empty-state-body">{t('social:mutuals.noSpaces')}</p>
                </div>
              ) : (
                <div className="-mx-2.5 space-y-px">
                  {mutualSpaces.map((space) => {
                    const spaceApi = getApiForOrigin(space._instanceOrigin);
                    return (
                    <button
                      key={`${space.id}:${space._instanceOrigin}`}
                      type="button"
                      onClick={() => handleGoToSpace(space.id)}
                      className="list-row w-full text-left"
                    >
                      <div className="relative shrink-0">
                        {(() => {
                          const letter = (
                            <div
                              className="w-8 h-8 rounded-lg flex items-center justify-center text-ui font-semibold text-white"
                              style={{ background: getSpaceGradient(space.id, space.name, space.avatarColor).gradient }}
                            >
                              {space.name.charAt(0).toUpperCase()}
                            </div>
                          );
                          return space.icon ? (
                            <GatedPicture
                              src={space.icon.startsWith('http') ? space.icon : spaceApi.uploads.url(space.icon)}
                              alt={space.name}
                              className="w-8 h-8 rounded-lg object-cover"
                              whileBlocked={letter}
                            />
                          ) : letter;
                        })()}
                      </div>
                      <div className="min-w-0 flex flex-col">
                        <span className="text-ui font-medium text-txt-primary truncate">
                          {space.name}
                        </span>
                        {space._instanceOrigin && (
                          <span className="font-mono text-2xs text-txt-tertiary truncate flex items-center gap-1">
                            <Icon name="globe" size={10} className="flex-shrink-0" />
                            <span className="truncate">{(() => { try { return new URL(space._instanceOrigin).host; } catch { return '?'; } })()}</span>
                          </span>
                        )}
                      </div>
                    </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action buttons. On your own profile you edit it, and in a space
            your profile there; nobody messages or befriends themselves. */}
        {friendship.state === 'self' && (
          <div className="flex-shrink-0 px-6 py-3 border-t border-border-hard flex gap-2">
            <button type="button" onClick={handleEditProfile} className="btn-outline flex-1">
              {t('social:profile.editProfile')}
            </button>
            {memberContext && (
              <button type="button" onClick={handleEditSpaceProfile} className="btn-quiet flex-1">
                {t('social:profile.editSpaceProfile')}
              </button>
            )}
          </div>
        )}
        {friendship.state !== 'self' && (
          <div className="flex-shrink-0 px-6 py-3 border-t border-border-hard flex flex-wrap gap-2">
            {/* Only one thing here is the main action: while a request waits
                for an answer that is the answer, otherwise the conversation. */}
            <button
              type="button"
              onClick={handleSendMessage}
              className={`${friendship.state === 'inbound_pending' ? 'btn-outline' : 'btn-primary'} flex-1`}
            >
              {t('social:profile.sendMessage')}
            </button>

            {friendship.state === 'none' && (
              <button type="button" onClick={handleAddFriend} disabled={friendActionLoading} aria-busy={friendActionLoading} className="btn-outline flex-1">
                {t('social:profile.addFriend')}
              </button>
            )}

            {friendship.state === 'outbound_pending' && (
              <button type="button" onClick={handleCancelRequest} disabled={friendActionLoading} aria-busy={friendActionLoading} className="btn-outline flex-1">
                {t('social:request.cancel')}
              </button>
            )}

            {friendship.state === 'inbound_pending' && (
              <>
                <button type="button" onClick={handleAcceptRequest} disabled={friendActionLoading} aria-busy={friendActionLoading} className="btn-primary flex-1">
                  {t('common:actions.accept')}
                </button>
                <button type="button" onClick={handleDeclineRequest} disabled={friendActionLoading} className="btn-quiet">
                  {t('social:request.ignore')}
                </button>
              </>
            )}

            {friendship.state === 'friends' && (
              <button type="button" onClick={handleRemoveFriend} disabled={friendActionLoading} aria-busy={friendActionLoading} className="btn-outline flex-1 text-txt-danger hover:border-accent-rose/50 hover:bg-accent-rose/10">
                {t('social:friend.remove')}
              </button>
            )}

            <BlockUserButton
              user={user}
              origin={userOrigin}
              className="btn-quiet text-txt-tertiary hover:text-txt-danger"
            />
          </div>
        )}
        {/* The profile's effect, over the whole panel (decorations.md) */}
        <ProfileEffectLayer effect={decorations.profileEffect} className="z-20" />
      </div>

    </div>
  );
}
