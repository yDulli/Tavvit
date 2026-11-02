import React from 'react';
import { useTranslation } from 'react-i18next';
import { useVoiceStore } from '../../stores/voiceStore';
import type { ScreenShareConfig, ScreenShareAudioState } from '../../stores/voiceStore';
import { buildScreenShareOptions, effectiveScreenShareConfig } from '../../utils/screenShare';
import { DEFAULT_STREAMING_LIMITS } from '../../stores/settingsStore';
import { useStreamHostLimits } from '../../utils/streamHostLimits';
import { hostOf } from '../../utils/identity';
import { Toggle } from '../ui/Toggle';
import { isElectron } from '../../platform/platform';
import { RESOLUTION_LABELS } from '@backspace/shared/src/constants';
import i18n from '../../i18n';
import { formatters } from '../../i18n/formatters';
import { SYSTEM_AUDIO_NOTE_I18N_KEYS, systemAudioNote, useOwnAudioInSystemAudio } from '../../utils/systemAudioNote';

/**
 * The stream quality controls (resolution, frame rate, content mode, codec,
 * bitrate, system audio) bound to voiceStore.screenShareConfig.
 *
 * Shared by the two places a user tunes a stream: ScreenShareSetup before it
 * starts, and ScreenShareSettingsPopover while it is live. Presentation-only:
 * the choices show the effective config (`effectiveScreenShareConfig`, the saved
 * choice fitted to the limits of the instance hosting the call, see
 * `utils/streamHostLimits.ts`), and only a click saves. The limits never write
 * into the saved config, so a strict host does not lower it for later streams.
 */

const MODES: { value: ScreenShareConfig['mode']; labelKey: 'voice:streamSettings.mode.gaming' | 'voice:streamSettings.mode.text' }[] = [
  { value: 'gaming', labelKey: 'voice:streamSettings.mode.gaming' },
  { value: 'text', labelKey: 'voice:streamSettings.mode.text' },
];

const CODEC_OPTIONS = [
  { value: 'vp9' as const, labelKey: 'voice:streamSettings.codecOption.vp9' as const },
  { value: 'h264' as const, labelKey: 'voice:streamSettings.codecOption.h264' as const },
];

/** Whole Mbps when the value is round, otherwise one decimal; the number goes through the locale. */
export function formatBitrate(bps: number): string {
  const mbps = bps % 1_000_000 === 0 ? bps / 1_000_000 : Math.round(bps / 100_000) / 10;
  return i18n.t('common:units.mbps', { value: formatters.formatNumber(mbps) });
}

export function formatDegradation(pref: RTCDegradationPreference): string {
  switch (pref) {
    case 'maintain-resolution': return i18n.t('voice:streamSettings.degradation.maintainResolution');
    case 'maintain-framerate': return i18n.t('voice:streamSettings.degradation.maintainFramerate');
    case 'balanced': return i18n.t('voice:streamSettings.degradation.balanced');
    default: return pref;
  }
}

export function formatKbps(kbps: number): string {
  if (kbps >= 1000) {
    const mbps = kbps % 1000 === 0 ? kbps / 1000 : Math.round(kbps / 100) / 10;
    return i18n.t('common:units.mbps', { value: formatters.formatNumber(mbps) });
  }
  return i18n.t('common:units.kbps', { value: formatters.formatNumber(kbps) });
}

/**
 * "Limits set by <host>" under the Stream Settings title, when the call is
 * hosted by an instance other than home. Nothing at home, and nothing when
 * the host is unknown (a relayed DM token), where the defaults apply.
 */
export function StreamHostSubtitle({ className = '' }: { className?: string }) {
  const { t } = useTranslation(['voice']);
  const { origin } = useStreamHostLimits();
  if (!origin) return null;
  return (
    <div className={`text-label text-txt-tertiary break-all ${className}`}>
      {t('voice:streamSettings.hostLimits', { host: hostOf(origin) })}
    </div>
  );
}

/** "4 Mbps · balanced" — the computed outcome of the current config. */
export function StreamSummary({ className = '' }: { className?: string }) {
  const { t } = useTranslation(['voice', 'common']);
  const config = useVoiceStore((s) => s.screenShareConfig);
  const result = buildScreenShareOptions(config);
  return (
    <span className={`tabular font-mono text-label text-txt-tertiary ${className}`}>
      {t('voice:streamSettings.summary', {
        bitrate: formatBitrate(result.publish.videoEncoding.maxBitrate),
        degradation: formatDegradation(result.overdrive.degradationPreference),
      })}
    </span>
  );
}

