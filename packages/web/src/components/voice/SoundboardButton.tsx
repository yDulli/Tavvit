import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useFloatingPosition } from '../../hooks/useFloatingPosition';
import { describeError } from '../../i18n/errors';
import { getChannelOrigin, useSpaceStore } from '../../stores/spaceStore';
import { useSoundboardStore, useSpaceSounds } from '../../stores/soundboardStore';
import { useUIStore } from '../../stores/uiStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { hasPermissionBit, PermissionBits } from '../../utils/permissions';
import { Icon } from '../ui/Icon';
import { Toggle } from '../ui/Toggle';

/**
 * The soundboard of the call you are in: its clips, and how you hear those of others. A clip plays
 * on each listener's own device, so anyone can turn it down or off for themselves alone.
 */
export function SoundboardButton({ channelId, className }: { channelId: string; className: string }) {
  const { t } = useTranslation(['voice']);
  const fieldId = useId();
  const origin = getChannelOrigin(channelId);
  const spaceId = useSpaceStore((state) => state.channelToSpaceMap.get(channelId));
  const canPlay = useSpaceStore((state) => hasPermissionBit(state.channelPermissions.get(channelId), PermissionBits.USE_SOUNDBOARD));
  const sounds = useSpaceSounds(origin, spaceId);
  const enabled = useVoiceStore((state) => state.soundboardEnabled);
  const volume = useVoiceStore((state) => state.soundboardVolume);
  const setEnabled = useVoiceStore((state) => state.setSoundboardEnabled);
  const setVolume = useVoiceStore((state) => state.setSoundboardVolume);
  const addToast = useUIStore((state) => state.addToast);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const { style } = useFloatingPosition(anchorRef, popoverRef, { placement: 'top', offset: 10, enabled: open });

  useEffect(() => {
    if (!open || !spaceId) return undefined;
    let cancelled = false;
    useSoundboardStore.getState().load(origin, spaceId).catch((err: unknown) => {
      if (!cancelled) addToast(describeError(err), 'warning');
    });
    return () => {
      cancelled = true;
    };
  }, [open, origin, spaceId, addToast]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const play = async (soundId: string) => {
    try {
      await useSoundboardStore.getState().play(channelId, soundId);
    } catch (err) {
      addToast(describeError(err), 'warning');
    }
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t('voice:soundboard.title')}
        title={t('voice:soundboard.title')}
        className={className}
      >
        <Icon name="music" size={20} />
      </button>
      {open && createPortal(
        <div
          ref={popoverRef}
          style={style}
          role="dialog"
          aria-label={t('voice:soundboard.title')}
          className="glass z-50 flex w-[320px] max-w-[calc(100*var(--app-vw)-16px)] flex-col rounded-lg"
        >
          <h2 className="label-mono border-b border-border-hard px-3 py-2">{t('voice:soundboard.title')}</h2>
          <div className="max-h-[min(280px,calc(50*var(--app-vh)))] overflow-y-auto p-2 scrollbar-thin">
            {sounds?.length === 0 && <p className="px-1 py-3 text-center text-meta text-txt-tertiary">{t('voice:soundboard.empty')}</p>}
            {sounds && sounds.length > 0 && (
              <ul className="grid grid-cols-2 gap-1.5">
                {sounds.map((sound) => (
                  <li key={sound.id}>
                    <button
                      type="button"
                      disabled={!canPlay}
                      onClick={() => void play(sound.id)}
                      title={canPlay ? sound.name : t('voice:soundboard.noRight')}
                      className="btn-outline btn-sm w-full justify-start truncate"
                    >
                      <span className="truncate">{sound.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-col gap-2 border-t border-border-hard px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-ui text-txt-secondary">{t('voice:soundboard.hear')}</span>
              <Toggle enabled={enabled} onChange={setEnabled} ariaLabel={t('voice:soundboard.hear')} />
            </div>
            <label htmlFor={`${fieldId}-volume`} className="flex items-center gap-3 text-ui text-txt-secondary">
              <span className="flex-shrink-0">{t('voice:soundboard.volume')}</span>
              <input
                id={`${fieldId}-volume`}
                type="range"
                min={0}
                max={100}
                value={volume}
                disabled={!enabled}
                onChange={(change) => setVolume(Number(change.target.value))}
                className="min-w-0 flex-1 accent-accent-primary"
              />
            </label>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
