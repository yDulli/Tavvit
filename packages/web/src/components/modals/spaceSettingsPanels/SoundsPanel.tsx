import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SOUNDBOARD_LIMITS, type SpaceSound } from '@backspace/shared/src/soundboard';
import { AudioManager } from '../../../audio/AudioManager';
import { describeError } from '../../../i18n/errors';
import { useFormatters } from '../../../i18n/formatters';
import { getApiForOrigin, useSpaceStore } from '../../../stores/spaceStore';
import { useSoundboardStore, useSpaceSounds } from '../../../stores/soundboardStore';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Icon } from '../../ui/Icon';
import { InlineNameEditor } from '../../ui/InlineNameEditor';

function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(text);
}

/** The space's clips for the soundboard. No clips come with Tavvit: what is here, the space added itself. */
export function SoundsPanel({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation(['spaces', 'common']);
  const { formatBytes, formatNumber } = useFormatters();
  const origin = useSpaceStore((state) => state.spaces.find((space) => space.id === spaceId)?._instanceOrigin ?? '');
  const sounds = useSpaceSounds(origin, spaceId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState<SpaceSound | null>(null);

  const reload = () => useSoundboardStore.getState().load(origin, spaceId);

  useEffect(() => {
    useSoundboardStore.getState().load(origin, spaceId).catch((err: unknown) => setError(describeError(err)));
  }, [origin, spaceId]);

  const upload = async (change: React.ChangeEvent<HTMLInputElement>) => {
    const file = change.target.files?.[0];
    change.target.value = '';
    if (!file) return;
    setError('');
    if (file.size > SOUNDBOARD_LIMITS.MAX_BYTES) {
      setError(t('spaces:settings.sounds.tooLarge', { max: formatBytes(SOUNDBOARD_LIMITS.MAX_BYTES) }));
      return;
    }
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // A copy goes to the decoder, which takes its input away.
      const decoded = await AudioManager.getInstance().decodeClip(bytes.slice().buffer);
      if (!decoded) {
        setError(t('spaces:settings.sounds.notAudio'));
        return;
      }
      if (decoded.duration > SOUNDBOARD_LIMITS.MAX_SECONDS + 0.05) {
        setError(t('spaces:settings.sounds.tooLong', { max: formatNumber(SOUNDBOARD_LIMITS.MAX_SECONDS) }));
        return;
      }
      const name = file.name.replace(/\.[^.]+$/, '').slice(0, SOUNDBOARD_LIMITS.NAME_MAX_LENGTH).trim() || t('spaces:settings.sounds.untitled');
      await getApiForOrigin(origin).sounds.add(spaceId, { name, audio: toBase64(bytes), duration: decoded.duration });
      await reload();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const rename = async (sound: SpaceSound, name: string) => {
    await getApiForOrigin(origin).sounds.rename(sound.id, name);
    await reload();
  };

  const remove = async () => {
    if (!removing) return;
    const { id } = removing;
    setRemoving(null);
    try {
      await getApiForOrigin(origin).sounds.remove(id);
      await reload();
    } catch (err) {
      setError(describeError(err));
    }
  };

  const preview = async (sound: SpaceSound) => {
    try {
      const bytes = await (await getApiForOrigin(origin).sounds.audio(sound.id)).arrayBuffer();
      const clip = await AudioManager.getInstance().decodeClip(bytes);
      if (clip) await AudioManager.getInstance().playClip(clip, 1);
    } catch (err) {
      setError(describeError(err));
    }
  };

  const full = (sounds?.length ?? 0) >= SOUNDBOARD_LIMITS.PER_SPACE_MAX;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">{t('spaces:settings.sounds.title')}</h2>
        <p className="mt-1 text-ui text-txt-secondary">
          {t('spaces:settings.sounds.description', { seconds: formatNumber(SOUNDBOARD_LIMITS.MAX_SECONDS), size: formatBytes(SOUNDBOARD_LIMITS.MAX_BYTES) })}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <input ref={fileRef} type="file" accept="audio/*" className="sr-only" aria-label={t('spaces:settings.sounds.add')} onChange={(change) => void upload(change)} />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy || full} aria-busy={busy} className="btn-primary">
          <Icon name="plus" size={15} />
          {t('spaces:settings.sounds.add')}
        </button>
        <span className="font-mono text-label text-txt-tertiary">
          {t('spaces:settings.sounds.count', { used: formatNumber(sounds?.length ?? 0), max: formatNumber(SOUNDBOARD_LIMITS.PER_SPACE_MAX) })}
        </span>
      </div>

      {error && <p role="alert" className="text-meta text-txt-danger">{error}</p>}

      {sounds?.length === 0 && (
        <div className="empty-state">
          <span className="empty-state-icon" aria-hidden="true"><Icon name="music" size={18} /></span>
          <p className="empty-state-title">{t('spaces:settings.sounds.emptyTitle')}</p>
          <p className="empty-state-body">{t('spaces:settings.sounds.emptyBody')}</p>
        </div>
      )}

      {sounds && sounds.length > 0 && (
        <ul className="flex flex-col gap-1">
          {sounds.map((sound) => (
            <li key={sound.id} className="flex items-center gap-2 rounded-md border border-border-soft px-2 py-1.5">
              <button
                type="button"
                onClick={() => void preview(sound)}
                className="icon-btn flex-shrink-0"
                aria-label={t('spaces:settings.sounds.preview', { name: sound.name })}
              >
                <Icon name="play" size={14} />
              </button>
              <div className="min-w-0 flex-1">
                <InlineNameEditor
                  name={sound.name}
                  icon={null}
                  canEdit
                  editLabel={t('spaces:settings.sounds.rename')}
                  fieldLabel={t('spaces:settings.sounds.nameLabel')}
                  maxLength={SOUNDBOARD_LIMITS.NAME_MAX_LENGTH}
                  normalize={(value) => value.trim()}
                  onSave={(name) => rename(sound, name)}
                />
              </div>
              <span className="tabular flex-shrink-0 font-mono text-label text-txt-tertiary">
                {t('spaces:settings.sounds.seconds', { seconds: formatNumber(Math.round(sound.duration * 10) / 10) })}
              </span>
              <button
                type="button"
                onClick={() => setRemoving(sound)}
                className="icon-btn flex-shrink-0"
                aria-label={t('spaces:settings.sounds.remove', { name: sound.name })}
              >
                <Icon name="trash" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        isOpen={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => void remove()}
        title={t('spaces:settings.sounds.removeTitle')}
        description={t('spaces:settings.sounds.removeBody', { name: removing?.name ?? '' })}
        confirmLabel={t('common:actions.delete')}
        variant="danger"
      />
    </div>
  );
}
