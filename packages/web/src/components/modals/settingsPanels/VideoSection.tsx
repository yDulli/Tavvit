import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Track } from 'livekit-client';
import { useVoiceStore } from '../../../stores/voiceStore';
import { getActiveRoom } from '../../../hooks/useLiveKit';
import { isElectron, getElectronAPI } from '../../../platform/platform';
import { Icon } from '../../ui/Icon';
import { DevicePicker, DropdownItem } from './_shared/SettingsPickerPrimitives';
import { SettingsField, SettingsSection } from './_shared/SettingsControls';

/**
 * Permission state machine for the Video section.
 *
 * - `unknown`     : initial mount, before `permissions.query` resolves.
 * - `granted`     : permission granted; dropdown is populated; tile is dormant
 *                   until user clicks (or attaches to an in-call LK track).
 * - `prompt`      : permission not yet decided; dropdown hidden; CTA card shown.
 * - `denied`      : permission denied; banner shown with "Try again".
 * - `hard-blocked`: a "Try again" attempt failed with NotAllowedError → escalate
 *                   the banner to platform-specific recovery instructions.
 *
 * `permissions.query({ name: 'camera' })` is the ONLY mount-time camera API
 * call. It does not light the LED on any platform. `getUserMedia` is fired
 * exclusively from explicit user gestures (dormant-tile click, prompt CTA,
 * "Try again" button).
 */
type PermissionStatus = 'unknown' | 'granted' | 'prompt' | 'denied' | 'hard-blocked';

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : '';
}

/** Which recovery instructions apply once a retry has also been denied. */
type HardBlockedPlatform = 'browser' | 'mac' | 'windows' | 'other';

function getHardBlockedPlatform(): HardBlockedPlatform {
  if (!isElectron()) return 'browser';
  const platform = getElectronAPI()?.platform;
  if (platform === 'darwin') return 'mac';
  if (platform === 'win32') return 'windows';
  // linux or unknown
  return 'other';
}

/** Why the pre-call preview could not start; rendered through the catalog. */
type PreviewErrorKind = 'inUse' | 'unavailable' | 'notFound' | 'generic';

/**
 * Build a deviceId → display-label map applying the spec's rules:
 * - Empty `label` falls back to a numbered name (`fallbackName`) using the
 *   enumeration index.
 * - Duplicate non-empty labels get `" (1)"`, `" (2)"` suffixes by enumeration order.
 *   Single occurrences stay unsuffixed.
 */
