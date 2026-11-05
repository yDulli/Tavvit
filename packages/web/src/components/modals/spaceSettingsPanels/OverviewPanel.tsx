import React, { useState, useRef, useEffect, useId, useMemo } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { ImageCropModal } from '../../ui/ImageCropModal';
import { getSpaceGradient, SPACE_GRADIENT_MAP } from '../../../utils/gradients';
import { AVATAR_COLORS, isSpaceDefaultNotificationLevel } from '@backspace/shared';
import type { AvatarColor, SpaceDefaultNotificationLevel } from '@backspace/shared';
import { useSpaceStore } from '../../../stores/spaceStore';
import { useSelfIdentity } from '../../../stores/authStore';
import { useSpaceOrigin } from '../../../hooks/useSpaceOrigin';
import { useUIStore } from '../../../stores/uiStore';
import { useNavigate } from 'react-router-dom';
import { api, type SpaceUpdateBody } from '../../../api/client';
import { useTransferStore } from '../../../stores/transferStore';
import { waitForTransferAttachment } from '../../../utils/waitForTransfer';
import { hasPermissionBit, PermissionBits } from '../../../utils/permissions';
import { describeError } from '../../../i18n/errors';
import { useAvatarColorNames } from './spaceOptions';
import { SegmentedControl } from '../settingsPanels/_shared/SettingsControls';
import { Toggle } from '../../ui/Toggle';
import { Avatar } from '../../ui/Avatar';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Icon } from '../../ui/Icon';
import { ownerHasOwnGroup } from '../../../utils/memberGroups';

/** The default-notifications choice: one of the space levels, or Tavvit's own default (stored as null). */
type DefaultLevelChoice = SpaceDefaultNotificationLevel | 'builtIn';

/** The stored default of a space, as this panel reads it; anything unknown counts as none. */
function storedDefaultLevel(level: unknown): SpaceDefaultNotificationLevel | null {
  return isSpaceDefaultNotificationLevel(level) ? level : null;
}

interface OverviewPanelProps {
  spaceId: string;
}

/**
 * Whether the member list shows the owner in a group of their own, saved at
 * once. Off, the owner is listed under their own top shown role and marked by
 * a crown (spaces.md, "Ownership and roles").
 */
