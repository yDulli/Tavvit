import { useEffect, useRef, useState } from 'react';
import { cssUrl } from '../../utils/cssUrl';
import { useTranslation } from 'react-i18next';
import { PROFILE_LIMITS, type UpdateSpaceProfileRequest } from '@backspace/shared';
import { useUIStore } from '../../stores/uiStore';
import { getApiForOrigin, useSpaceStore } from '../../stores/spaceStore';
import { getMyUserIdForOrigin } from '../../stores/authStore';
import { useTransferStore } from '../../stores/transferStore';
import { applySpaceMemberUpdate } from '../../stores/spaceMemberUpdates';
import { waitForTransferAttachment } from '../../utils/waitForTransfer';
import { resolveAssetUrl } from '../../utils/assetUrls';
import { describeError } from '../../i18n/errors';
import { Modal } from '../ui/Modal';
import { Avatar } from '../ui/Avatar';
import { ImageCropModal } from '../ui/ImageCropModal';

/**
 * One picture of the space profile while it is edited: unchanged (undefined),
 * back to the account's (null), or a new upload with its local preview.
 */
type ImageDraft = undefined | null | { filename: string; preview: string };

/** An image field's address for the page: a file on the space's instance, or an upload's preview. */
function shownImage(draft: ImageDraft, stored: string | null | undefined, origin: string): string | null {
  if (draft === null) return null;
  if (draft) return draft.preview;
  return stored ? resolveAssetUrl(stored, origin) ?? null : null;
}

function imageUrl(src: string, origin: string): string {
  if (src.startsWith('http') || src.startsWith('blob:') || src.startsWith('/')) return src;
  return getApiForOrigin(origin).uploads.url(src);
}

/**
 * The person's own profile for one space (spaces.md, "Space profiles"): a
 * picture, a banner and an about text shown only there, each falling back to
 * the account's when left empty. Opened with `{ spaceId }` for the space whose
 * member list is loaded. Pictures are uploaded to the space's instance, which
 * accepts only the person's own fresh uploads; every check is the server's.
 */