function buildDisplayLabels(
  devices: MediaDeviceInfo[],
  fallbackName: (number: number) => string,
): Map<string, string> {
  const counts = new Map<string, number>();
  for (const d of devices) {
    if (d.label) counts.set(d.label, (counts.get(d.label) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const labels = new Map<string, string>();
  devices.forEach((d, i) => {
    if (!d.label) {
      labels.set(d.deviceId, fallbackName(i + 1));
      return;
    }
    const total = counts.get(d.label) ?? 1;
    if (total <= 1) {
      labels.set(d.deviceId, d.label);
      return;
    }
    const used = (seen.get(d.label) ?? 0) + 1;
    seen.set(d.label, used);
    labels.set(d.deviceId, `${d.label} (${used})`);
  });
  return labels;
}

export function VideoSection() {
  const { t } = useTranslation('settings');
  const cameraDeviceId = useVoiceStore((s) => s.cameraDeviceId);
  const setCameraDeviceId = useVoiceStore((s) => s.setCameraDeviceId);
  const isCameraOn = useVoiceStore((s) => s.isCameraOn);

  const [permState, setPermState] = useState<PermissionStatus>('unknown');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [listOpen, setListOpen] = useState(false);
  // Whether the user has explicitly opened the pre-call preview. Goes false on
  // Stop-preview, tab hidden, unmount, or when in-call mode takes over. Drives
  // (a) whether `getUserMedia` is currently running and (b) whether the
  // currently-using subline is visible.
  const [previewActive, setPreviewActive] = useState(false);
  const [previewError, setPreviewError] = useState<PreviewErrorKind | null>(null);
  // Tracks the deviceId the browser actually picked for the active preview track.
  // Drives the "Currently using: …" subline shown only when previewActive (or
  // in-call attach) AND cameraDeviceId === null.
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  // Tracks mount state so async handlers don't write to state after unmount.
  const mountedRef = useRef(true);
  // Anchor for the dropdown's click-outside-to-close behaviour.
  const dropdownRef = useRef<HTMLDivElement>(null);
  // Preview tile refs.
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);
  // Tracks whether the active in-flight preview-start request is still wanted
  // (cancellable by Stop preview, unmount, visibility change, or re-click).
  const startGenRef = useRef(0);

  // Stop the user-owned pre-call getUserMedia stream and release the camera
  // light. macOS holds the LED on for ~2s after release (hardware debounce).
  const stopPreCall = () => {
    if (previewStreamRef.current) {
      previewStreamRef.current.getTracks().forEach((t) => t.stop());
      previewStreamRef.current = null;
    }
    const videoEl = previewVideoRef.current;
    if (videoEl && videoEl.srcObject instanceof MediaStream) {
      videoEl.srcObject = null;
    }
  };

  // Detach an in-call LK track. NEVER call mst.stop() — the publication is
  // still being consumed by other call participants.
  const detachInCall = () => {
    const videoEl = previewVideoRef.current;
    if (videoEl) videoEl.srcObject = null;
  };

  // Close the dropdown when the user clicks outside it. Listens for both
  // mousedown and touchstart so the popover dismisses with a single tap on
  // touch devices (iOS Safari does not synthesize mousedown reliably from
  // touch).
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

  // Tab-visibility cleanup: release the camera light when the tab is hidden.
  // Per spec, we DO NOT auto-resume on visibility return — the tile goes
  // dormant and the user clicks again. Auto-resume would defeat the privacy
  // model by silently re-lighting the LED on tab focus.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && previewActive) {
        startGenRef.current += 1; // cancel any in-flight start
        stopPreCall();
        setPreviewActive(false);
        setActiveDeviceId(null);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [previewActive]);

  // Mount-time permission probe via the Permissions API. This is the ONLY
  // automatic camera-related call on mount. It is passive and does not light
  // the LED. `'camera'` is not in the `PermissionName` union in lib.dom.d.ts
  // but is supported in Chromium 64+ (every Electron version this project
  // ships), Firefox 79+, Safari 16+. The `as PermissionName` cast is the
  // standard escape hatch.
  useEffect(() => {
    mountedRef.current = true;

    let cancelled = false;
    let status: PermissionStatus_API | null = null;
    let onChange: (() => void) | null = null;

    const apply = (state: PermissionState) => {
      if (cancelled || !mountedRef.current) return;
      if (state === 'granted') setPermState('granted');
      else if (state === 'prompt') setPermState('prompt');
      else setPermState('denied');
    };

    const run = async () => {
      // Permissions API may be missing entirely (older Safari, locked-down
      // environments). If so, we conservatively render the prompt-state CTA so
      // the user can still grant permission via an explicit click — rather
      // than firing getUserMedia behind their back.
      if (!navigator.permissions || typeof navigator.permissions.query !== 'function') {
        if (!cancelled && mountedRef.current) setPermState('prompt');
        return;
      }
      try {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const s = await navigator.permissions.query({ name: 'camera' as PermissionName });
        status = s as PermissionStatus_API;
        apply(s.state);
        // Re-render if the user grants/revokes via OS or browser settings while
        // the section is open.
        onChange = () => apply(s.state);
        s.addEventListener('change', onChange);
      } catch {
        // Some browsers/platforms throw on `name: 'camera'` (older Firefox).
        // Fall back to the prompt CTA — never fire getUserMedia automatically.
        if (!cancelled && mountedRef.current) setPermState('prompt');
      }
    };

    run();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      if (status && onChange) {
        try {
          status.removeEventListener('change', onChange);
        } catch {
          // ignore — best-effort cleanup
        }
      }
    };
  }, []);

  // Enumerate cameras when permission is granted; refresh on devicechange.
  // enumerateDevices() is passive and never lights the LED.
  useEffect(() => {
    if (permState !== 'granted') return;

    let cancelled = false;
    const enumerate = async () => {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        const seen = new Set<string>();
        const cams: MediaDeviceInfo[] = [];
        for (const d of all) {
          if (d.kind !== 'videoinput') continue;
          if (seen.has(d.deviceId)) continue;
          seen.add(d.deviceId);
          cams.push(d);
        }
        setDevices(cams);
      } catch {
        if (!cancelled) setDevices([]);
      }
    };

    enumerate();
    const onChange = () => {
      enumerate();
    };
    navigator.mediaDevices.addEventListener('devicechange', onChange);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener('devicechange', onChange);
    };
  }, [permState]);

  // In-call attach: when an LK camera publication exists with a live track,
  // attach it to the preview <video>. No getUserMedia, no extra LED activity —
  // the LED is already on for the call publication. Reactive on `isCameraOn`
  // and `cameraDeviceId` so hot-swap mid-call updates the preview source.
  //
  // When `isCameraOn` flips false mid-session, the tile returns to DORMANT
  // (no auto-restart of getUserMedia) per the privacy model.
  useEffect(() => {
    if (permState !== 'granted') return;
    if (!isCameraOn) {
      // Camera turned off — detach any in-call attachment. Tile becomes dormant
      // unless the user has an active opt-in pre-call preview running.
      detachInCall();
      if (!previewActive) setActiveDeviceId(null);
      return;
    }

    const room = getActiveRoom();
    if (!room) return;
    const camPub = Array.from(room.localParticipant.trackPublications.values()).find(
      (pub) => pub.source === Track.Source.Camera,
    );
    const mst = camPub?.track?.mediaStreamTrack;
    if (!mst || mst.readyState !== 'live') return;

    // If a pre-call preview is running, stop it cleanly — the in-call track
    // takes over the tile. The LK track's LED is already on for the call.
    if (previewActive) {
      startGenRef.current += 1;
      stopPreCall();
      setPreviewActive(false);
    }

    const videoEl = previewVideoRef.current;
    if (!videoEl) return;
    // Wrap the LK MediaStreamTrack in a fresh MediaStream for srcObject.
    // This mirrors LiveKit's `track.attach()` internally; the wrapper does
    // not duplicate or take ownership of the track.
    videoEl.srcObject = new MediaStream([mst]);
    videoEl.play().catch(() => {});
    setActiveDeviceId(mst.getSettings().deviceId ?? null);
    setPreviewError(null);

    return () => {
      detachInCall();
    };
    // We intentionally exclude `previewActive` from deps — its only role here
    // is to short-circuit the "stop pre-call before attach" branch, which is
    // already idempotent. Including it would re-run the attach on every
    // user-driven start/stop click, causing visible flicker on the tile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permState, isCameraOn, cameraDeviceId]);

  // When the user changes the dropdown WHILE the pre-call preview is running,
  // re-open getUserMedia for the new device. (Same effect was previously
  // bundled into the dual-mode auto-start; isolating it here makes the dormant
  // state truly dormant.)
  useEffect(() => {
    if (permState !== 'granted') return;
    if (!previewActive) return;
    if (isCameraOn) return; // in-call mode handles its own swap via syncCamera

    const gen = ++startGenRef.current;
    stopPreCall();

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: cameraDeviceId ? { deviceId: { exact: cameraDeviceId } } : true,
        });
        if (gen !== startGenRef.current || !mountedRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        previewStreamRef.current = stream;
        const videoEl = previewVideoRef.current;
        if (videoEl) {
          videoEl.srcObject = stream;
          videoEl.play().catch(() => {});
        }
        const id = stream.getVideoTracks()[0]?.getSettings().deviceId ?? null;
        setActiveDeviceId(id);
        setPreviewError(null);
      } catch (err) {
        if (gen !== startGenRef.current || !mountedRef.current) return;
        const name = errorName(err);
        if (name === 'NotReadableError') setPreviewError('inUse');
        else if (name === 'OverconstrainedError') setPreviewError('unavailable');
        else if (name === 'NotAllowedError') {
          setPermState('denied');
          setPreviewActive(false);
        } else setPreviewError('generic');
      }
    };

    start();
    // Cleanup runs on next deviceId change or unmount.
    return () => {
      // Bumping gen invalidates the in-flight start; actual track stop happens
      // when the user clicks Stop preview or via the unmount cleanup below.
    };
  }, [cameraDeviceId, previewActive, isCameraOn, permState]);

  // Component-unmount cleanup: stop any live preview stream so the LED goes off
  // when the modal closes / settings tab changes / route changes.
  useEffect(() => {
    return () => {
      startGenRef.current += 1;
      stopPreCall();
    };
  }, []);

  const displayLabels = useMemo(
    () => buildDisplayLabels(devices, (number) => t('voice.video.camera.fallbackName', { number })),
    [devices, t],
  );

  // Explicit user gesture: open getUserMedia for the selected device.
  // Called from (a) click on dormant tile, (b) "Enable camera preview" CTA,
  // (c) retry from an error state.
  const startPreviewFromUser = async () => {
    setPreviewError(null);
    const gen = ++startGenRef.current;
    stopPreCall();
    setPreviewActive(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: cameraDeviceId ? { deviceId: { exact: cameraDeviceId } } : true,
      });
      if (gen !== startGenRef.current || !mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      previewStreamRef.current = stream;
      const videoEl = previewVideoRef.current;
      if (videoEl) {
        videoEl.srcObject = stream;
        videoEl.play().catch(() => {});
      }
      const id = stream.getVideoTracks()[0]?.getSettings().deviceId ?? null;
      setActiveDeviceId(id);
      // If we were in `prompt` state, this getUserMedia call also granted
      // permission. Transition to `granted`; the enumerate effect picks up.
      if (mountedRef.current) {
        setPermState((prev) => (prev === 'prompt' || prev === 'denied' ? 'granted' : prev));
      }
    } catch (err) {
      if (gen !== startGenRef.current || !mountedRef.current) return;
      const name = errorName(err);
      if (name === 'NotAllowedError') {
        // First-prompt deny from `prompt` state, or "Try again" denial from `denied`.
        setPermState((prev) => (prev === 'denied' ? 'hard-blocked' : 'denied'));
        setPreviewActive(false);
      } else if (name === 'NotReadableError') {
        setPreviewError('inUse');
      } else if (name === 'OverconstrainedError') {
        setPreviewError('unavailable');
      } else if (name === 'NotFoundError') {
        setPreviewError('notFound');
      } else {
        setPreviewError('generic');
      }
    }
  };

  const stopPreviewFromUser = () => {
    startGenRef.current += 1;
    stopPreCall();
    setPreviewActive(false);
    setActiveDeviceId(null);
    setPreviewError(null);
  };

  // ── Render ────────────────────────────────────────────────────────────

  if (permState === 'unknown') {
    return (
      <SettingsSection title={t('voice.video.title')}>
        <p className="text-ui text-txt-tertiary">{t('voice.video.checkingAccess')}</p>
      </SettingsSection>
    );
  }

  if (permState === 'denied' || permState === 'hard-blocked') {
    return (
      <SettingsSection title={t('voice.video.title')}>
        <div className="flex items-start gap-2.5">
          <Icon name="alert" size={16} className="mt-px flex-shrink-0 text-txt-warning" />
          <div className="min-w-0">
            <p className="text-ui font-medium text-txt-primary">{t('voice.video.accessDenied.title')}</p>
            <p className="mt-0.5 text-meta leading-snug text-txt-tertiary">
              {permState === 'hard-blocked'
                ? t(`voice.video.blocked.${getHardBlockedPlatform()}`)
                : t('voice.video.accessDenied.description')}
            </p>
            <button type="button" onClick={startPreviewFromUser} className="btn-outline btn-sm mt-2.5">
              {t('voice.video.accessDenied.retry')}
            </button>
          </div>
        </div>
      </SettingsSection>
    );
  }

  if (permState === 'prompt') {
    return (
      <SettingsSection title={t('voice.video.title')}>
        <div>
          <p className="text-meta leading-snug text-txt-tertiary">{t('voice.video.permissionPrompt.description')}</p>
          <button type="button" onClick={startPreviewFromUser} className="btn-outline mt-2.5">
            <Icon name="video" size={15} />
            {t('voice.video.permissionPrompt.enable')}
          </button>
        </div>
      </SettingsSection>
    );
  }

  // permState === 'granted'
  const autoLabel = t('voice.video.camera.auto');
  const selectedLabel =
    cameraDeviceId === null
      ? autoLabel
      : displayLabels.get(cameraDeviceId) ?? autoLabel;

  const handleSelect = (id: string | null) => {
    setCameraDeviceId(id);
    setListOpen(false);
  };

  // The preview tile is "dormant" when no in-call track is attached AND no
  // user-initiated preview is running. In dormant state we render a play-icon
  // overlay and a click handler that calls startPreviewFromUser.
  const inCallAttached = isCameraOn && activeDeviceId !== null && !previewActive;
  const isDormant = !previewActive && !inCallAttached;

  return (
    <SettingsSection title={t('voice.video.title')}>
      <div className="flex flex-col gap-4 desktop:flex-row desktop:items-start">
        <div className="group relative aspect-video w-full flex-shrink-0 overflow-hidden rounded-md border border-border-hard bg-surface-base desktop:w-64">
          <video
            ref={previewVideoRef}
            muted
            playsInline
            autoPlay
            className={`h-full w-full object-cover ${isDormant ? 'invisible' : ''}`}
            style={{ transform: 'scaleX(-1)' }}
          />
          {isDormant && (
            <button
              type="button"
              onClick={startPreviewFromUser}
              aria-label={t('voice.video.preview.testAria')}
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-txt-tertiary transition-colors hover:bg-interactive-hover hover:text-txt-secondary active:bg-interactive-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-soft"
            >
              <Icon name="play" size={22} />
              <span className="text-meta">{t('voice.video.preview.testHint')}</span>
            </button>
          )}
          {previewActive && !previewError && (
            <button
              type="button"
              onClick={stopPreviewFromUser}
              // Mobile: always visible (no hover state) and 44 px tap target
              // per iOS HIG. Desktop: hover-reveal compact button.
              className="absolute right-2 top-2 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-black/60 px-3 py-2 text-meta text-white/90 transition-colors hover:bg-black/75 focus-visible:opacity-100
                         desktop:min-h-0 desktop:min-w-0 desktop:px-2 desktop:py-1 desktop:text-label desktop:opacity-0 desktop:group-hover:opacity-100"
            >
              {t('voice.video.preview.stop')}
            </button>
          )}
          {previewError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface-base/90 px-4 text-center text-meta text-txt-secondary">
              <div>{t(`voice.video.previewError.${previewError}`)}</div>
              <button type="button" onClick={startPreviewFromUser} className="btn-outline btn-sm">
                {t('voice.video.preview.retry')}
              </button>
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <SettingsField label={t('voice.video.camera.label')}>
            <DevicePicker selectedLabel={selectedLabel} open={listOpen} onToggle={() => setListOpen((v) => !v)} pickerRef={dropdownRef}>
              <DropdownItem
                label={autoLabel}
                active={cameraDeviceId === null}
                onClick={() => handleSelect(null)}
              />
              {devices.map((d) => (
                <DropdownItem
                  key={d.deviceId}
                  label={displayLabels.get(d.deviceId) ?? d.deviceId}
                  active={cameraDeviceId === d.deviceId}
                  onClick={() => handleSelect(d.deviceId)}
                />
              ))}
            </DevicePicker>
            {cameraDeviceId === null &&
              activeDeviceId &&
              (previewActive || isCameraOn) &&
              (() => {
                const m = devices.find((d) => d.deviceId === activeDeviceId);
                const detected = t('voice.video.camera.detectedFallback');
                const label = m
                  ? displayLabels.get(activeDeviceId) ?? (m.label || detected)
                  : detected;
                return <p className="mt-1.5 text-meta text-txt-tertiary">{t('voice.video.camera.currentlyUsing', { label })}</p>;
              })()}
            {devices.length === 0 && (
              <p className="mt-1.5 text-meta text-txt-tertiary">{t('voice.video.camera.none')}</p>
            )}
          </SettingsField>
        </div>
      </div>
    </SettingsSection>
  );
}

// Local alias for the runtime PermissionStatus event-target. The lib.dom name
// `PermissionStatus` clashes with our internal state-machine type name above,
// so we alias it here at the bottom for the listener-cleanup branch.
type PermissionStatus_API = globalThis.PermissionStatus;
