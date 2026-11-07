import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_VOICE_OVERLAY_OPTIONS,
  VOICE_OVERLAY_LAYOUTS,
  VOICE_OVERLAY_SHOWS,
  voiceOverlayPath,
  voiceOverlayQuery,
  type VoiceOverlayOptions,
  type VoiceOverlayPerson,
} from '@backspace/shared/src/voiceOverlay';
import { describeError } from '../../i18n/errors';
import { useAuthStore } from '../../stores/authStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { getApiForOrigin } from '../../utils/crossStoreResolvers';
import { VoiceOverlayView } from '../../overlay/VoiceOverlayView';
import { FormError, SegmentedControl, SettingsField, ToggleRow } from '../modals/settingsPanels/_shared/SettingsControls';
import { Modal } from '../ui/Modal';

type LinkState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'exists' }
  | { status: 'made'; secret: string };

/**
 * Voice channel → Overlay for OBS (docs/systems/voice-overlay.md): a link for a browser source
 * that shows who is in the channel and who speaks. The link's secret is shown once, when it is
 * made; a new one ends the old. The preview draws the overlay with the asker and two stand-ins.
 */
export function VoiceOverlayModal() {
  const { t } = useTranslation(['voice', 'common']);
  const activeModal = useUIStore((s) => s.activeModal);
  const modalData = useUIStore((s) => s.modalData);
  const closeModal = useUIStore((s) => s.closeModal);
  const addToast = useUIStore((s) => s.addToast);
  const isOpen = activeModal === 'voiceOverlay';
  const channelId = isOpen && typeof modalData?.channelId === 'string' ? modalData.channelId : null;
  const entry = useSpaceStore((s) => (channelId ? s.spaceChannelIndex.get(channelId) : undefined));
  const me = useAuthStore((s) => s.user);
  const layoutLabel = useId();
  const showLabel = useId();
  const linkId = useId();
  const [options, setOptions] = useState<VoiceOverlayOptions>(DEFAULT_VOICE_OVERLAY_OPTIONS);
  const [link, setLink] = useState<LinkState>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const origin = entry?.origin ?? '';

  useEffect(() => {
    if (!channelId) return undefined;
    let live = true;
    setLink({ status: 'loading' });
    setError('');
    getApiForOrigin(origin).voiceOverlay.get(channelId)
      .then((answer) => { if (live) setLink({ status: answer.exists ? 'exists' : 'none' }); })
      .catch((err: unknown) => {
        if (!live) return;
        setLink({ status: 'none' });
        setError(describeError(err));
      });
    return () => {
      live = false;
    };
  }, [channelId, origin]);

  // The asker and two stand-ins, one of them speaking and one muted, so every part of the look shows.
  const preview = useMemo<VoiceOverlayPerson[]>(() => [
    {
      id: 'you', name: me?.displayName?.trim() || me?.username || 'You', avatar: me?.avatar ?? null,
      avatarColor: me?.avatarColor ?? null, tileKey: me?.homeUserId ?? me?.id ?? 'you', frame: null, muted: false, deafened: false,
    },
    { id: 'robin', name: 'Robin', avatar: null, avatarColor: 'sky', tileKey: 'robin', frame: null, muted: false, deafened: false },
    { id: 'kim', name: 'Kim', avatar: null, avatarColor: 'coral', tileKey: 'kim', frame: null, muted: true, deafened: false },
  ], [me]);
  const previewSpeaking = useMemo(() => new Set(['you']), []);

  if (!isOpen || !channelId || !entry) return null;

  const address = link.status === 'made'
    ? `${origin || window.location.origin}${voiceOverlayPath(link.secret)}${voiceOverlayQuery(options)}`
    : '';

  const make = async () => {
    setBusy(true);
    setError('');
    try {
      const made = await getApiForOrigin(origin).voiceOverlay.create(channelId);
      setLink({ status: 'made', secret: made.secret });
    } catch (err) {
      setError(err instanceof Error ? describeError(err) : t('voice:overlay.failed'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      await getApiForOrigin(origin).voiceOverlay.remove(channelId);
      setLink({ status: 'none' });
      addToast(t('voice:overlay.removed'), 'success', 2000);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      addToast(t('voice:overlay.copied'), 'success', 2000);
    } catch {
      // The field is selected instead, so it can be copied by hand.
      (document.getElementById(linkId) as HTMLInputElement | null)?.select();
    }
  };

  return (
    <Modal isOpen onClose={closeModal} title={t('voice:overlay.title')} maxWidth="max-w-xl">
      <div className="space-y-5">
        <p className="text-ui leading-relaxed text-txt-secondary">{t('voice:overlay.intro', { channel: entry.name })}</p>

        <div className="grid gap-4 desktop:grid-cols-[minmax(0,1fr)_200px]">
          <div className="space-y-4">
            <SettingsField label={t('voice:overlay.layout')} labelId={layoutLabel}>
              <SegmentedControl
                labelledBy={layoutLabel}
                value={options.layout}
                onChange={(layout) => setOptions((current) => ({ ...current, layout }))}
                options={VOICE_OVERLAY_LAYOUTS.map((id) => ({ id, label: t(`voice:overlay.layouts.${id}`) }))}
              />
            </SettingsField>
            <SettingsField label={t('voice:overlay.show')} labelId={showLabel}>
              <SegmentedControl
                labelledBy={showLabel}
                value={options.show}
                onChange={(show) => setOptions((current) => ({ ...current, show }))}
                options={VOICE_OVERLAY_SHOWS.map((id) => ({ id, label: t(`voice:overlay.shows.${id}`) }))}
              />
            </SettingsField>
            <ToggleRow
              label={t('voice:overlay.names')}
              enabled={options.names}
              onChange={(names) => setOptions((current) => ({ ...current, names }))}
            />
          </div>
          <div className="space-y-1.5">
            <div className="label-mono">{t('voice:overlay.preview')}</div>
            {/* A checked ground stands for "transparent": OBS shows the stream there. */}
            <div className="overflow-hidden rounded-md border border-border-hard bg-[repeating-conic-gradient(#2a2b31_0_25%,#1f2025_0_50%)] bg-[length:16px_16px] p-1">
              <VoiceOverlayView people={preview} speaking={previewSpeaking} options={options} />
            </div>
          </div>
        </div>

        <p className="rounded-md border border-border-soft bg-surface-input px-3 py-2 text-meta leading-relaxed text-txt-secondary">
          {t('voice:overlay.notice')}
        </p>

        {link.status === 'made' && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input id={linkId} readOnly value={address} onFocus={(event) => event.target.select()} className="input-standard min-w-0 flex-1 font-mono text-meta" />
              <button type="button" className="btn-primary" onClick={() => void copy()}>{t('voice:overlay.copy')}</button>
            </div>
            <p className="text-meta text-txt-tertiary">{t('voice:overlay.steps')}</p>
          </div>
        )}
        {link.status === 'exists' && <p className="text-meta leading-relaxed text-txt-secondary">{t('voice:overlay.existing')}</p>}
        {error && <FormError>{error}</FormError>}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {(link.status === 'exists' || link.status === 'made') && (
            <button type="button" className="btn-quiet" disabled={busy} onClick={() => void remove()}>{t('voice:overlay.remove')}</button>
          )}
          {link.status === 'none' && (
            <button type="button" className="btn-primary" disabled={busy} aria-busy={busy} onClick={() => void make()}>{t('voice:overlay.create')}</button>
          )}
          {(link.status === 'exists' || link.status === 'made') && (
            <button type="button" className="btn-outline" disabled={busy} aria-busy={busy} title={t('voice:overlay.renewHint')} onClick={() => void make()}>
              {t('voice:overlay.renew')}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
