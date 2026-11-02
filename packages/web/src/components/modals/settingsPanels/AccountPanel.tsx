import { DataExportSection } from './DataExportSection';
import { cssUrl } from '../../../utils/cssUrl';
import { StorageSection } from './StorageSection';
import { StatusPicker } from '../../ui/StatusPicker';
import { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../stores/authStore';
import { useUIStore } from '../../../stores/uiStore';
import { useInstanceStore } from '../../../stores/instanceStore';
import { useSpaceStore } from '../../../stores/spaceStore';
import { Avatar, avatarRadius } from '../../ui/Avatar';
import { Icon } from '../../ui/Icon';
import { ImageCropModal } from '../../ui/ImageCropModal';
import { DeleteAccountModal } from '../DeleteAccountModal';
import { api } from '../../../api/client';
import { useTransferStore } from '../../../stores/transferStore';
import { waitForTransferAttachment } from '../../../utils/waitForTransfer';
import { getAvatarGradient, AVATAR_GRADIENT_MAP } from '../../../utils/gradients';
import { bannerFill } from '../../../utils/placeLight';
import { bannerBackground, profileThemeOf } from '../../../utils/profileTheme';
import { ProfileThemeEditor } from './ProfileThemeEditor';
import { ProfileDetailsEditor, invalidLinkDrafts, linkDrafts, linksOfDrafts, type ProfileLinkDraft } from './ProfileDetailsEditor';
import { FormError, SettingsField, SettingsPage, SettingsSection, SWATCH_ROW, SwatchButton } from './_shared/SettingsControls';
import { UsernameSection } from './UsernameSection';
import { ProfileLinks } from '../../ui/ProfileLinks';
import { profileHeaderLook, profileLayoutOf } from '../../../utils/profileLayout';
import { AVATAR_COLORS, PROFILE_LIMITS, detachedHomeOf } from '@backspace/shared';
import { MAX_PROFILE_IMAGE_SOURCE_BYTES, type ProfileImageCrop, type ProfileImageKind } from '@backspace/shared/src/profileImage';
import type { User, AvatarColor, ProfileLayout } from '@backspace/shared';
import { describeError } from '../../../i18n/errors';
import { base64OfDataUrl, bytesOfDataUrl, isAnimatedImage } from '../../../utils/animatedImage';
import { useFormatters } from '../../../i18n/formatters';
import {
  STATUS_EXPIRY_CHOICES,
  expiryMinutes,
  initialExpiryChoice,
  isFutureEnd,
  type StatusExpiryChoice,
} from '../../../utils/customStatusExpiry';

const BIO_MAX_LENGTH = 190;

/** Taking a picture away, beside the button that changes it: quiet until it is meant. */
const REMOVE_BUTTON = 'btn-quiet btn-sm text-txt-danger hover:bg-accent-rose/10 hover:text-txt-danger';

/** Over a picture that is also a button: what a press does under the pointer, and a ring while it uploads. */
function PictureOverlay({ busy, radius }: { busy: boolean; radius?: string }) {
  return (
    <>
      <span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        style={{ borderRadius: radius }}
      >
        <Icon name="upload" size={18} />
      </span>
      {busy && (
        <span
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center bg-black/60 text-white"
          style={{ borderRadius: radius }}
        >
          <span className="h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-r-transparent" />
        </span>
      )}
    </>
  );
}

export function AccountPanel() {
  const { t } = useTranslation(['settings', 'common']);
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [customStatus, setCustomStatus] = useState(user?.customStatus ?? '');
  const [statusExpiry, setStatusExpiry] = useState<StatusExpiryChoice>(
    () => initialExpiryChoice(user?.customStatusExpiresAt, Date.now()),
  );
  const f = useFormatters();
  const [bio, setBio] = useState(user?.bio ?? '');
  const [accentColor, setAccentColor] = useState<string | null>(user?.accentColor ?? null);
  const [accentSecondary, setAccentSecondary] = useState<string | null>(user?.accentColorSecondary ?? null);
  const [avatarColorState, setAvatarColorState] = useState<AvatarColor | null>(user?.avatarColor ?? null);
  // The profile card's own fields: pronouns, links and the card's layout.
  const [pronouns, setPronouns] = useState(user?.pronouns ?? '');
  const [links, setLinks] = useState<ProfileLinkDraft[]>(() => linkDrafts(user?.profileLinks));
  const [invalidLinks, setInvalidLinks] = useState<ReadonlySet<number>>(new Set());
  const [layout, setLayout] = useState<ProfileLayout>(() => profileLayoutOf(user ?? {}));

  // Avatar upload state
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFilename, setAvatarFilename] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarCropSrc, setAvatarCropSrc] = useState<string | null>(null);
  // The original of an animated avatar, base64: the server cuts it, not the browser.
  const [avatarAnimated, setAvatarAnimated] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // Banner upload state
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [bannerFilename, setBannerFilename] = useState<string | null>(null);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [bannerCropSrc, setBannerCropSrc] = useState<string | null>(null);
  const [bannerAnimated, setBannerAnimated] = useState<string | null>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const addToast = useUIStore((s) => s.addToast);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // The stored links by content: every fresh copy of the user (a reconnect's
  // ready, a user_updated echo) carries a new array, which must not count as a
  // change and throw away what is being edited here.
  const storedLinksKey = JSON.stringify(user?.profileLinks ?? []);

  // Every draft from what the instance holds: for a fresh copy of the user,
  // on Reset and after a save. The server stores some fields in a normalised
  // form (trimmed text, a link's full address, duplicates dropped), so a save
  // whose result equals what was stored before must still re-seed the drafts,
  // or the edit it normalised away would linger as unsaved.
  const resetDraftsFrom = (source: User) => {
    setDisplayName(source.displayName ?? '');
    setCustomStatus(source.customStatus ?? '');
    setStatusExpiry(initialExpiryChoice(source.customStatusExpiresAt, Date.now()));
    setBio(source.bio ?? '');
    setAccentColor(source.accentColor ?? null);
    setAccentSecondary(source.accentColorSecondary ?? null);
    setAvatarColorState(source.avatarColor ?? null);
    setPronouns(source.pronouns ?? '');
    setLinks(linkDrafts(source.profileLinks));
    setInvalidLinks(new Set());
    setLayout(profileLayoutOf(source));
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    if (bannerPreview) URL.revokeObjectURL(bannerPreview);
    setAvatarPreview(null);
    setAvatarFilename(null);
    setBannerPreview(null);
    setBannerFilename(null);
  };

  useEffect(() => {
    if (user) resetDraftsFrom(user);
  }, [user?.displayName, user?.customStatus, user?.customStatusExpiresAt, user?.bio, user?.accentColor, user?.accentColorSecondary, user?.avatarColor, user?.avatar, user?.banner, user?.pronouns, storedLinksKey, user?.profileLayout]);

  // Delete account state
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const instances = useInstanceStore((s) => s.instances);

  // ── Detached-account re-attach (fallback path, re-attach spec §3.4) ──
  // Explicit action shown only when this client also holds an active connection
  // to the account's home domain. Two-step armed confirm names both identities
  // before minting the proof. The primary/automatic path lives in instanceStore.
  const [reattachArmed, setReattachArmed] = useState(false);
  const [reattaching, setReattaching] = useState(false);
  const [reattachError, setReattachError] = useState<string | null>(null);

  // The home a detached account was federated from. A detached account is
  // homed on this instance, so `homeInstance` is null and only this names it.
  const formerHome = user ? detachedHomeOf(user) : null;

  const homeConnection = useMemo(() => {
    if (!formerHome) return null;
    const homeDomain = formerHome.replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();
    return instances.find(
      (i) => i.status === 'connected'
        // Portless hostname — must agree with the server's extractDomain
        // (new URL(origin).hostname) so a ported home instance still matches.
        && new URL(i.origin).hostname.toLowerCase() === homeDomain,
    ) ?? null;
  }, [instances, formerHome]);

  const handleReattach = async () => {
    if (!homeConnection) return;
    if (!reattachArmed) {
      setReattachArmed(true);
      return;
    }
    setReattaching(true);
    setReattachError(null);
    try {
      // Target domain = THIS instance (where the detached account lives).
      // Portless hostname to match the server's extractDomain contract.
      const { token } = await homeConnection.api.auth.attachProof(window.location.hostname);
      const res = await api.users.reattach({ token });
      useAuthStore.getState().setUser(res.user);
      // Re-attach reconciled this (home) account's 1-on-1 DM federatedIds on the
      // server; refetch the home DM list so the split conversation collapses
      // without a reload.
      try { await useSpaceStore.getState().reloadDmsForOrigin(''); } catch { /* non-fatal */ }
      addToast(t('settings:account.detached.reattached', { username: homeConnection.username }), 'success', 3000);
    } catch (err) {
      setReattachError(err instanceof Error ? describeError(err) : t('settings:account.detached.reattachFailed'));
    } finally {
      setReattaching(false);
      setReattachArmed(false);
    }
  };

  if (!user) return null;

  const effectiveDisplayName = displayName.trim() || user.username;
  const theme = profileThemeOf({ accentColor, accentColorSecondary: accentSecondary });
  const effectiveAvatarColor = avatarColorState;
  const look = profileHeaderLook(layout, 'preview');
  const draftLinks = linksOfDrafts(links);
  const linksChanged = JSON.stringify(draftLinks) !== JSON.stringify((user.profileLinks ?? []).map((link) => ({ url: link.url, label: link.label ?? null })));

  // Change detection
  const hasChanges =
    pronouns.trim() !== (user.pronouns ?? '') ||
    linksChanged ||
    layout !== profileLayoutOf(user) ||
    displayName !== (user.displayName ?? '') ||
    customStatus !== (user.customStatus ?? '') ||
    statusExpiry !== initialExpiryChoice(user.customStatusExpiresAt, Date.now()) ||
    bio !== (user.bio ?? '') ||
    accentColor !== (user.accentColor ?? null) ||
    accentSecondary !== (user.accentColorSecondary ?? null) ||
    avatarColorState !== (user.avatarColor ?? null) ||
    avatarFilename !== null ||
    bannerFilename !== null;

  // Compute banner display
  const currentBannerUrl = user.banner
    ? (user.banner.startsWith('http') ? user.banner : api.uploads.url(user.banner))
    : null;
  const displayBannerSrc = bannerPreview ?? (bannerFilename === '' ? null : currentBannerUrl);

  // Compute avatar display
  const currentAvatarSrc = user.avatar
    ? (user.avatar.startsWith('http') ? user.avatar : api.uploads.url(user.avatar))
    : null;
  const displayAvatarSrc = avatarPreview ?? (avatarFilename === '' ? null : currentAvatarSrc);

  // Banner fallback: accent gradient or avatar gradient (alpha baked into gradient colors)
  const bannerFallback = theme
    ? bannerBackground(theme)
    : (() => {
        const g = getAvatarGradient(user.homeUserId ?? user.id, effectiveDisplayName, effectiveAvatarColor);
        return bannerFill(g.from);
      })();

  // ── File selection handlers ──
  /**
   * Reads the chosen picture. A still image goes to the crop modal as it
   * always did. An animation (GIF, animated WebP) goes there too, to choose
   * the area, but is kept as the original: a canvas would keep one frame.
   */
  const readPicture = (
    file: File,
    kind: ProfileImageKind,
    open: (dataUrl: string) => void,
    keepAnimated: (base64: string | null) => void,
  ) => {
    const mayAnimate = file.type === 'image/gif' || file.type === 'image/webp';
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const animated = mayAnimate && isAnimatedImage(bytesOfDataUrl(dataUrl));
      // Still images are shrunk in the browser; only an animation has a size limit.
      if (animated && file.size > MAX_PROFILE_IMAGE_SOURCE_BYTES) {
        setError(t('settings:account.profile.image.animationTooLarge', { max: MAX_PROFILE_IMAGE_SOURCE_BYTES / (1024 * 1024) }));
        return;
      }
      setError('');
      keepAnimated(animated ? base64OfDataUrl(dataUrl) : null);
      open(dataUrl);
    };
    reader.onerror = () => setError(t(kind === 'avatar' ? 'settings:account.profile.avatar.uploadFailed' : 'settings:account.profile.banner.uploadFailed'));
    reader.readAsDataURL(file);
  };

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    readPicture(file, 'avatar', setAvatarCropSrc, setAvatarAnimated);
    if (avatarInputRef.current) avatarInputRef.current.value = '';
  };

  const handleBannerSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    readPicture(file, 'banner', setBannerCropSrc, setBannerAnimated);
    if (bannerInputRef.current) bannerInputRef.current.value = '';
  };

  /** Has the server cut the animation, then shows and keeps the finished file like an upload. */
  const handleAnimatedCrop = async (
    kind: ProfileImageKind,
    source: string | null,
    crop: ProfileImageCrop,
  ) => {
    if (source === null) return;
    const isAvatar = kind === 'avatar';
    (isAvatar ? setUploadingAvatar : setUploadingBanner)(true);
    setError('');
    try {
      const { filename } = await api.users.profileImage({ kind, image: source, crop });
      const url = api.uploads.url(filename);
      if (isAvatar) { setAvatarPreview(url); setAvatarFilename(filename); }
      else { setBannerPreview(url); setBannerFilename(filename); }
    } catch (err) {
      setError(describeError(err));
    } finally {
      (isAvatar ? setUploadingAvatar : setUploadingBanner)(false);
    }
  };

  // ── Crop complete handlers ──
  const handleAvatarCropComplete = async (blob: Blob) => {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    const previewUrl = URL.createObjectURL(blob);
    setAvatarPreview(previewUrl);
    setAvatarCropSrc(null);
    const file = new File([blob], 'avatar.webp', { type: blob.type || 'image/webp' });
    setUploadingAvatar(true);
    try {
      const tid = await useTransferStore.getState().startUpload(file, { tray: false });
      const { filename } = await waitForTransferAttachment(tid);
      setAvatarFilename(filename);
    } catch {
      setError(t('settings:account.profile.avatar.uploadFailed'));
      setAvatarPreview(null);
      URL.revokeObjectURL(previewUrl);
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleBannerCropComplete = async (blob: Blob) => {
    if (bannerPreview) URL.revokeObjectURL(bannerPreview);
    const previewUrl = URL.createObjectURL(blob);
    setBannerPreview(previewUrl);
    setBannerCropSrc(null);
    const file = new File([blob], 'banner.webp', { type: blob.type || 'image/webp' });
    setUploadingBanner(true);
    try {
      const tid = await useTransferStore.getState().startUpload(file, { tray: false });
      const { filename } = await waitForTransferAttachment(tid);
      setBannerFilename(filename);
    } catch {
      setError(t('settings:account.profile.banner.uploadFailed'));
      setBannerPreview(null);
      URL.revokeObjectURL(previewUrl);
    } finally {
      setUploadingBanner(false);
    }
  };

  const handleRemoveAvatar = () => {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarPreview(null);
    setAvatarFilename('');
  };

  const handleRemoveBanner = () => {
    if (bannerPreview) URL.revokeObjectURL(bannerPreview);
    setBannerPreview(null);
    setBannerFilename('');
  };

  const handleSave = async () => {
    setError('');
    // A link the instance would refuse is pointed out here, before anything is sent.
    const invalid = invalidLinkDrafts(links);
    setInvalidLinks(invalid);
    if (invalid.size > 0) {
      setError(t('settings:account.profile.links.invalid', { max: PROFILE_LIMITS.MAX_LINK_URL_LENGTH }));
      return;
    }
    setIsLoading(true);
    try {
      const updates: Parameters<typeof updateProfile>[0] = {};
      if (pronouns.trim() !== (user.pronouns ?? '')) updates.pronouns = pronouns.trim();
      if (linksChanged) updates.profileLinks = draftLinks.length > 0 ? draftLinks : null;
      if (layout !== profileLayoutOf(user)) updates.profileLayout = layout;
      if (displayName !== (user.displayName ?? '')) updates.displayName = displayName.trim();
      if (customStatus !== (user.customStatus ?? '')) updates.customStatus = customStatus.trim();
      // The end counts from this save. Clearing the status needs none (the server drops it with the text).
      const expiryChanged = statusExpiry !== initialExpiryChoice(user.customStatusExpiresAt, Date.now());
      if ((updates.customStatus !== undefined || expiryChanged) && customStatus.trim() !== '') {
        updates.customStatusExpiresInMinutes = expiryMinutes(statusExpiry, new Date(), user.customStatusExpiresAt);
      }
      if (bio !== (user.bio ?? '')) updates.bio = bio.trim();
      if (accentColor !== (user.accentColor ?? null)) updates.accentColor = accentColor ?? '';
      if (accentSecondary !== (user.accentColorSecondary ?? null)) updates.accentColorSecondary = accentSecondary ?? '';
      if (avatarColorState !== (user.avatarColor ?? null)) updates.avatarColor = avatarColorState ?? '';
      if (avatarFilename !== null) updates.avatar = avatarFilename;
      if (bannerFilename !== null) updates.banner = bannerFilename;

      await updateProfile(updates);
      const stored = useAuthStore.getState();
      if (stored.user) resetDraftsFrom(stored.user);
      addToast(t('settings:account.save.updated'), 'success', 2000);
    } catch (err) {
      setError(err instanceof Error ? describeError(err) : t('settings:account.save.failed'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    resetDraftsFrom(user);
    setError('');
  };

  return (
    <SettingsPage title={t('settings:account.title')}>
      {formerHome && (
        <div className="rounded-lg border border-accent-amber/25 bg-accent-amber/10 px-3.5 py-3 text-meta leading-relaxed text-txt-secondary">
          <span className="font-medium text-txt-primary">{t('settings:account.detached.notice')}</span>{' '}
          {t('settings:account.detached.explanation', { homeInstance: formerHome })}
          {homeConnection && (
            <>
              {' '}{t('settings:account.detached.reattachHint', { username: homeConnection.username, homeInstance: formerHome })}
              <button
                type="button"
                onClick={handleReattach}
                disabled={reattaching}
                aria-busy={reattaching}
                className="btn-outline btn-sm mt-2 flex h-auto min-h-7 whitespace-normal py-1 text-left"
              >
                {reattaching
                  ? t('settings:account.detached.reattaching')
                  : reattachArmed
                    ? t('settings:account.detached.reattachConfirm', { username: homeConnection.username })
                    : t('settings:account.detached.reattachButton', { homeInstance: formerHome })}
              </button>
              {reattachError && <div className="mt-1.5 text-txt-danger">{reattachError}</div>}
            </>
          )}
        </div>
      )}
      {/* ── Profile Customization ── */}
      <SettingsSection
        title={t('settings:account.profile.sectionTitle')}
        lead={
          // Live preview: the layout, pronouns and links as the card will show them.
          <div className="overflow-hidden rounded-lg border border-border-hard bg-surface-channel">
            {/* Banner area; the compact layout has none */}
            {look.banner && (
              <div
                className={look.banner}
                style={displayBannerSrc
                  ? { backgroundImage: cssUrl(displayBannerSrc), backgroundSize: 'cover', backgroundPosition: 'center' }
                  : { background: bannerFallback }
                }
              />
            )}
            {/* Avatar + info */}
            <div className="px-4 pb-3">
              <div className={look.header}>
                <Avatar
                  src={avatarPreview ?? (avatarFilename === '' ? null : user.avatar)}
                  name={effectiveDisplayName}
                  size={look.avatarSize}
                  userId={user.homeUserId ?? user.id}
                  user={{ ...user, avatarColor: effectiveAvatarColor } as User}
                  ring={{ width: 4, color: 'rgb(var(--bg-channel))' }}
                  className={look.avatar}
                />
                <div className="min-w-0 max-w-full">
                  <div className="truncate text-lead font-semibold leading-tight text-txt-primary">{effectiveDisplayName}</div>
                  <div className="truncate text-meta text-txt-tertiary">
                    @{user.username}
                    {pronouns.trim() && <span className="ml-1.5">· {pronouns.trim()}</span>}
                  </div>
                </div>
              </div>
              {bio.trim() && (
                <div className="mt-1.5 line-clamp-3 whitespace-pre-wrap break-words text-meta text-txt-secondary">
                  {bio.trim()}
                </div>
              )}
              {draftLinks.length > 0 && (
                <div className="mt-2.5">
                  <ProfileLinks links={draftLinks} variant="chips" />
                </div>
              )}
            </div>
          </div>
        }
      >
        {/* Avatar upload */}
        <SettingsField label={t('settings:account.profile.avatar.label')}>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              disabled={uploadingAvatar}
              aria-label={t('settings:account.profile.avatar.change')}
              className="group relative flex-shrink-0"
              style={{ borderRadius: avatarRadius(64) }}
            >
              <Avatar
                src={displayAvatarSrc}
                name={effectiveDisplayName}
                size={64}
                userId={user.homeUserId ?? user.id}
                user={{ ...user, avatarColor: effectiveAvatarColor } as User}
              />
              <PictureOverlay busy={uploadingAvatar} radius={avatarRadius(64)} />
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="btn-outline btn-sm"
              >
                {t('settings:account.profile.avatar.change')}
              </button>
              {(displayAvatarSrc || user.avatar) && avatarFilename !== '' && (
                <button type="button" onClick={handleRemoveAvatar} className={REMOVE_BUTTON}>
                  {t('common:actions.remove')}
                </button>
              )}
            </div>
          </div>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            onChange={handleAvatarSelect}
            className="hidden"
          />
        </SettingsField>

        {/* Banner upload */}
        <SettingsField label={t('settings:account.profile.banner.label')}>
          <button
            type="button"
            onClick={() => bannerInputRef.current?.click()}
            disabled={uploadingBanner}
            aria-label={t('settings:account.profile.banner.change')}
            className="group relative block h-[72px] w-full overflow-hidden rounded-md border border-border-hard"
          >
            <div
              className="h-full w-full"
              style={displayBannerSrc
                ? { backgroundImage: cssUrl(displayBannerSrc), backgroundSize: 'cover', backgroundPosition: 'center' }
                : { background: bannerFallback }
              }
            />
            <PictureOverlay busy={uploadingBanner} />
          </button>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => bannerInputRef.current?.click()}
              disabled={uploadingBanner}
              className="btn-outline btn-sm"
            >
              {t('settings:account.profile.banner.change')}
            </button>
            {(displayBannerSrc || user.banner) && bannerFilename !== '' && (
              <button type="button" onClick={handleRemoveBanner} className={REMOVE_BUTTON}>
                {t('common:actions.remove')}
              </button>
            )}
          </div>
          <input
            ref={bannerInputRef}
            type="file"
            accept="image/*"
            onChange={handleBannerSelect}
            className="hidden"
          />
        </SettingsField>

        {/* Avatar Color */}
        <SettingsField label={t('settings:account.profile.avatarColor.label')}>
          <div className={SWATCH_ROW}>
            {AVATAR_COLORS.map((key) => (
              <SwatchButton
                key={key}
                label={t(`common:colors.${key}`)}
                background={AVATAR_GRADIENT_MAP[key].gradient}
                selected={avatarColorState === key}
                onClick={() => setAvatarColorState(key)}
              />
            ))}
          </div>
        </SettingsField>

        {/* Profile theme: two colours for the banner and the card */}
        <ProfileThemeEditor
          value={{ primary: accentColor, secondary: accentSecondary }}
          onChange={({ primary, secondary }) => { setAccentColor(primary); setAccentSecondary(secondary); }}
        />

        <ProfileDetailsEditor
          pronouns={pronouns}
          onPronouns={setPronouns}
          links={links}
          onLinks={(next) => { setLinks(next); setInvalidLinks(new Set()); }}
          invalidLinks={invalidLinks}
          layout={layout}
          onLayout={setLayout}
        />

        {/* Bio */}
        <SettingsField label={t('settings:account.profile.bio.label')} htmlFor="profile-bio">
          <div className="relative">
            <textarea
              id="profile-bio"
              value={bio}
              onChange={(e) => {
                if (e.target.value.length <= BIO_MAX_LENGTH) setBio(e.target.value);
              }}
              rows={3}
              placeholder={t('settings:account.profile.bio.placeholder')}
              className="input-standard block w-full resize-none pb-6"
              maxLength={BIO_MAX_LENGTH}
            />
            <span className="pointer-events-none absolute bottom-1.5 right-2.5 font-mono text-2xs tabular text-txt-tertiary">
              {t('settings:account.profile.bio.counter', { used: bio.length, max: BIO_MAX_LENGTH })}
            </span>
          </div>
        </SettingsField>
      </SettingsSection>

      {/* ── Account ── */}
      <SettingsSection title={t('settings:account.details.sectionTitle')}>
        <StatusPicker />

        <SettingsField label={t('common:labels.displayName')} htmlFor="account-display-name">
          <input
            id="account-display-name"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="input-standard w-full"
          />
        </SettingsField>

        <SettingsField label={t('settings:account.details.customStatus.label')} htmlFor="account-custom-status">
          <input
            id="account-custom-status"
            type="text"
            value={customStatus}
            onChange={(e) => setCustomStatus(e.target.value)}
            className="input-standard w-full"
            placeholder={t('settings:account.details.customStatus.placeholder')}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label htmlFor="custom-status-expiry" className="text-meta text-txt-secondary">
              {t('settings:account.details.customStatus.expiry.label')}
            </label>
            <select
              id="custom-status-expiry"
              value={statusExpiry}
              onChange={(e) => setStatusExpiry(e.target.value as StatusExpiryChoice)}
              disabled={customStatus.trim() === ''}
              className="input-search h-8 max-w-full py-0 text-meta"
            >
              {isFutureEnd(user.customStatusExpiresAt, Date.now()) && (
                <option value="keep">
                  {t('settings:account.details.customStatus.expiry.keep', { time: f.formatDateTime(user.customStatusExpiresAt) })}
                </option>
              )}
              {STATUS_EXPIRY_CHOICES.map((choice) => (
                <option key={choice} value={choice}>
                  {t(`settings:account.details.customStatus.expiry.choice.${choice}`)}
                </option>
              ))}
            </select>
          </div>
        </SettingsField>
      </SettingsSection>

      <UsernameSection />

      <StorageSection />

      <DataExportSection />

      {/* ── Danger Zone ── */}
      <SettingsSection title={t('common:labels.dangerZone')} tone="danger">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 basis-60 text-meta leading-snug text-txt-secondary">
            {t('settings:account.danger.description')}
          </p>
          <button type="button" onClick={() => setShowDeleteModal(true)} className="btn-danger">
            {t('settings:account.danger.deleteButton')}
          </button>
        </div>
      </SettingsSection>

      {/* What is unsaved, and what went wrong saving it, stay in view while the page scrolls. */}
      {(error || hasChanges) && (
        <div className="pointer-events-none sticky bottom-0 z-10 space-y-2 pb-1 pt-3">
          {error && (
            <div className="pointer-events-auto bg-surface-chat">
              <FormError>{error}</FormError>
            </div>
          )}
          {hasChanges && (
            <div className="flex justify-center">
              <div className="action-bar pointer-events-auto animate-slide-up">
                <button type="button" onClick={handleReset} className="btn-quiet">
                  {t('common:actions.reset')}
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isLoading || uploadingAvatar || uploadingBanner}
                  aria-busy={isLoading}
                  className="btn-primary"
                >
                  {isLoading ? t('common:states.saving') : t('common:actions.save')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Crop Modals */}
      <ImageCropModal
        isOpen={avatarCropSrc !== null}
        onClose={() => setAvatarCropSrc(null)}
        imageSrc={avatarCropSrc ?? ''}
        onCropComplete={handleAvatarCropComplete}
        onAnimatedCrop={avatarAnimated !== null ? (crop) => handleAnimatedCrop('avatar', avatarAnimated, crop) : undefined}
        title={t('settings:account.profile.avatar.cropTitle')}
        cropShape="round"
        aspectRatio={1}
        maxOutputDimension={256}
      />
      <ImageCropModal
        isOpen={bannerCropSrc !== null}
        onClose={() => setBannerCropSrc(null)}
        imageSrc={bannerCropSrc ?? ''}
        onCropComplete={handleBannerCropComplete}
        onAnimatedCrop={bannerAnimated !== null ? (crop) => handleAnimatedCrop('banner', bannerAnimated, crop) : undefined}
        title={t('settings:account.profile.banner.cropTitle')}
        cropShape="rect"
        aspectRatio={3}
        maxOutputDimension={1280}
      />

      <DeleteAccountModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
      />
    </SettingsPage>
  );
}