export function SpaceProfileModal() {
  const { t } = useTranslation(['spaces', 'common']);
  const activeModal = useUIStore((s) => s.activeModal);
  const modalData = useUIStore((s) => s.modalData);
  const closeModal = useUIStore((s) => s.closeModal);
  const addToast = useUIStore((s) => s.addToast);
  const isOpen = activeModal === 'spaceProfile';
  const spaceId = isOpen && typeof modalData.spaceId === 'string' ? modalData.spaceId : null;
  const space = useSpaceStore((s) => (spaceId ? s.spaces.find((sp) => sp.id === spaceId) : undefined));
  const origin = space?._instanceOrigin ?? '';
  const me = useSpaceStore((s) => {
    if (!spaceId || s.currentSpaceId !== spaceId) return undefined;
    const myId = getMyUserIdForOrigin(origin);
    return myId ? s.members.find((m) => m.userId === myId) : undefined;
  });

  const [avatar, setAvatar] = useState<ImageDraft>(undefined);
  const [banner, setBanner] = useState<ImageDraft>(undefined);
  const [bio, setBio] = useState<string | null>(null);
  const [cropping, setCropping] = useState<{ kind: 'avatar' | 'banner'; src: string } | null>(null);
  const [uploading, setUploading] = useState<'avatar' | 'banner' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const avatarInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  const previews = useRef<string[]>([]);

  // A new opening starts from what is stored; the local previews go with it.
  useEffect(() => {
    setAvatar(undefined);
    setBanner(undefined);
    setBio(null);
    setCropping(null);
    setError('');
    return () => {
      for (const url of previews.current) URL.revokeObjectURL(url);
      previews.current = [];
    };
  }, [isOpen, spaceId]);

  if (!isOpen) return null;

  const close = () => {
    // While a picture is cut, Escape and the backdrop belong to the crop.
    if (saving || uploading || cropping) return;
    closeModal();
  };

  const storedBio = me?.bio ?? '';
  const draftBio = bio ?? storedBio;
  const bioChanged = bio !== null && bio.trim() !== storedBio;
  const changed = avatar !== undefined || banner !== undefined || bioChanged;

  const pick = (kind: 'avatar' | 'banner', file: File | undefined) => {
    if (!file) return;
    setError('');
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setCropping({ kind, src: reader.result });
    };
    reader.onerror = () => setError(t('spaces:spaceProfile.uploadFailed'));
    reader.readAsDataURL(file);
  };

  const upload = async (kind: 'avatar' | 'banner', blob: Blob) => {
    setCropping(null);
    setUploading(kind);
    setError('');
    const preview = URL.createObjectURL(blob);
    previews.current.push(preview);
    try {
      const file = new File([blob], `${kind}.webp`, { type: blob.type || 'image/webp' });
      const transfer = await useTransferStore.getState().startUpload(file, { tray: false, origin });
      const { filename } = await waitForTransferAttachment(transfer);
      (kind === 'avatar' ? setAvatar : setBanner)({ filename, preview });
    } catch {
      setError(t('spaces:spaceProfile.uploadFailed'));
    } finally {
      setUploading(null);
    }
  };

  const save = async () => {
    if (!spaceId || !changed) return;
    const body: UpdateSpaceProfileRequest = {};
    if (avatar !== undefined) body.avatar = avatar ? avatar.filename : null;
    if (banner !== undefined) body.banner = banner ? banner.filename : null;
    if (bioChanged) body.bio = draftBio.trim() || null;
    setSaving(true);
    setError('');
    try {
      const member = await getApiForOrigin(origin).spaces.updateMyProfile(spaceId, body);
      applySpaceMemberUpdate(origin, member);
      addToast(t('spaces:spaceProfile.saved'), 'success', 2000);
      closeModal();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  const accountName = me ? (me.user.displayName ?? me.user.username) : '';
  const avatarShown = shownImage(avatar, me?.avatar, origin);
  const bannerShown = shownImage(banner, me?.banner, origin);
  // What each field shows when the space profile leaves it empty.
  const accountBanner = me?.user.banner ? imageUrl(me.user.banner, origin) : null;
  const hasOwnAvatar = avatar !== null && (avatar !== undefined || !!me?.avatar);
  const hasOwnBanner = banner !== null && (banner !== undefined || !!me?.banner);
  const shownBannerSrc = bannerShown ? imageUrl(bannerShown, origin) : accountBanner;

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={space ? t('spaces:spaceProfile.title', { space: space.name }) : t('spaces:spaceProfile.titlePlain')}
      maxWidth="max-w-md"
      mobileStyle="sheet"
    >
      <div className="space-y-4 px-5 py-4">
        <p className="text-ui text-txt-secondary">{t('spaces:spaceProfile.intro')}</p>

        {!me ? (
          <div className="empty-state">
            <div className="empty-state-body">{t('spaces:spaceProfile.notLoaded')}</div>
          </div>
        ) : (
          <>
            {/* Banner */}
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-xs text-txt-secondary">{t('spaces:spaceProfile.banner')}</span>
                {!hasOwnBanner && <span className="label-mono">{t('spaces:spaceProfile.fromAccount')}</span>}
              </div>
              <button
                type="button"
                onClick={() => bannerInput.current?.click()}
                disabled={uploading !== null || saving}
                aria-label={t('spaces:spaceProfile.uploadBanner')}
                className="relative block h-[72px] w-full overflow-hidden rounded-md border border-border-soft bg-surface-input"
                style={shownBannerSrc ? { backgroundImage: cssUrl(shownBannerSrc), backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
              >
                {uploading === 'banner' && <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs text-white">{t('spaces:spaceProfile.uploading')}</span>}
              </button>
              <div className="mt-1.5 flex gap-2">
                <button type="button" className="btn-quiet btn-sm" onClick={() => bannerInput.current?.click()} disabled={uploading !== null || saving}>
                  {t('spaces:spaceProfile.uploadBanner')}
                </button>
                {hasOwnBanner && (
                  <button type="button" className="btn-quiet btn-sm" onClick={() => setBanner(null)} disabled={uploading !== null || saving}>
                    {t('spaces:spaceProfile.useAccountBanner')}
                  </button>
                )}
              </div>
              <input
                ref={bannerInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(event) => { pick('banner', event.target.files?.[0]); event.target.value = ''; }}
              />
            </div>

            {/* Picture */}
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-xs text-txt-secondary">{t('spaces:spaceProfile.avatar')}</span>
                {!hasOwnAvatar && <span className="label-mono">{t('spaces:spaceProfile.fromAccount')}</span>}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => avatarInput.current?.click()}
                  disabled={uploading !== null || saving}
                  aria-label={t('spaces:spaceProfile.uploadAvatar')}
                  className="relative flex-shrink-0 rounded-full"
                >
                  <Avatar src={avatarShown ?? me.user.avatar} name={accountName} size={64} user={me.user} />
                  {uploading === 'avatar' && <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-2xs text-white">{t('spaces:spaceProfile.uploading')}</span>}
                </button>
                <div className="flex flex-col items-start gap-1">
                  <button type="button" className="btn-quiet btn-sm" onClick={() => avatarInput.current?.click()} disabled={uploading !== null || saving}>
                    {t('spaces:spaceProfile.uploadAvatar')}
                  </button>
                  {hasOwnAvatar && (
                    <button type="button" className="btn-quiet btn-sm" onClick={() => setAvatar(null)} disabled={uploading !== null || saving}>
                      {t('spaces:spaceProfile.useAccountAvatar')}
                    </button>
                  )}
                </div>
              </div>
              <input
                ref={avatarInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(event) => { pick('avatar', event.target.files?.[0]); event.target.value = ''; }}
              />
            </div>

            {/* About */}
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <label htmlFor="space-profile-bio" className="text-xs text-txt-secondary">{t('spaces:spaceProfile.bio')}</label>
                {!draftBio.trim() && <span className="label-mono">{t('spaces:spaceProfile.fromAccount')}</span>}
              </div>
              <div className="relative">
                <textarea
                  id="space-profile-bio"
                  value={draftBio}
                  onChange={(event) => setBio(event.target.value.slice(0, PROFILE_LIMITS.MAX_BIO_LENGTH))}
                  rows={3}
                  maxLength={PROFILE_LIMITS.MAX_BIO_LENGTH}
                  placeholder={me.user.bio ?? t('spaces:spaceProfile.bioPlaceholder')}
                  className="input-standard w-full resize-none"
                  disabled={saving}
                />
                <span className="absolute bottom-2 right-2 font-mono text-2xs text-txt-tertiary">
                  {t('spaces:spaceProfile.bioCounter', { used: draftBio.length, max: PROFILE_LIMITS.MAX_BIO_LENGTH })}
                </span>
              </div>
              {draftBio.trim() && (
                <button type="button" className="btn-quiet btn-sm mt-1" onClick={() => setBio('')} disabled={saving}>
                  {t('spaces:spaceProfile.useAccountBio')}
                </button>
              )}
            </div>
          </>
        )}

        {error && (
          <div role="alert" className="rounded border border-accent-rose/30 bg-accent-rose/10 p-2 text-sm text-txt-danger">{error}</div>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-border-soft px-5 py-3">
        <button type="button" className="btn-quiet" onClick={close} disabled={saving}>
          {t('common:actions.cancel')}
        </button>
        <button type="button" className="btn-primary" onClick={() => { void save(); }} disabled={!me || !changed || saving || uploading !== null}>
          {saving ? t('common:states.saving') : t('common:actions.save')}
        </button>
      </div>

      <ImageCropModal
        isOpen={cropping !== null}
        onClose={() => setCropping(null)}
        imageSrc={cropping?.src ?? ''}
        onCropComplete={(blob) => { if (cropping) void upload(cropping.kind, blob); }}
        title={cropping?.kind === 'banner' ? t('spaces:spaceProfile.cropBanner') : t('spaces:spaceProfile.cropAvatar')}
        cropShape={cropping?.kind === 'banner' ? 'rect' : 'round'}
        aspectRatio={cropping?.kind === 'banner' ? 3 : 1}
        maxOutputDimension={cropping?.kind === 'banner' ? 1280 : 256}
      />
    </Modal>
  );
}