function OwnerListingSection({ spaceId, ownerGroup }: { spaceId: string; ownerGroup: boolean }) {
  const { t } = useTranslation(['spaces', 'common']);
  const updateSpace = useSpaceStore((s) => s.updateSpace);
  const addToast = useUIStore((s) => s.addToast);
  const [saving, setSaving] = useState(false);
  const toggle = async (next: boolean) => {
    setSaving(true);
    try {
      await updateSpace(spaceId, { ownerGroup: next });
    } catch (err) {
      addToast(describeError(err), 'warning');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div>
      <div className="label-mono mb-1.5">{t('spaces:ownerDisplay.title')}</div>
      <div className="surface-card rounded-lg p-4">
        <label className="flex items-center justify-between gap-4">
          <span className="min-w-0">
            <span className="block text-ui font-medium text-txt-primary">{t('spaces:ownerDisplay.ownGroup')}</span>
            <span className="mt-0.5 block text-meta leading-snug text-txt-tertiary">{t('spaces:ownerDisplay.ownGroupHint')}</span>
          </span>
          <Toggle enabled={ownerGroup} disabled={saving} onChange={(next) => { void toggle(next); }} ariaLabel={t('spaces:ownerDisplay.ownGroup')} />
        </label>
      </div>
    </div>
  );
}

/** Opens the Discord template import for this space, for whoever may add its roles and channels. */
function DiscordImportEntry({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation(['spaces']);
  const openModal = useUIStore((s) => s.openModal);
  const permissions = useSpaceStore((s) => s.spacePermissions.get(spaceId));
  const canImport = hasPermissionBit(permissions, PermissionBits.MANAGE_ROLES) && hasPermissionBit(permissions, PermissionBits.MANAGE_CHANNELS);
  if (!canImport) return null;
  return (
    <div>
      <div className="label-mono mb-1.5">{t('spaces:import.entry.title')}</div>
      <div className="flex flex-wrap items-center justify-between gap-3 surface-card rounded-lg p-4">
        <p className="min-w-0 flex-1 basis-60 text-meta leading-snug text-txt-tertiary">{t('spaces:import.entry.hint')}</p>
        <button type="button" className="btn-outline btn-sm" onClick={() => openModal('discordImport', { spaceId })}>
          <Icon name="download" size={14} />
          {t('spaces:import.entry.action')}
        </button>
      </div>
    </div>
  );
}

export function OverviewPanel({ spaceId }: OverviewPanelProps) {
  const { t } = useTranslation(['spaces', 'common']);
  const colorNames = useAvatarColorNames();
  const spaces = useSpaceStore((s) => s.spaces);
  const updateSpace = useSpaceStore((s) => s.updateSpace);
  const deleteSpace = useSpaceStore((s) => s.deleteSpace);
  const closeModal = useUIStore((s) => s.closeModal);
  const spacePermissions = useSpaceStore((s) => s.spacePermissions);
  const navigate = useNavigate();

  const space = spaces.find((s) => s.id === spaceId);
  // The user's row id on the space's instance, which issued its owner id and
  // member rows.
  const self = useSelfIdentity();
  const spaceOrigin = useSpaceOrigin(spaceId);
  const myIdHere = self?.rowIds.get(spaceOrigin);
  const isOwner = !!space && myIdHere !== undefined && space.ownerId === myIdHere;
  const myPerms = spacePermissions.get(spaceId);
  const canManageSpace = hasPermissionBit(myPerms, PermissionBits.MANAGE_SPACE);

  const [spaceName, setSpaceName] = useState(space?.name ?? '');
  // null = no change, '' = remove, 'filename.png' = new uploaded
  const [iconFilename, setIconFilename] = useState<string | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);

  // Banner state (same pattern as icon)
  const [bannerFilename, setBannerFilename] = useState<string | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [bannerCropSrc, setBannerCropSrc] = useState<string | null>(null);
  const bannerFileInputRef = useRef<HTMLInputElement>(null);

  const [avatarColorState, setAvatarColorState] = useState<AvatarColor | null>(space?.avatarColor ?? null);
  // The level members start with until they choose their own; null keeps Tavvit's default.
  const [defaultLevel, setDefaultLevel] = useState<SpaceDefaultNotificationLevel | null>(
    storedDefaultLevel(space?.defaultNotificationLevel),
  );
  const defaultLevelLabelId = useId();

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Transfer ownership state
  const members = useSpaceStore((s) => s.members);
  const transferOwnership = useSpaceStore((s) => s.transferOwnership);
  const addToast = useUIStore((s) => s.addToast);
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferSearch, setTransferSearch] = useState('');
  const [transferTargetId, setTransferTargetId] = useState<string | null>(null);
  const [transferring, setTransferring] = useState(false);

  // A saved default (here or by another moderator) replaces the draft, like the other fields.
  const savedDefaultLevel = storedDefaultLevel(space?.defaultNotificationLevel);
  useEffect(() => {
    setDefaultLevel(savedDefaultLevel);
  }, [savedDefaultLevel]);

  useEffect(() => {
    if (space) {
      setSpaceName(space.name);
      setAvatarColorState(space.avatarColor ?? null);
      setIconFilename(null);
      if (iconPreview) {
        URL.revokeObjectURL(iconPreview);
        setIconPreview(null);
      }
      setBannerFilename(null);
      if (bannerPreview) {
        URL.revokeObjectURL(bannerPreview);
        setBannerPreview(null);
      }
    }
  }, [space?.name, space?.icon, space?.banner, space?.avatarColor]);

  // Kept above the `!space` guard. The guard is reachable while this panel
  // stays mounted: the WebSocket handler calls spaceStore.removeSpace on
  // `member_banned`, and removeInstanceSpaces drops every space of an
  // instance when its connection goes away. Neither closes the settings
  // modal, so this component re-renders with `space` undefined, and a hook
  // below the guard would stop being called on that render.
  // Not reachable this way: handleDelete below, which awaits deleteSpace and
  // then calls closeModal in the same continuation. React 18 batches those
  // two store writes into one render, and the panel is unmounted by it.
  const transferCandidates = useMemo(() => {
    const candidates = members.filter(m => m.userId !== myIdHere);
    if (!transferSearch.trim()) return candidates;
    const q = transferSearch.toLowerCase();
    return candidates.filter(m =>
      m.user.displayName?.toLowerCase().includes(q) ||
      m.user.username.toLowerCase().includes(q)
    );
  }, [members, myIdHere, transferSearch]);

  if (!space) return null;

  const hasNameChange = spaceName.trim() !== space.name;
  const hasIconChange = iconFilename !== null;
  const hasBannerChange = bannerFilename !== null;
  const hasAvatarColorChange = avatarColorState !== (space.avatarColor ?? null);
  const hasDefaultLevelChange = defaultLevel !== savedDefaultLevel;
  const hasChanges = hasNameChange || hasIconChange || hasBannerChange || hasAvatarColorChange || hasDefaultLevelChange;

  const currentIconUrl = space.icon
    ? (space.icon.startsWith('http') ? space.icon : api.uploads.url(space.icon))
    : null;

  const currentBannerUrl = space.banner
    ? (space.banner.startsWith('http') ? space.banner : api.uploads.url(space.banner))
    : null;

  // ─── Icon handlers ────────────────────────────────────────────────────────

  const handleIconSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCropSrc(reader.result as string);
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCropComplete = async (blob: Blob) => {
    if (iconPreview) URL.revokeObjectURL(iconPreview);
    const previewUrl = URL.createObjectURL(blob);
    setIconPreview(previewUrl);
    setCropSrc(null);

    const file = new File([blob], 'icon.webp', { type: blob.type || 'image/webp' });
    setUploadingIcon(true);
    try {
      const tid = await useTransferStore.getState().startUpload(file, {
        tray: false,
        origin: space._instanceOrigin || undefined,
      });
      const { filename } = await waitForTransferAttachment(tid);
      setIconFilename(filename);
    } catch {
      setSaveError(t('spaces:settings.overview.iconUploadFailed'));
      setIconPreview(null);
      URL.revokeObjectURL(previewUrl);
    } finally {
      setUploadingIcon(false);
    }
  };

  const handleRemoveIcon = () => {
    if (iconPreview) URL.revokeObjectURL(iconPreview);
    setIconPreview(null);
    setIconFilename('');
  };

  // ─── Banner handlers ──────────────────────────────────────────────────────

  const handleBannerSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setBannerCropSrc(reader.result as string);
    reader.readAsDataURL(file);
    if (bannerFileInputRef.current) bannerFileInputRef.current.value = '';
  };

  const handleBannerCropComplete = async (blob: Blob) => {
    if (bannerPreview) URL.revokeObjectURL(bannerPreview);
    const previewUrl = URL.createObjectURL(blob);
    setBannerPreview(previewUrl);
    setBannerCropSrc(null);

    const file = new File([blob], 'banner.webp', { type: blob.type || 'image/webp' });
    setUploadingBanner(true);
    try {
      const tid = await useTransferStore.getState().startUpload(file, {
        tray: false,
        origin: space._instanceOrigin || undefined,
      });
      const { filename } = await waitForTransferAttachment(tid);
      setBannerFilename(filename);
    } catch {
      setSaveError(t('spaces:settings.overview.bannerUploadFailed'));
      setBannerPreview(null);
      URL.revokeObjectURL(previewUrl);
    } finally {
      setUploadingBanner(false);
    }
  };

  const handleRemoveBanner = () => {
    if (bannerPreview) URL.revokeObjectURL(bannerPreview);
    setBannerPreview(null);
    setBannerFilename('');
  };

  // ─── Save / Discard / Delete ──────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      const updates: SpaceUpdateBody = {};
      if (hasNameChange) updates.name = spaceName.trim();
      if (hasIconChange) {
        updates.icon = iconFilename === '' ? '' : iconFilename!;
      }
      if (hasBannerChange) {
        updates.banner = bannerFilename === '' ? '' : bannerFilename!;
      }
      if (hasAvatarColorChange) {
        updates.avatarColor = avatarColorState ?? '';
      }
      if (hasDefaultLevelChange) {
        updates.defaultNotificationLevel = defaultLevel;
      }
      await updateSpace(spaceId, updates);
      setIconFilename(null);
      if (iconPreview) {
        URL.revokeObjectURL(iconPreview);
        setIconPreview(null);
      }
      setBannerFilename(null);
      if (bannerPreview) {
        URL.revokeObjectURL(bannerPreview);
        setBannerPreview(null);
      }
      addToast(t('common:states.settingsSaved'), 'success', 2000);
    } catch (err) {
      setSaveError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setSpaceName(space.name);
    setAvatarColorState(space.avatarColor ?? null);
    setDefaultLevel(savedDefaultLevel);
    setIconFilename(null);
    if (iconPreview) {
      URL.revokeObjectURL(iconPreview);
      setIconPreview(null);
    }
    setBannerFilename(null);
    if (bannerPreview) {
      URL.revokeObjectURL(bannerPreview);
      setBannerPreview(null);
    }
    setSaveError('');
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteSpace(spaceId);
      closeModal();
      navigate('/channels/@me');
    } catch (err) {
      setSaveError(describeError(err));
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  // Transfer ownership logic
  const transferTarget = transferTargetId ? members.find(m => m.userId === transferTargetId) : null;

  const handleTransfer = async () => {
    if (!transferTargetId) return;
    setTransferring(true);
    try {
      await transferOwnership(spaceId, transferTargetId);
      addToast(
        t('spaces:settings.overview.transfer.success', { name: transferTarget?.user.displayName || transferTarget?.user.username }),
        'success',
        3000,
      );
      setShowTransfer(false);
      setTransferTargetId(null);
      setTransferSearch('');
    } catch (err) {
      addToast(describeError(err), 'warning', 3000);
    } finally {
      setTransferring(false);
    }
  };

  const displayIconSrc = iconPreview ?? (iconFilename === '' ? null : currentIconUrl);
  const displayBannerSrc = bannerPreview ?? (bannerFilename === '' ? null : currentBannerUrl);

  return (
    <>
      <div className="space-y-5">
        <h2 className="page-title">{t('spaces:settings.nav.tabs.overview')}</h2>
        {/* Space Identity */}
        <div>
          <div className="label-mono mb-1.5">{t('spaces:settings.overview.identity')}</div>
          <div className="surface-card rounded-lg p-4 space-y-4">
        {/* Space Icon */}
        <div>
          <label className="field-label">
            {t('spaces:settings.overview.iconLabel')}
          </label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => canManageSpace && fileInputRef.current?.click()}
              disabled={!canManageSpace || uploadingIcon}
              className={`relative w-16 h-16 rounded-xl bg-surface-input border border-border-soft flex items-center justify-center overflow-hidden group ${
                canManageSpace ? 'hover:border-interactive-muted cursor-pointer' : 'cursor-default'
              } transition-colors duration-100`}
            >
              {displayIconSrc ? (
                <>
                  <img src={displayIconSrc} alt={t('spaces:settings.overview.iconAlt')} className="w-full h-full object-cover" />
                  {canManageSpace && (
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                  )}
                </>
              ) : (
                <div
                  className="w-full h-full flex items-center justify-center text-white text-xl font-semibold"
                  style={{ background: getSpaceGradient(space.id, space.name, avatarColorState).gradient }}
                >
                  {space.name.charAt(0).toUpperCase()}
                </div>
              )}
              {uploadingIcon && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <svg className="w-5 h-5 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </div>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleIconSelect}
              className="hidden"
            />
            {canManageSpace && (displayIconSrc || space.icon) && iconFilename !== '' && (
              <button
                type="button"
                onClick={handleRemoveIcon}
                className="btn-quiet btn-sm hover:bg-accent-rose/10 hover:text-txt-danger"
              >
                {t('common:actions.remove')}
              </button>
            )}
          </div>
        </div>

        {/* Space Avatar Color */}
        <div>
          <label className="field-label">
            {t('spaces:settings.overview.colorLabel')}
          </label>
          <div className="flex gap-2">
            {AVATAR_COLORS.map((key) => {
              const entry = SPACE_GRADIENT_MAP[key];
              return (
                <button
                  data-tooltip=""
                  key={key}
                  type="button"
                  onClick={() => canManageSpace && setAvatarColorState(key)}
                  disabled={!canManageSpace}
                  aria-label={colorNames[key]}
                  aria-pressed={avatarColorState === key}
                  className="w-7 h-7 rounded-md border-2 transition-colors duration-100 disabled:cursor-default"
                  style={{
                    background: entry.gradient,
                    borderColor: avatarColorState === key ? 'white' : 'transparent',
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* Space Banner */}
        <div>
          <label className="field-label">
            {t('spaces:settings.overview.bannerLabel')}
          </label>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => canManageSpace && bannerFileInputRef.current?.click()}
              disabled={!canManageSpace || uploadingBanner}
              className={`relative aspect-video w-full max-w-[var(--sidebar-width)] rounded-lg bg-surface-input border border-dashed border-border-soft flex items-center justify-center overflow-hidden group ${
                canManageSpace ? 'hover:border-interactive-muted cursor-pointer' : 'cursor-default'
              } transition-colors duration-100`}
            >
              {displayBannerSrc ? (
                <>
                  <img src={displayBannerSrc} alt={t('spaces:settings.overview.bannerAlt')} className="w-full h-full object-cover" />
                  {canManageSpace && (
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center gap-1 text-txt-tertiary">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                  </svg>
                  <span className="text-meta">{t('spaces:settings.overview.uploadBanner')}</span>
                </div>
              )}
              {uploadingBanner && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <svg className="w-5 h-5 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </div>
              )}
            </button>
            {/* As members see it: the shape and width of the top of the channel list. */}
            <p className="text-meta text-txt-tertiary">{t('spaces:settings.overview.bannerHint')}</p>
            <input
              ref={bannerFileInputRef}
              type="file"
              accept="image/*"
              onChange={handleBannerSelect}
              className="hidden"
            />
            {canManageSpace && (displayBannerSrc || space.banner) && bannerFilename !== '' && (
              <button
                type="button"
                onClick={handleRemoveBanner}
                className="btn-quiet btn-sm self-start hover:bg-accent-rose/10 hover:text-txt-danger"
              >
                {t('spaces:settings.overview.removeBanner')}
              </button>
            )}
          </div>
        </div>

        {/* Space Name */}
        <div>
          <label className="field-label">
            {t('spaces:settings.overview.nameLabel')}
          </label>
          <input
            type="text"
            value={spaceName}
            onChange={(e) => setSpaceName(e.target.value)}
            className="input-standard w-full"
            disabled={!canManageSpace}
          />
        </div>
          </div>
        </div>

        {/* Default notifications: the level members start with until they choose their own */}
        {canManageSpace && (
          <div>
            <div className="label-mono mb-1.5">{t('spaces:settings.overview.notifications.title')}</div>
            <div className="surface-card rounded-lg p-4">
              <div id={defaultLevelLabelId} className="text-ui font-medium text-txt-primary">
                {t('spaces:settings.overview.notifications.label')}
              </div>
              <p className="mt-0.5 text-meta leading-snug text-txt-tertiary">{t('spaces:settings.overview.notifications.description')}</p>
              <div className="mt-2.5">
                <SegmentedControl<DefaultLevelChoice>
                  labelledBy={defaultLevelLabelId}
                  value={defaultLevel ?? 'builtIn'}
                  options={[
                    { id: 'all', label: t('spaces:notifications.level.all') },
                    { id: 'mentions', label: t('spaces:notifications.level.mentions') },
                    { id: 'builtIn', label: t('spaces:settings.overview.notifications.builtIn') },
                  ]}
                  onChange={(choice) => setDefaultLevel(choice === 'builtIn' ? null : choice)}
                />
              </div>
            </div>
          </div>
        )}

        {/* Save / Discard */}
        {saveError && (
          <div className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{saveError}</div>
        )}
        {/* Ownership: how the owner is listed, decided by the owner alone. */}
        {isOwner && space && (
          <OwnerListingSection spaceId={spaceId} ownerGroup={ownerHasOwnGroup(space)} />
        )}

        {/* Structure from Discord: the import adds, it never changes or removes. */}
        {space && <DiscordImportEntry spaceId={spaceId} />}

        {/* Danger Zone */}
        {isOwner && (
          <div>
            <div className="label-mono mb-1.5 text-txt-danger">{t('common:labels.dangerZone')}</div>
            <div className="surface-card rounded-lg p-4 space-y-4">
              {/* Transfer Ownership */}
              <div>
                {showTransfer ? (
                  <>
                    <p className="mb-3 text-meta leading-snug text-txt-tertiary">{t('spaces:settings.overview.transfer.description')}</p>
                    {transferTargetId && transferTarget ? (
                    /* Confirm step */
                    <div className="space-y-3">
                      <div className="rounded-md border border-accent-amber/30 bg-accent-amber/10 px-3 py-2">
                        <p className="text-ui text-txt-secondary">
                          <Trans
                            t={t}
                            i18nKey="spaces:settings.overview.transfer.prompt"
                            values={{ name: transferTarget.user.displayName || transferTarget.user.username }}
                            components={{ strong: <span className="font-semibold text-txt-primary" /> }}
                          />
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setTransferTargetId(null)}
                          className="btn-quiet"
                          disabled={transferring}
                        >
                          {t('common:actions.back')}
                        </button>
                        <button
                          type="button"
                          onClick={handleTransfer}
                          disabled={transferring}
                          aria-busy={transferring}
                          className="btn-primary bg-accent-amber text-surface-base hover:bg-accent-amber/90 active:bg-accent-amber/80"
                        >
                          {transferring ? t('spaces:settings.overview.transfer.transferring') : t('spaces:settings.overview.transfer.confirm')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Member picker */
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={transferSearch}
                        onChange={(e) => setTransferSearch(e.target.value)}
                        placeholder={t('common:labels.searchMembers')}
                        className="input-search w-full"
                        autoFocus
                      />
                      <div className="max-h-[176px] overflow-y-auto scrollbar-thin space-y-0.5">
                        {transferCandidates.length === 0 ? (
                          <p className="py-3 text-center text-meta text-txt-tertiary">{t('common:labels.noMembersFound')}</p>
                        ) : (
                          transferCandidates.map((member) => (
                            <button
                              type="button"
                              key={member.userId}
                              onClick={() => setTransferTargetId(member.userId)}
                              className="list-row w-full px-2 py-1.5 text-left"
                            >
                              <Avatar
                                src={member.user.avatar}
                                name={member.user.displayName || member.user.username}
                                size={28}
                                user={member.user}
                              />
                              <span className="flex min-w-0 flex-col items-start">
                                <span className="max-w-full truncate text-ui font-medium text-txt-primary">
                                  {member.user.displayName || member.user.username}
                                </span>
                                {member.user.displayName && (
                                  <span className="max-w-full truncate text-label text-txt-tertiary">
                                    {member.user.username}
                                  </span>
                                )}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => { setShowTransfer(false); setTransferSearch(''); }}
                        className="btn-quiet btn-sm"
                      >
                        {t('common:actions.cancel')}
                      </button>
                    </div>
                    )}
                  </>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="min-w-0 flex-1 basis-60 text-meta leading-snug text-txt-tertiary">{t('spaces:settings.overview.transfer.description')}</p>
                    <button
                      type="button"
                      onClick={() => setShowTransfer(true)}
                      className="btn-outline btn-sm"
                    >
                      {t('spaces:settings.overview.transfer.button')}
                    </button>
                  </div>
                )}
              </div>

              {/* Divider */}
              <div className="border-t border-border-hard" />

              {/* Delete Space */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="min-w-0 flex-1 basis-60 text-meta leading-snug text-txt-tertiary">{t('spaces:settings.overview.delete.description')}</p>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="btn-danger btn-sm"
                >
                  {t('spaces:settings.overview.delete.button')}
                </button>
              </div>
            </div>
          </div>
        )}

        {canManageSpace && hasChanges && (
          <div className="sticky bottom-0 z-10 pointer-events-none">
            <div className="flex justify-center pt-3 pb-1">
              <div className="action-bar animate-slide-up pointer-events-auto">
                <button
                  onClick={handleDiscard}
                  className="btn-quiet"
                >
                  {t('spaces:settings.discardChanges')}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || uploadingIcon || uploadingBanner || !spaceName.trim()}
                  aria-busy={saving}
                  className="btn-primary"
                >
                  {saving ? t('common:states.saving') : t('common:actions.save')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        title={t('spaces:settings.overview.delete.button')}
        description={t('spaces:settings.overview.delete.description')}
        confirmLabel={t('spaces:settings.overview.delete.button')}
        variant="danger"
        loading={deleting}
      />

      <ImageCropModal
        isOpen={cropSrc !== null}
        onClose={() => setCropSrc(null)}
        imageSrc={cropSrc ?? ''}
        onCropComplete={handleCropComplete}
        title={t('spaces:settings.overview.cropIconTitle')}
        cropShape="round"
        aspectRatio={1}
        maxOutputDimension={256}
      />

      <ImageCropModal
        isOpen={bannerCropSrc !== null}
        onClose={() => setBannerCropSrc(null)}
        imageSrc={bannerCropSrc ?? ''}
        onCropComplete={handleBannerCropComplete}
        title={t('spaces:settings.overview.cropBannerTitle')}
        cropShape="rect"
        aspectRatio={16 / 9}
        maxOutputDimension={1280}
      />
    </>
  );
}
