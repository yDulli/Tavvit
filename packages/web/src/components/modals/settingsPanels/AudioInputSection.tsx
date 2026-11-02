import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useVoiceStore } from '../../../stores/voiceStore';
import { AudioManager } from '../../../audio/AudioManager';
import { useAudioDevices } from '../../../hooks/useAudioDevices';
import { Icon } from '../../ui/Icon';
import { DevicePicker, DropdownItem } from './_shared/SettingsPickerPrimitives';
import { SettingsSection, SliderRow } from './_shared/SettingsControls';

export function AudioInputSection() {
  const { t } = useTranslation(['settings', 'common']);
  const inputDeviceId = useVoiceStore((s) => s.inputDeviceId);
  const setInputDevice = useVoiceStore((s) => s.setInputDevice);
  const inputVolume = useVoiceStore((s) => s.inputVolume);
  const setInputVolume = useVoiceStore((s) => s.setInputVolume);
  const { permState, inputs, inputLabels, requestPermission } = useAudioDevices();

  const [listOpen, setListOpen] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [activeUpstreamId, setActiveUpstreamId] = useState<string | null>(null);
  // Bumped whenever AudioManager's AudioContext transitions to 'running'.
  // Used as a dep on effects that need to re-run once the context exists —
  // the user may open Settings before joining voice (no AudioContext yet),
  // then join voice and expect the meter / resolved-default hint to come
  // alive without reopening the panel.
  const [audioCtxGen, setAudioCtxGen] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);

  // Click-outside-to-close. iOS Safari does not synthesize `mousedown` from
  // touch reliably, so we listen for `touchstart` alongside `mousedown` to
  // make the popover dismissable with a single tap on touch devices.
  useEffect(() => {
    if (!listOpen) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setListOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [listOpen]);

  // Listen for AudioContext resume events so dependent effects re-trigger
  // when the context first becomes available (e.g. user joins voice after
  // opening Settings). onResumed fires on every 'running' state transition;
  // we only need an opaque generation bump to re-run downstream effects.
  useEffect(() => {
    if (permState !== 'granted') return;
    const am = AudioManager.getInstance();
    const unsubscribe = am.onResumed(() => setAudioCtxGen((g) => g + 1));
    return () => { unsubscribe(); };
  }, [permState]);

  // Live mic-level meter. Reuses AudioManager's analyser node, which is part
  // of the canonical pipeline — no extra getUserMedia required once the user
  // is in voice. Re-runs on `audioCtxGen` bumps so the meter activates after
  // the AudioContext appears mid-session.
  useEffect(() => {
    if (permState !== 'granted') return;
    let stopped = false;
    const am = AudioManager.getInstance();
    const ctx = am.getContext();
    if (!ctx) return; // nothing to measure until the user joins voice or hits Test
    const analyser = am.getAnalyserNode();
    analyser.fftSize = 256;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (stopped) return;
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      setMicLevel(Math.min(avg / 128, 1));
      animFrameRef.current = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      stopped = true;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [permState, audioCtxGen]);

  // Track the resolved upstream deviceId for the "Currently using: X" hint.
  // Re-runs on `audioCtxGen` because the resolved-default ID is only known
  // after AudioManager has actually opened a stream.
  useEffect(() => {
    if (permState !== 'granted') return;
    const am = AudioManager.getInstance();
    const id = am.getCurrentInputDeviceId();
    setActiveUpstreamId(id === 'default' ? null : id);
  }, [permState, inputDeviceId, audioCtxGen]);

  if (permState === 'unknown') {
    return (
      <SettingsSection title={t('voice.input.title')}>
        <p className="text-ui text-txt-tertiary">{t('voice.input.checkingAccess')}</p>
      </SettingsSection>
    );
  }

  if (permState === 'denied') {
    return (
      <SettingsSection title={t('voice.input.title')}>
        <div className="flex items-start gap-2.5">
          <Icon name="alert" size={16} className="mt-px flex-shrink-0 text-txt-warning" />
          <div className="min-w-0">
            <p className="text-ui font-medium text-txt-primary">{t('voice.input.accessDenied.title')}</p>
            <p className="mt-0.5 text-meta leading-snug text-txt-tertiary">{t('voice.input.accessDenied.description')}</p>
            <button type="button" onClick={() => { requestPermission().catch(() => {}); }} className="btn-outline btn-sm mt-2.5">
              {t('voice.input.accessDenied.retry')}
            </button>
          </div>
        </div>
      </SettingsSection>
    );
  }

  if (permState === 'prompt') {
    return (
      <SettingsSection title={t('voice.input.title')}>
        <div>
          <p className="text-meta leading-snug text-txt-tertiary">{t('voice.input.permissionPrompt.description')}</p>
          <button type="button" onClick={() => { requestPermission().catch(() => {}); }} className="btn-primary mt-2.5">
            {t('voice.input.permissionPrompt.enable')}
          </button>
        </div>
      </SettingsSection>
    );
  }

  // permState === 'granted'
  const systemDefaultLabel = t('voice.input.device.systemDefault');
  const selectedLabel = inputDeviceId === 'default'
    ? systemDefaultLabel
    : inputLabels.get(inputDeviceId) ?? systemDefaultLabel;
  const resolvedHint = inputDeviceId === 'default' && activeUpstreamId
    ? inputLabels.get(activeUpstreamId)
    : null;

  const handleSelect = (id: string) => {
    setInputDevice(id);
    AudioManager.getInstance().setInputDevice(id).catch(() => {});
    setListOpen(false);
  };

  const micBars = 20;
  const activeBars = Math.round(micLevel * micBars * (inputVolume / 100));

  return (
    <SettingsSection title={t('voice.input.title')}>
      <div>
        <DevicePicker selectedLabel={selectedLabel} open={listOpen} onToggle={() => setListOpen((v) => !v)} pickerRef={dropdownRef}>
          <DropdownItem label={systemDefaultLabel} active={inputDeviceId === 'default'} onClick={() => handleSelect('default')} />
          {inputs.filter(d => d.deviceId !== 'default').map((d) => (
            <DropdownItem
              key={d.deviceId}
              label={inputLabels.get(d.deviceId) ?? d.deviceId}
              active={inputDeviceId === d.deviceId}
              onClick={() => handleSelect(d.deviceId)}
            />
          ))}
        </DevicePicker>
        {resolvedHint && (
          <p className="mt-1.5 text-meta text-txt-tertiary">{t('voice.input.device.currentlyUsing', { label: resolvedHint })}</p>
        )}
        {inputs.length === 0 && (
          <p className="mt-1.5 text-meta text-txt-tertiary">{t('voice.input.device.none')}</p>
        )}
      </div>

      <div>
        <SliderRow
          id="input-volume"
          label={t('voice.input.volume.label')}
          value={inputVolume}
          min={0}
          max={200}
          valueLabel={t('common:units.percent', { value: inputVolume })}
          onChange={setInputVolume}
        />
        <div className="mt-2 flex items-center gap-[3px]" aria-hidden="true">
          {Array.from({ length: micBars }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-[1px] transition-colors duration-75 ${
                i < activeBars ? 'bg-status-online' : 'bg-interactive-muted'
              }`}
            />
          ))}
        </div>
        <p className="mt-1.5 text-meta text-txt-tertiary">{t('voice.input.meter.hint')}</p>
      </div>
    </SettingsSection>
  );
}
