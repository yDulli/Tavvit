import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { useSpaceStore, getChannelOrigin, getMyUserIdForOrigin } from '../../stores/spaceStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { useShownStatus } from '../../hooks/useShownStatus';
import { useAudioDevices } from '../../hooks/useAudioDevices';
import { AudioManager } from '../../audio/AudioManager';
import { broadcastVoiceStatus, broadcastDeafenViaLiveKit } from '../../utils/voice';
import { DropdownItem } from '../modals/settingsPanels/_shared/SettingsPickerPrimitives';
import type { UserSettingsTab } from '../modals/UserSettings';
import { ProfileAvatar } from '../ui/ProfileAvatar';
import { Icon } from '../ui/Icon';

type DevicePanel = 'input' | 'output';

/**
 * The right end of the top bar: the microphone and the headphones (each with
 * the menu of its devices), the settings, and who you are. Muting and deafening
 * are reached from anywhere in the app, in or out of a call, which is why they
 * live here and not in the voice panel.
 *
 * A mute a moderator imposed (space mute, space deafen, or the voice
 * permission withheld) shows in amber and cannot be lifted from here.
 */
export function UserControls() {
  const { t } = useTranslation(['spaces', 'common', 'admin']);
  const user = useAuthStore((s) => s.user);
  const openModal = useUIStore((s) => s.openModal);
  const openUserProfile = useUIStore((s) => s.openUserProfile);
  const isMuted = useVoiceStore((s) => s.isMuted);
  const isDeafened = useVoiceStore((s) => s.isDeafened);
  const toggleMic = useVoiceStore((s) => s.toggleMic);
  const toggleDeafen = useVoiceStore((s) => s.toggleDeafen);
  const currentVoiceChannelId = useVoiceStore((s) => s.currentVoiceChannelId);
  const spaceId = useSpaceStore((s) => currentVoiceChannelId ? s.channelToSpaceMap.get(currentVoiceChannelId) : null);
  const myOriginId = useSpaceStore((s) => currentVoiceChannelId ? getMyUserIdForOrigin(getChannelOrigin(currentVoiceChannelId)) : s.members.find(m => m.userId === user?.id)?.userId ?? user?.id);
  const spaceMutedUserIds = useVoiceStore((s) => s.spaceMutedUserIds);
  const spaceDeafenedUserIds = useVoiceStore((s) => s.spaceDeafenedUserIds);
  const permissionMutedUserIds = useVoiceStore((s) => s.permissionMutedUserIds);

  const isSpaceMuted = !!(myOriginId && spaceId && spaceMutedUserIds.has(`${spaceId}:${myOriginId}`));
  const isSpaceDeafened = !!(myOriginId && spaceId && spaceDeafenedUserIds.has(`${spaceId}:${myOriginId}`));
  const isPermissionMuted = !!(myOriginId && spaceId && permissionMutedUserIds.has(`${spaceId}:${myOriginId}`));
  const imposed = isSpaceMuted || isSpaceDeafened || isPermissionMuted;

  const [openPanel, setOpenPanel] = useState<DevicePanel | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // A click anywhere else closes the device menu.
  useEffect(() => {
    if (!openPanel) return;
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpenPanel(null);
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenPanel(null); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [openPanel]);

  if (!user) return null;

  const handleMicToggle = () => {
    if (imposed) return;
    const wasDeafened = useVoiceStore.getState().isDeafened;
    toggleMic();
    broadcastVoiceStatus();
    // Unmuting while deafened also undeafens; that half goes out over LiveKit.
    if (wasDeafened && !useVoiceStore.getState().isDeafened) broadcastDeafenViaLiveKit();
  };

  const handleDeafenToggle = () => {
    if (isSpaceDeafened) return;
    toggleDeafen();
    broadcastVoiceStatus();
    broadcastDeafenViaLiveKit();
  };

  const togglePanel = (panel: DevicePanel) => {
    setOpenPanel((current) => (current === panel ? null : panel));
    // Resume the AudioContext so the mic-level meter starts measuring on open.
    if (panel === 'input') void AudioManager.getInstance().resumeContext();
  };

  const openSettings = (tab?: UserSettingsTab) => {
    setOpenPanel(null);
    openModal('userSettings', tab ? { tab } : {});
  };

  const micOff = isMuted || isDeafened || imposed;
  const micTitle = isPermissionMuted
    ? t('spaces:sidebar.userArea.permissionMuted')
    : (isSpaceMuted || isSpaceDeafened)
      ? t('spaces:sidebar.userArea.spaceMuted')
      : isMuted ? t('spaces:sidebar.userArea.unmute') : t('spaces:sidebar.userArea.mute');
  const headTitle = isSpaceDeafened
    ? t('spaces:sidebar.userArea.spaceDeafened')
    : isDeafened ? t('spaces:sidebar.userArea.undeafen') : t('spaces:sidebar.userArea.deafen');

  return (
    <div ref={panelRef} className="relative flex h-full flex-shrink-0 items-center gap-1 pr-2">
      <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border-hard" />

      <SwitchGroup
        icon={micOff ? 'mic-off' : 'mic'}
        title={micTitle}
        tone={imposed ? 'imposed' : (isMuted || isDeafened) ? 'off' : 'on'}
        onToggle={handleMicToggle}
        menuTitle={t('spaces:sidebar.userArea.inputDevices')}
        menuOpen={openPanel === 'input'}
        onMenu={() => togglePanel('input')}
      />
      <SwitchGroup
        icon={isDeafened || isSpaceDeafened ? 'headphones-off' : 'headphones'}
        title={headTitle}
        tone={isSpaceDeafened ? 'imposed' : isDeafened ? 'off' : 'on'}
        onToggle={handleDeafenToggle}
        menuTitle={t('spaces:sidebar.userArea.outputDevices')}
        menuOpen={openPanel === 'output'}
        onMenu={() => togglePanel('output')}
      />

      <button
        type="button"
        onClick={() => openSettings()}
        className="icon-btn icon-btn-lg"
        aria-label={t('common:labels.settings')}
      >
        <Icon name="settings" size={18} />
      </button>

      <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border-hard" />

      <Identity
        onOpen={(rect) => openUserProfile(user, '', rect, 'bottom')}
      />

      {openPanel !== null && (
        <div className="absolute right-2 top-full z-[150] mt-1.5 w-[320px] overflow-hidden rounded-lg glass animate-slide-up">
          <DeviceMenu kind={openPanel} onSettings={() => openSettings('voice')} />
        </div>
      )}
    </div>
  );
}

/**
 * A switch (mute, deafen) joined to the menu of its devices: one 32px control
 * with two hit areas. Off by the person's own choice it is tinted rose; held
 * off by a moderator its icon is amber and the switch does nothing.
 */
function SwitchGroup({ icon, title, tone, onToggle, menuTitle, menuOpen, onMenu }: {
  icon: 'mic' | 'mic-off' | 'headphones' | 'headphones-off';
  title: string;
  /** `off` is the person's own choice, `imposed` a moderator's. */
  tone: 'on' | 'off' | 'imposed';
  onToggle: () => void;
  menuTitle: string;
  menuOpen: boolean;
  onMenu: () => void;
}) {
  const toneClass = tone === 'imposed'
    ? 'text-accent-amber cursor-not-allowed'
    : tone === 'off' ? 'text-txt-danger' : 'text-txt-tertiary hover:text-txt-primary';
  return (
    <div className={`flex h-8 items-stretch rounded-md transition-colors ${
      tone === 'off' ? 'bg-accent-rose/[0.12]' : menuOpen ? 'bg-interactive-selected' : 'hover:bg-interactive-hover'
    }`}>
      <button
        data-tooltip=""
        type="button"
        onClick={onToggle}
        aria-label={title}
        className={`flex w-8 items-center justify-center rounded-l-md transition-colors active:bg-interactive-active ${toneClass}`}
      >
        <Icon name={icon} size={18} />
      </button>
      <button
        data-tooltip=""
        type="button"
        onClick={onMenu}
        aria-expanded={menuOpen}
        aria-label={menuTitle}
        className={`flex w-5 items-center justify-center rounded-r-md transition-colors active:bg-interactive-active ${menuOpen ? 'text-txt-primary' : 'text-txt-tertiary hover:text-txt-primary'}`}
      >
        <Icon name="chevron-down" size={12} strokeWidth={2.2} className={`transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
      </button>
    </div>
  );
}

/** Who is signed in: the picture with its status, the name and the handle (the picture alone in a compact window). Opens your own profile card. */
function Identity({ onOpen }: { onOpen: (rect: DOMRect) => void }) {
  const user = useAuthStore((s) => s.user);
  const shownStatus = useShownStatus(user, '', user?.status ?? 'offline');
  if (!user) return null;
  const name = user.displayName ?? user.username;
  return (
    <button
      data-tooltip=""
      type="button"
      onClick={(e) => onOpen(e.currentTarget.getBoundingClientRect())}
      aria-label={name}
      className="group flex h-8 min-w-0 max-w-[200px] items-center gap-2 rounded-md pl-1 pr-2 text-left transition-colors hover:bg-interactive-hover active:bg-interactive-active compact:px-0.5"
    >
      <ProfileAvatar src={user.avatar} name={name} size={28} status={shownStatus} user={user} origin="" />
      <span className="min-w-0 compact:hidden">
        <span className="block truncate text-ui font-medium leading-tight text-txt-primary">{name}</span>
        <span className="block truncate font-mono text-label leading-tight text-txt-tertiary group-hover:text-txt-secondary">@{user.username}</span>
      </span>
    </button>
  );
}

/** The devices of the microphone or of the headphones, their volume, and the way to the voice settings. */
function DeviceMenu({ kind, onSettings }: { kind: DevicePanel; onSettings: () => void }) {
  const { t } = useTranslation(['spaces']);
  const inputDeviceId = useVoiceStore((s) => s.inputDeviceId);
  const outputDeviceId = useVoiceStore((s) => s.outputDeviceId);
  const setInputDevice = useVoiceStore((s) => s.setInputDevice);
  const setOutputDevice = useVoiceStore((s) => s.setOutputDevice);
  const inputVolume = useVoiceStore((s) => s.inputVolume);
  const setInputVolume = useVoiceStore((s) => s.setInputVolume);
  const outputVolume = useVoiceStore((s) => s.outputVolume);
  const setOutputVolume = useVoiceStore((s) => s.setOutputVolume);
  const { permState, inputs, outputs, inputLabels, outputLabels, requestPermission } = useAudioDevices();
  const [listOpen, setListOpen] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const frameRef = useRef<number>(0);

  // The microphone's level, measured while its menu is open.
  useEffect(() => {
    if (kind !== 'input') return;
    let cancelled = false;
    const start = async () => {
      try {
        await AudioManager.getInstance().resumeContext();
        if (cancelled) return;
        const analyser = AudioManager.getInstance().getAnalyserNode();
        analyser.fftSize = 256;
        analyserRef.current = analyser;
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(data);
          const avg = data.reduce((a, b) => a + b, 0) / data.length;
          setMicLevel(Math.min(avg / 128, 1));
          frameRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch { /* no microphone access: the meter stays still */ }
    };
    void start();
    return () => {
      cancelled = true;
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      analyserRef.current = null;
      setMicLevel(0);
    };
  }, [kind]);

  const isInput = kind === 'input';
  const systemDefault = t('spaces:sidebar.userArea.systemDefault');
  const deviceId = isInput ? inputDeviceId : outputDeviceId;
  const labels = isInput ? inputLabels : outputLabels;
  const devices = isInput ? inputs : outputs;
  const selectedLabel = deviceId === 'default' ? systemDefault : labels.get(deviceId) ?? systemDefault;
  const volume = isInput ? inputVolume : outputVolume;

  const select = (id: string) => {
    if (isInput) {
      setInputDevice(id); // Pure state update; re-publishes the microphone in a call.
      AudioManager.getInstance().setInputDevice(id).catch(() => {});
    } else {
      setOutputDevice(id);
      AudioManager.getInstance().setOutputDevice(id).catch(() => {});
    }
    setListOpen(false);
  };

  const bars = 20;
  const lit = Math.round(micLevel * bars * (inputVolume / 100));

  return (
    <div>
      <button
        type="button"
        onClick={() => setListOpen((v) => !v)}
        aria-expanded={listOpen}
        className="flex w-full items-center justify-between px-3.5 py-2.5 text-left transition-colors hover:bg-interactive-hover active:bg-interactive-active"
      >
        <span className="min-w-0 flex-1">
          <span className="label-mono block">{isInput ? t('spaces:sidebar.userArea.inputDevice') : t('spaces:sidebar.userArea.outputDevice')}</span>
          <span className="mt-0.5 block truncate text-ui text-txt-primary">{selectedLabel}</span>
        </span>
        <Icon name="chevron-down" size={15} className={`ml-2 flex-shrink-0 text-txt-tertiary transition-transform ${listOpen ? 'rotate-180' : ''}`} />
      </button>
      {listOpen && (
        <div className="mx-2 mb-2 max-h-64 overflow-y-auto rounded-md border border-border-hard bg-surface-input py-1">
          {permState !== 'granted' ? (
            <div className="px-3 py-2 text-meta text-txt-tertiary">
              {isInput ? t('spaces:sidebar.userArea.microphonePermission') : t('spaces:sidebar.userArea.audioPermission')}{' '}
              <button type="button" onClick={() => { requestPermission().catch(() => {}); }} className="text-txt-link underline">
                {t('spaces:sidebar.userArea.enable')}
              </button>
            </div>
          ) : (
            <>
              <DropdownItem label={systemDefault} active={deviceId === 'default'} onClick={() => select('default')} />
              {devices.filter((d) => d.deviceId !== 'default').map((d) => (
                <DropdownItem key={d.deviceId} label={labels.get(d.deviceId) ?? d.deviceId} active={deviceId === d.deviceId} onClick={() => select(d.deviceId)} />
              ))}
            </>
          )}
        </div>
      )}

      <div className="divider-fade" />

      <div className="px-3.5 py-3">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="label-mono">{isInput ? t('spaces:sidebar.userArea.inputVolume') : t('spaces:sidebar.userArea.outputVolume')}</span>
          <span className="tabular font-mono text-label text-txt-tertiary">{volume}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={200}
          value={volume}
          aria-label={isInput ? t('spaces:sidebar.userArea.inputVolume') : t('spaces:sidebar.userArea.outputVolume')}
          onChange={(e) => (isInput ? setInputVolume(Number(e.target.value)) : setOutputVolume(Number(e.target.value)))}
          className="h-1 w-full cursor-pointer appearance-none rounded-sm [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-surface-base [&::-webkit-slider-thumb]:bg-txt-primary"
          style={{
            background: `linear-gradient(to right, rgb(var(--accent-primary)) 0%, rgb(var(--accent-primary)) ${volume / 2}%, rgb(var(--interactive-muted)) ${volume / 2}%, rgb(var(--interactive-muted)) 100%)`,
          }}
        />
        {isInput && (
          <div className="mt-2.5 flex items-center gap-[3px]" aria-hidden="true">
            {Array.from({ length: bars }).map((_, i) => (
              <span key={i} className={`h-[5px] flex-1 rounded-[1px] transition-colors duration-75 ${i < lit ? 'bg-status-online' : 'bg-interactive-muted'}`} />
            ))}
          </div>
        )}
      </div>

      <div className="divider-fade" />

      <button
        type="button"
        onClick={onSettings}
        className="flex w-full items-center justify-between px-3.5 py-2.5 text-ui font-medium text-txt-primary transition-colors hover:bg-interactive-hover active:bg-interactive-active"
      >
        {t('spaces:sidebar.userArea.voiceSettings')}
        <Icon name="settings" size={16} className="text-txt-tertiary" />
      </button>
    </div>
  );
}