/**
 * What the System Audio switch shows and allows.
 *
 * Before a share it is the preference, read when the capture is taken. While
 * a share is live it is what the share sends (`screenShareAudio`): the
 * preference can be on while nothing goes out (a browser capture without
 * audio), and a switch reading "on" there would be claiming audio viewers do
 * not get. Turning it off always works; turning it on is offered only where
 * `syncScreenShareAudio` can act on it.
 */
export function systemAudioSwitch(
  isScreenSharing: boolean,
  liveAudio: ScreenShareAudioState | null,
  preference: boolean,
): { checked: boolean; disabled: boolean; cannotAddLive: boolean; adding: boolean } {
  const idle = { cannotAddLive: false, adding: false };
  if (!isScreenSharing || liveAudio === null) return { checked: preference, disabled: false, ...idle };
  switch (liveAudio) {
    case 'published': return { checked: true, disabled: false, ...idle };
    case 'acquiring': return { checked: true, disabled: true, cannotAddLive: false, adding: true };
    case 'held':
    case 'acquirable': return { checked: false, disabled: false, ...idle };
    case 'unavailable': return { checked: false, disabled: true, cannotAddLive: true, adding: false };
  }
}

/**
 * One group of choices, drawn like Settings' `SegmentedControl`: a sunken strip
 * whose chosen cell is a step lighter with a violet edge. With six groups on one
 * panel a filled cell in each would turn the violet into decoration.
 */
function ChoiceStrip({ columns, children }: { columns: 2 | 3; children: React.ReactNode }) {
  return (
    <div className={`grid gap-0.5 rounded-md border border-border-soft bg-surface-input p-0.5 ${columns === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
      {children}
    </div>
  );
}

function Choice({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`relative min-w-0 truncate rounded px-1.5 py-1 text-center text-ui font-medium select-none transition-colors duration-100 ${
        selected
          ? 'bg-surface-elevated text-txt-primary'
          : 'text-txt-secondary hover:bg-interactive-hover hover:text-txt-primary active:bg-interactive-active'
      }`}
    >
      {children}
      {selected && <span aria-hidden="true" className="absolute inset-x-2 bottom-0 h-[2px] rounded-t-[1px] bg-accent-primary" />}
    </button>
  );
}

export function StreamQualityControls() {
  const { t } = useTranslation(['voice', 'common']);
  const config = useVoiceStore((s) => s.screenShareConfig);
  const setConfig = useVoiceStore((s) => s.setScreenShareConfig);
  const { origin: hostOrigin, limits } = useStreamHostLimits();
  const electronPlatform = isElectron() ? window.backspace?.platform : null;
  const isScreenSharing = useVoiceStore((s) => s.isScreenSharing);
  const liveAudio = useVoiceStore((s) => s.screenShareAudio);
  const audioSwitch = systemAudioSwitch(isScreenSharing, liveAudio, config.shareAudio);
  const ownAudio = useOwnAudioInSystemAudio();
  const audioNote = systemAudioNote(electronPlatform ?? null, ownAudio, audioSwitch.checked);

  // Unknown limits (not yet fetched, or a host that cannot be asked) show the
  // same defaults the stream itself falls back to.
  const hostLimits = limits ?? DEFAULT_STREAMING_LIMITS;
  const effective = effectiveScreenShareConfig(config, hostLimits);

  const RESOLUTIONS = hostLimits.allowedResolutions.map((r) => ({
    value: r as ScreenShareConfig['height'],
    label: RESOLUTION_LABELS[r as keyof typeof RESOLUTION_LABELS] ?? `${r}p`,
  }));
  const FRAME_RATES = hostLimits.allowedFramerates.map((f) => ({
    value: f as ScreenShareConfig['fps'],
    label: `${f}`,
  }));

  const result = buildScreenShareOptions(config);
  // What Auto resolves to right now, in kbps; also the slider's starting point when switching to Custom
  const autoKbps = Math.round(result.publish.videoEncoding.maxBitrate / 1000);

  return (
    <div className="flex flex-col gap-3">
      {/* Resolution */}
      <div>
        <div className="label-mono mb-1.5">
          {t('voice:streamSettings.resolution')}
        </div>
        <ChoiceStrip columns={3}>
          {RESOLUTIONS.map((r) => (
            <Choice
              key={String(r.value)}
              selected={effective.height === r.value}
              onClick={() => setConfig({ height: r.value })}
            >
              {r.label}
            </Choice>
          ))}
        </ChoiceStrip>
      </div>

      {/* Frame Rate */}
      <div>
        <div className="label-mono mb-1.5">
          {t('voice:streamSettings.frameRate')}
        </div>
        <ChoiceStrip columns={3}>
          {FRAME_RATES.map((f) => (
            <Choice
              key={f.value}
              selected={effective.fps === f.value}
              onClick={() => setConfig({ fps: f.value })}
            >
              {f.label}
            </Choice>
          ))}
        </ChoiceStrip>
      </div>

      {/* Content Mode */}
      <div>
        <div className="label-mono mb-1.5">
          {t('voice:streamSettings.contentMode')}
        </div>
        <ChoiceStrip columns={2}>
          {MODES.map((m) => (
            <Choice key={m.value} selected={config.mode === m.value} onClick={() => setConfig({ mode: m.value })}>
              {t(m.labelKey)}
            </Choice>
          ))}
        </ChoiceStrip>
      </div>

      {/* Codec */}
      <div>
        <div className="label-mono mb-1.5">
          {t('voice:streamSettings.codec')}
        </div>
        <ChoiceStrip columns={2}>
          {CODEC_OPTIONS.map((c) => (
            <Choice key={c.value} selected={config.codec === c.value} onClick={() => setConfig({ codec: c.value })}>
              {t(c.labelKey)}
            </Choice>
          ))}
        </ChoiceStrip>
      </div>

      {/* Bitrate — Auto | Custom like every other row; the slider only exists in Custom */}
      <div>
        <div className="label-mono mb-1.5">
          {t('voice:streamSettings.bitrate')}
        </div>
        {hostLimits.allowCustomBitrate ? (
          <>
            <ChoiceStrip columns={2}>
              <Choice
                selected={effective.customBitrateKbps == null}
                onClick={() => setConfig({ customBitrateKbps: null })}
              >
                {t('voice:streamSettings.auto')}
              </Choice>
              <Choice
                selected={effective.customBitrateKbps != null}
                onClick={() => {
                  // Start the slider where Auto currently sits so switching changes nothing yet
                  if (effective.customBitrateKbps == null) setConfig({ customBitrateKbps: autoKbps });
                }}
              >
                {t('voice:streamSettings.custom')}
              </Choice>
            </ChoiceStrip>
            {effective.customBitrateKbps != null && (
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="range"
                  min={hostLimits.minBitrateKbps}
                  max={hostLimits.maxBitrateKbps}
                  step={hostLimits.bitrateStepKbps}
                  value={effective.customBitrateKbps}
                  onChange={(e) => setConfig({ customBitrateKbps: Number(e.target.value) })}
                  aria-label={t('voice:streamSettings.bitrate')}
                  className="flex-1 min-w-0 h-1 cursor-pointer accent-accent-primary"
                />
                <span className="tabular font-mono text-label text-txt-primary min-w-[64px] flex-shrink-0 text-right">
                  {formatKbps(effective.customBitrateKbps)}
                </span>
              </div>
            )}
          </>
        ) : (
          <div>
            <div className="tabular font-mono text-meta text-txt-secondary">
              {formatKbps(autoKbps)}
            </div>
            <div className="text-label leading-snug text-txt-tertiary mt-0.5">
              {hostOrigin
                ? t('voice:streamSettings.customBitrateDisabledByHost', { host: hostOf(hostOrigin) })
                : t('voice:streamSettings.customBitrateDisabled')}
            </div>
          </div>
        )}
      </div>

      {/* System Audio */}
      <div>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 pt-[3px]">
            <div className="label-mono">
              {t('voice:streamSettings.systemAudio')}
            </div>
            {audioSwitch.cannotAddLive && (
              <div className="text-label leading-snug text-txt-tertiary mt-1">
                {t('voice:streamSettings.systemAudioLiveUnavailable')}
              </div>
            )}
            {audioSwitch.adding && (
              <div className="text-label leading-snug text-txt-tertiary mt-1" role="status">
                {t('voice:streamSettings.systemAudioAdding')}
              </div>
            )}
            {audioNote && !audioSwitch.adding && (
              <div
                className={`text-label leading-snug mt-1 ${audioNote.tone === 'warning' ? 'text-accent-amber' : 'text-txt-tertiary'}`}
              >
                {t(SYSTEM_AUDIO_NOTE_I18N_KEYS[audioNote.key])}
              </div>
            )}
          </div>
          <Toggle
            enabled={audioSwitch.checked}
            disabled={audioSwitch.disabled}
            onChange={(enabled) => setConfig({ shareAudio: enabled })}
            ariaLabel={t('voice:streamSettings.systemAudio')}
          />
        </div>
      </div>
    </div>
  );
}
