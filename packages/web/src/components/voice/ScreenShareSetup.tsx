import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { getElectronAPI, isElectron, isElectronMac } from '../../platform/platform';
import { useVoiceStore } from '../../stores/voiceStore';
import { useScreenShareSetupStore } from '../../stores/screenShareSetupStore';
import { usePortalContainer } from '../../hooks/usePortalContainer';
import { getActiveRoom } from '../../hooks/useLiveKit';
import { broadcastVoiceStatus } from '../../utils/voice';
import {
  stageScreenCapture,
  applyStagedCaptureConfig,
  stopStagedCapture,
  publishScreenShare,
  isScreenCaptureSupported,
  isCaptureCancellation,
  canAddScreenShareAudioLater,
} from '../../utils/screenShare';
import { StreamQualityControls, StreamSummary, StreamHostSubtitle } from './StreamQualityControls';
import { pickAutoStageSource, type ScreenSourceTab } from '../../utils/screenShareSources';
import { Icon } from '../ui/Icon';
import { VoiceIcon } from './voiceIcons';

/**
 * ScreenShareSetup — the one screen every screen share starts from.
 *
 * Flow on every platform: pick a source → the capture is *staged* (live, but
 * not published; previewed here) → tune quality → "Start stream" publishes.
 * Cancelling stops the staged tracks; nothing was ever sent.
 *
 * Source picking differs by platform:
 *   - Electron with `getScreenSources` (current desktop): sources are listed
 *     up front. Clicking a tile preselects it in the main process and calls
 *     getDisplayMedia(), which the main process answers without a prompt.
 *   - Electron without it (older desktop): the "Choose" card calls
 *     getDisplayMedia(); the main process pushes its source list back
 *     (`onScreenShareSources`) and the grid appears inline; clicking a tile
 *     answers that in-flight request (`selectScreenSource`).
 *   - Electron on a system-picker platform (Wayland): same "Choose" card,
 *     but the OS screencast portal does the picking. Listing sources up front
 *     would open the portal on every open, so nothing is enumerated until the
 *     click; the main process answers the request with the portal's single
 *     result.
 *   - Browser: the "Choose" card calls getDisplayMedia() and the browser's
 *     own prompt does the picking. Must happen inside the click (transient
 *     activation), which is why the choice is a button and not automatic.
 *
 * The card is a fixed, near-viewport floating surface so the layout never jumps
 * with its content. The quality panel is a drawer that slides in over the
 * stage from the right, opened from the "Stream settings" button in the
 * footer's actions (next to Cancel / Start) or the footer summary.
 */

type Tab = ScreenSourceTab;

/**
 * The kind of surface being shared, shown next to "Ready to go live".
 *
 * Derived ONLY from a tile we enumerated and the user clicked, never from the
 * captured track. `MediaTrackSettings.displaySurface` looks like the right
 * source for this and is not: Firefox omits it, and Electron on a Wayland
 * portal session reports `window` for a whole screen. A confidently wrong
 * "Window" label is worse than no label, and the live preview already shows
 * exactly what will be shared. So browser and portal captures show the plain
 * "Ready to go live" and let the preview speak.
 */
type CapturedSurfaceKind = 'monitor' | 'window';
type SetupError = 'cancelled' | 'unsupported' | 'captureFailed' | 'startFailed' | null;

function errorKey(err: unknown): SetupError {
  if (isCaptureCancellation(err)) return 'cancelled';
  if (err instanceof Error && err.name === 'NotSupportedError') return 'unsupported';
  return 'captureFailed';
}

export function ScreenShareSetup() {
  const { t } = useTranslation(['voice', 'common']);
  const isOpen = useScreenShareSetupStore((s) => s.isOpen);
  const close = useScreenShareSetupStore((s) => s.close);
  const portalContainer = usePortalContainer();
  const config = useVoiceStore((s) => s.screenShareConfig);
  const lastSourceId = useVoiceStore((s) => s.lastScreenShareSourceId);
  const isScreenSharing = useVoiceStore((s) => s.isScreenSharing);

  const api = getElectronAPI();
  const electron = isElectron();

  // Who picks: null until the desktop answered (or immediately 'app' where it can't be asked)
  const [pickerMode, setPickerMode] = useState<'app' | 'system' | null>(null);
  const canListSources = electron && pickerMode === 'app' && typeof api?.getScreenSources === 'function';
  const systemPicker = electron && pickerMode === 'system';

  // Electron source grid
  const [sources, setSources] = useState<ElectronScreenSource[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [sourcesNonce, setSourcesNonce] = useState(0);
  const [activeTab, setActiveTab] = useState<Tab>('screens');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Quality drawer
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Staged capture (all platforms)
  const [staged, setStaged] = useState<MediaStream | null>(null);
  const [stagedShareAudio, setStagedShareAudio] = useState<boolean>(config.shareAudio);
  const [staging, setStaging] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<SetupError>(null);
  const stagedRef = useRef<MediaStream | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Older-desktop prompted flow bookkeeping. The ref is the source of truth for
  // synchronous decisions inside callbacks; the state mirror is what render reads.
  const promptInFlightRef = useRef(false);
  const [promptInFlight, setPromptInFlight] = useState(false);
  const pendingPromptIdRef = useRef<string | null>(null);

  /**
   * Bumped by every pick. A capture whose generation is stale by the time
   * getDisplayMedia() resolves belongs to nobody — the screen was closed, or a
   * newer source was picked — so it is stopped instead of being adopted. Without
   * it, cancelling mid-prompt leaks a live OS capture (this component is mounted
   * once in App.tsx and never unmounts, so no cleanup ever runs), and two quick
   * picks can leave the preview showing one surface while the labels name another.
   */
  const stageGenerationRef = useRef(0);

  /**
   * One auto-stage per open. `stage()`'s catch clears `staged`, `staging` and
   * `selectedId` — every piece of state the auto-stage effect guards on — so a
   * capture that keeps failing (macOS without the Screen Recording grant, or a
   * preselected source the main process cannot resolve) would re-arm the effect
   * immediately and spin IPC round trips, each one a fresh desktopCapturer scan
   * with thumbnails, for as long as the screen stays open.
   */
  const autoStagedRef = useRef(false);

  /**
   * Whether the in-flight prompt has already been answered. The main process
   * consumes the answer with `ipcMain.once`, so only the first tile click
   * reaches the request; a second one would move the highlight and the ready
   * bar onto a source that is not the one being captured.
   */
  const promptAnsweredRef = useRef(false);

  const markPromptInFlight = useCallback((value: boolean) => {
    promptInFlightRef.current = value;
    promptAnsweredRef.current = false;
    setPromptInFlight(value);
  }, []);

  const replaceStaged = useCallback((next: MediaStream | null) => {
    if (stagedRef.current && stagedRef.current !== next) stopStagedCapture(stagedRef.current);
    stagedRef.current = next;
    setStaged(next);
  }, []);

  /**
   * Capture via getDisplayMedia and hold the result as the staged preview.
   * `claimed` reuses a generation already taken by stageSource; a direct call
   * (the "Choose screen" button) takes a fresh one.
   */
  const stage = useCallback(async (claimed?: number) => {
    const generation = claimed ?? ++stageGenerationRef.current;
    setError(null);
    setStaging(true);
    const shareAudioAtStage = useVoiceStore.getState().screenShareConfig.shareAudio;
    // System picker: no tile carries the audio preference, so send it ahead of the request
    api?.setScreenShareAudioPreference?.(shareAudioAtStage);
    try {
      const stream = await stageScreenCapture();
      if (generation !== stageGenerationRef.current) {
        // Superseded while the picker was open: never adopt it, and never
        // leave the OS capturing for a stream nothing will publish.
        stopStagedCapture(stream);
        return;
      }
      replaceStaged(stream);
      setStagedShareAudio(shareAudioAtStage);
    } catch (err) {
      if (generation !== stageGenerationRef.current) return;
      replaceStaged(null);
      setSelectedId(null);
      setError(errorKey(err));
    } finally {
      // Only the newest attempt owns these flags; an older one finishing later
      // must not clear the spinner out from under the capture still running.
      if (generation === stageGenerationRef.current) {
        markPromptInFlight(false);
        setStaging(false);
      }
    }
  }, [api, replaceStaged, markPromptInFlight]);

  /** Electron: a tile was clicked. Resolve an in-flight prompt, or preselect and stage. */
  const stageSource = useCallback(async (sourceId: string) => {
    if (!api) return;
    const shareAudio = useVoiceStore.getState().screenShareConfig.shareAudio;
    if (promptInFlightRef.current) {
      // Only the first click answers the request; see promptAnsweredRef.
      if (promptAnsweredRef.current) return;
      promptAnsweredRef.current = true;
      setSelectedId(sourceId);
      // The in-flight stage() call owns the current generation and is waiting
      // on the very capture this click answers, so it must keep it. Taking a
      // new generation here would make that result stale on arrival: the
      // stream is stopped on sight, no preview appears, and because the guard
      // returns before the `finally`, the spinner never clears and Start stays
      // disabled until the screen is closed.
      api.selectScreenSource(sourceId, shareAudio);
      return;
    }
    setSelectedId(sourceId);
    const generation = ++stageGenerationRef.current;
    if (api.preselectScreenSource) {
      // Awaited: the preselection and getDisplayMedia() travel different IPC
      // pipes with no ordering guarantee between them. If the display-media
      // handler wins the race it finds no preselection, degrades to the
      // prompted flow, and the preselection then sits armed for its whole TTL
      // ready to hijack the next share. The round trip is free next to a dialog.
      try {
        await api.preselectScreenSource(sourceId, shareAudio);
      } catch (err) {
        console.error('[ScreenShareSetup] preselectScreenSource failed:', err);
      }
      // A newer tile was clicked while the preselection was in flight
      if (generation !== stageGenerationRef.current) return;
    } else {
      // Older desktop: the main process will push sources; answer with this id when it does.
      pendingPromptIdRef.current = sourceId;
    }
    void stage(generation);
  }, [api, stage]);

  // Ask the desktop who picks, once per open
  useEffect(() => {
    if (!isOpen) return;
    if (!electron) { setPickerMode('app'); return; }
    if (!api?.getScreenSharePickerMode) { setPickerMode('app'); return; }
    let cancelled = false;
    api.getScreenSharePickerMode()
      .then((mode) => { if (!cancelled) setPickerMode(mode); })
      .catch(() => { if (!cancelled) setPickerMode('app'); });
    return () => { cancelled = true; };
  }, [isOpen, electron, api]);

  // Electron: list sources up front when we can. `sourcesNonce` is what the
  // empty state's "Try again" bumps — an enumeration that came back empty
  // (macOS without the Screen Recording grant) is worth retrying by hand once
  // the user has granted it, and nothing else would re-run this.
  useEffect(() => {
    if (!isOpen || !canListSources || !api?.getScreenSources) return;
    let cancelled = false;
    setLoadingSources(true);
    api.getScreenSources()
      .then((list) => { if (!cancelled) setSources(list); })
      .catch((err) => { console.error('[ScreenShareSetup] getScreenSources failed:', err); if (!cancelled) setSources([]); })
      .finally(() => { if (!cancelled) setLoadingSources(false); });
    return () => { cancelled = true; };
  }, [isOpen, canListSources, api, sourcesNonce]);

  // Older desktop: main pushes sources for an in-flight getDisplayMedia
  useEffect(() => {
    if (!api) return;
    api.onScreenShareSources((incoming) => {
      const pendingId = pendingPromptIdRef.current;
      if (pendingId) {
        pendingPromptIdRef.current = null;
        api.selectScreenSource(pendingId, useVoiceStore.getState().screenShareConfig.shareAudio);
        return;
      }
      markPromptInFlight(true);
      setSources(incoming);
    });
    // Preload registers listeners without a remover; register once for the app lifetime.
  }, [api, markPromptInFlight]);

  // Reset per open
  useEffect(() => {
    if (!isOpen) return;
    setActiveTab('screens');
    setSearch('');
    setSelectedId(null);
    setError(null);
    setStarting(false);
    setSettingsOpen(false);
    setSources([]);
    // Abandon anything still in flight from the previous open, and drop a
    // capture staged back then: reopening must never offer a stale surface as
    // "ready to go live", nor let Start publish it instead of a fresh pick.
    stageGenerationRef.current++;
    autoStagedRef.current = false;
    replaceStaged(null);
    setStagedShareAudio(useVoiceStore.getState().screenShareConfig.shareAudio);
    setStaging(false);
    markPromptInFlight(false);
    pendingPromptIdRef.current = null;
  }, [isOpen, replaceStaged, markPromptInFlight]);

  // Stage the remembered source (or a lone screen) so the common case needs a
  // single click on Start
  useEffect(() => {
    if (!isOpen || !canListSources || staged || staging || selectedId || autoStagedRef.current) return;
    const source = pickAutoStageSource(sources, lastSourceId, activeTab);
    if (!source) return;
    autoStagedRef.current = true;
    // Show the tile that is about to be staged, rather than leaving the grid on
    // Screens with a window in the preview and no highlight anywhere.
    if (!source.isScreen) setActiveTab('windows');
    void stageSource(source.id);
  }, [isOpen, canListSources, sources, lastSourceId, staged, staging, selectedId, activeTab, stageSource]);

  // Preview element ↔ staged stream
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    el.srcObject = staged;
    if (staged) el.play().catch(() => {});
    return () => { el.srcObject = null; };
  }, [staged]);

  // Browser "Stop sharing" bar during staging ends the track: drop the preview
  useEffect(() => {
    const track = staged?.getVideoTracks()[0];
    if (!track) return;
    const onEnded = () => { replaceStaged(null); setSelectedId(null); };
    track.addEventListener('ended', onEnded);
    return () => track.removeEventListener('ended', onEnded);
  }, [staged, replaceStaged]);

  // Quality changes reach the staged track immediately (local only, no renegotiation)
  useEffect(() => {
    if (!staged) return;
    void applyStagedCaptureConfig(staged);
  }, [staged, config.height, config.fps, config.mode]);

  // The closed drawer is off-canvas but still in the DOM, so its buttons,
  // sliders and toggle would stay in the tab order: tabbing through the setup
  // screen would move focus into an aria-hidden subtree, which browsers refuse
  // ("Blocked aria-hidden on an element because its descendant retained
  // focus") and screen readers announce from nowhere. `inert` removes the whole
  // subtree from focus and the accessibility tree at once. React 18 has no
  // `inert` prop, so it is set as a DOM property.
  // `isOpen` is a dependency because the whole card is unmounted while closed:
  // reopening builds a new drawer element, and without it the effect would not
  // re-run (settingsOpen is false both before and after) so the fresh element
  // would stay focusable.
  useEffect(() => {
    const el = drawerRef.current;
    if (el) el.inert = !settingsOpen;
  }, [settingsOpen, isOpen]);

  const handleClose = useCallback(() => {
    // Abandon any capture still being picked. Without this the promise resolves
    // onto a closed screen and the OS keeps capturing forever.
    stageGenerationRef.current++;
    setStaging(false);
    if (promptInFlightRef.current && api) {
      api.selectScreenSource(null);
    }
    markPromptInFlight(false);
    pendingPromptIdRef.current = null;
    replaceStaged(null);
    close();
  }, [api, replaceStaged, close, markPromptInFlight]);

  // Already live (started elsewhere while open): the setup no longer applies
  useEffect(() => {
    if (isOpen && isScreenSharing && !starting) handleClose();
  }, [isOpen, isScreenSharing, starting, handleClose]);

  // Escape closes the drawer first, then the screen; also release the capture on unmount
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (settingsOpen) setSettingsOpen(false);
      else handleClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, settingsOpen, handleClose]);
  useEffect(() => () => stopStagedCapture(stagedRef.current), []);

  const handleStart = useCallback(async () => {
    const stream = stagedRef.current;
    const room = getActiveRoom();
    if (!stream || !room) { setError('startFailed'); return; }
    setStarting(true);
    setError(null);
    const ok = await publishScreenShare(room, stream, { sourceId: selectedId, pickerMode });
    if (!ok) {
      // publishScreenShare stopped the tracks on failure
      stagedRef.current = null;
      setStaged(null);
      setSelectedId(null);
      setStarting(false);
      setError('startFailed');
      return;
    }
    broadcastVoiceStatus();
    // Remember what was shared, not what was merely staged: a pick the user
    // backed out of should not be the thing that comes up next time. Only a
    // tile we enumerated has an id worth keeping — a browser or portal capture
    // has none, and stores null so a stale one cannot outlive it.
    useVoiceStore.getState().setLastScreenShareSourceId(selectedId);
    // Ownership moved to LiveKit: do not stop the tracks on close
    stagedRef.current = null;
    setStaged(null);
    setStarting(false);
    close();
  }, [close, selectedId, pickerMode]);

  const screens = useMemo(() => sources.filter((s) => s.isScreen), [sources]);
  const windows = useMemo(() => {
    const wins = sources.filter((s) => !s.isScreen);
    if (!search.trim()) return wins;
    const q = search.trim().toLowerCase();
    return wins.filter((w) => w.name.toLowerCase().includes(q));
  }, [sources, search]);

  if (!isOpen) return null;

  const showGrid = electron && (canListSources || promptInFlight || sources.length > 0);
  const activeSources = activeTab === 'windows' ? windows : screens;
  const supported = isScreenCaptureSupported();
  // Turning System Audio off after picking is honoured at Start (the audio is
  // held back). Turning it on is too where the desktop app can add loopback
  // audio to the running share; elsewhere audio comes only with a new pick.
  const audioNeedsRepick = !!staged && config.shareAudio && !stagedShareAudio
    && !canAddScreenShareAudioLater(selectedId, pickerMode);
  const canStart = !!staged && !staging && !starting;
  const chooseHint = !electron
    ? t('voice:screenPicker.chooseHint')
    : systemPicker
      ? t('voice:screenPicker.chooseHintSystem')
      : null;
  const stageNow = () => void stage();
  const stagedSource = sources.find((s) => s.id === selectedId) ?? null;
  // Only a source we picked ourselves has a name and a kind we can trust.
  const stagedName = stagedSource?.name ?? null;
  // Derived from our own enumeration, never from the track: displaySurface
  // reports "window" for a whole monitor on a portal session.
  const stagedKind: CapturedSurfaceKind | null =
    stagedSource ? (stagedSource.isScreen ? 'monitor' : 'window') : null;
  const readyLabel = stagedKind
    ? `${t('voice:screenPicker.stageReady')} · ${t(`voice:screenPicker.kind.${stagedKind}`)}`
    : t('voice:screenPicker.stageReady');

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      {/* Backdrop */}
      <div className="modal-scrim absolute inset-0" onClick={handleClose} />

      {/* Card — fixed to the viewport so the layout never jumps with its content */}
      <div
        data-testid="screen-share-setup"
        className="relative w-[calc(calc(100*var(--app-vw))-2rem)] desktop:w-[calc(calc(100*var(--app-vw))-6rem)] max-w-6xl h-[calc(88*var(--app-vh))] glass-modal rounded-lg overflow-hidden animate-slide-up flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 pl-4 pr-3 desktop:pl-5 py-2.5 border-b border-border-hard flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-lead font-semibold text-txt-primary leading-tight">{t('voice:screenPicker.title')}</h2>
            <p className="text-meta text-txt-tertiary mt-0.5">{t('voice:screenPicker.subtitle')}</p>
          </div>
          <button
            onClick={handleClose}
            className="icon-btn icon-btn-lg"
            aria-label={t('common:actions.close')}
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Toolbar — Screens / Windows plus window search; only where the app lists sources */}
        {showGrid && (
          <div className="flex items-center justify-between gap-3 px-4 desktop:px-5 pt-3 flex-shrink-0">
            <div className="flex rounded-md border border-border-soft bg-surface-input p-0.5">
              <TabButton
                active={activeTab === 'screens'}
                onClick={() => setActiveTab('screens')}
                label={t('voice:screenPicker.tabs.screens')}
                count={screens.length}
              />
              <TabButton
                active={activeTab === 'windows'}
                onClick={() => setActiveTab('windows')}
                label={t('voice:screenPicker.tabs.windows')}
                count={windows.length}
              />
            </div>
            {showGrid && activeTab === 'windows' && (
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('voice:screenPicker.searchWindows')}
                className="input-search w-64 max-w-[45%] py-1.5"
                autoFocus
              />
            )}
          </div>
        )}

        {/* Body: full-width source area; the quality drawer slides in over it */}
        <div className="relative flex-1 min-h-0 overflow-hidden flex">
          {/* Source area */}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col px-4 desktop:px-5 py-3">
            {showGrid ? (
              <>
                {/* Source grid */}
                <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin rounded-lg border border-border-hard bg-surface-input p-3">
                  {loadingSources && sources.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-txt-tertiary text-ui">
                      {t('voice:screenPicker.loadingSources')}
                    </div>
                  ) : activeSources.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
                      <div className="text-txt-secondary text-ui">
                        {activeTab === 'windows' && search.trim()
                          ? t('voice:screenPicker.noWindowsMatch')
                          : activeTab === 'screens'
                            ? t('voice:screenPicker.noScreens')
                            : t('voice:screenPicker.noWindows')}
                      </div>
                      {/* Nothing at all, on either tab: the enumeration itself came
                          back empty. On macOS that is almost always the missing
                          Screen Recording grant, which the OS reports as "no
                          sources" rather than as a denial, so the screen would
                          otherwise be a dead end with nothing to act on. */}
                      {sources.length === 0 && (
                        <>
                          {isElectronMac() && (
                            <p className="text-ui text-txt-tertiary max-w-sm">
                              {t('voice:screenPicker.permissionHintMac')}
                            </p>
                          )}
                          <button
                            onClick={() => setSourcesNonce((n) => n + 1)}
                            disabled={loadingSources}
                            aria-busy={loadingSources}
                            className="btn-outline"
                          >
                            {t('voice:screenPicker.retrySources')}
                          </button>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className={`grid gap-3 ${activeTab === 'screens' ? 'grid-cols-2 desktop:grid-cols-3' : 'grid-cols-2 desktop:grid-cols-4'}`}>
                      {activeSources.map((source) => (
                        <SourceCard
                          key={source.id}
                          source={source}
                          selected={selectedId === source.id}
                          onClick={() => void stageSource(source.id)}
                          onDoubleClick={() => { if (stagedRef.current && selectedId === source.id) void handleStart(); }}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Staged strip — live preview of the chosen tile */}
                <div className={`flex-shrink-0 overflow-hidden transition-all duration-300 ${staged ? 'max-h-40 mt-3 opacity-100' : 'max-h-0 mt-0 opacity-0'}`}>
                  <div className="surface-card rounded-lg flex items-center gap-3 p-2">
                    <div className="w-36 flex-shrink-0">
                      <div className="relative rounded-md overflow-hidden bg-black aspect-video">
                        <video ref={previewRef} autoPlay muted playsInline className="w-full h-full object-contain" />
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="label-mono text-txt-positive truncate">{readyLabel}</div>
                      <div className="text-ui font-medium text-txt-primary truncate mt-1">
                        {stagedName ?? t('voice:screenPicker.preview')}
                      </div>
                      {audioNeedsRepick && (
                        <div className="text-label text-accent-amber mt-1">{t('voice:screenPicker.audioNeedsRepick')}</div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              /* Browser, system picker, or older desktop before its prompt: the stage */
              <div className="relative flex-1 min-h-0 rounded-lg overflow-hidden border border-border-hard bg-surface-input">

                {staged ? (
                  <>
                    <video ref={previewRef} autoPlay muted playsInline className="absolute inset-0 w-full h-full object-contain bg-black" />
                    <div className="label-mono absolute top-2 left-2 rounded bg-black/65 px-1.5 py-0.5 text-white/80">
                      {t('voice:screenPicker.preview')}
                    </div>
                    <div className="absolute inset-x-0 bottom-0 px-4 py-3 flex flex-col items-start gap-2 desktop:flex-row desktop:items-center desktop:justify-between desktop:gap-3 bg-gradient-to-t from-black/70 to-transparent">
                      <div className="min-w-0">
                        <div className="label-mono text-txt-positive truncate">{readyLabel}</div>
                        {stagedName && (
                          <div className="text-ui font-medium text-white truncate mt-1">{stagedName}</div>
                        )}
                        {audioNeedsRepick && (
                          <div className="text-label text-accent-amber mt-1">{t('voice:screenPicker.audioNeedsRepick')}</div>
                        )}
                      </div>
                      <button
                        onClick={stageNow}
                        disabled={staging}
                        aria-busy={staging}
                        className="btn-outline flex-shrink-0 bg-surface-elevated hover:bg-surface-elevated"
                      >
                        {t('voice:screenPicker.chooseAgain')}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="empty-state h-full">
                    <div className="empty-state-icon">
                      <Icon name="monitor" size={18} />
                    </div>
                    <div className="label-mono">{t('voice:screenPicker.stageIdle')}</div>
                    <div className="empty-state-title">{t('voice:screenPicker.chooseTitle')}</div>
                    {chooseHint && (
                      <div className="empty-state-body">{chooseHint}</div>
                    )}
                    <button
                      onClick={stageNow}
                      disabled={staging || !supported || (electron && pickerMode === null)}
                      aria-busy={staging}
                      className="btn-primary mt-3"
                    >
                      {t('voice:screenPicker.choose')}
                    </button>
                    {!supported && (
                      <div className="text-meta text-txt-danger mt-1">{t('voice:screenPicker.unsupported')}</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Drawer scrim — click outside the drawer closes it */}
          <div
            className={`absolute inset-0 z-10 bg-black/40 transition-opacity duration-300 ${settingsOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            onClick={() => setSettingsOpen(false)}
          />

          {/* Quality drawer: slides in from the right, over the source area */}
          <div
            ref={drawerRef}
            id="stream-settings-drawer-panel"
            data-testid="stream-settings-drawer"
            aria-hidden={!settingsOpen}
            className={`absolute inset-y-0 right-0 z-20 w-[calc(calc(100*var(--app-vw))-5rem)] desktop:w-[340px] glass flex flex-col min-h-0 transition-transform duration-200 ease-out ${
              settingsOpen ? 'translate-x-0' : 'translate-x-full'
            }`}
          >
            <div className="flex items-center justify-between gap-3 pl-4 pr-3 py-2 border-b border-border-hard flex-shrink-0">
              <div className="min-w-0">
                <div className="text-body font-semibold text-txt-primary">{t('voice:streamSettings.title')}</div>
                <StreamHostSubtitle className="mt-0.5" />
              </div>
              <button
                onClick={() => setSettingsOpen(false)}
                className="icon-btn"
                aria-label={t('common:actions.close')}
              >
                <Icon name="x" size={16} />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-4 py-3">
              <StreamQualityControls />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 flex items-center justify-between gap-3 px-4 desktop:px-5 py-2.5 border-t border-border-hard">
          <div className="min-w-0 flex flex-col">
            <button
              onClick={() => setSettingsOpen(true)}
              className="group min-w-0 rounded text-left truncate"
              title={t('voice:streamSettings.title')}
            >
              <StreamSummary className="transition-colors duration-100 group-hover:text-txt-secondary" />
            </button>
            {error && (
              <span className="text-meta text-txt-danger truncate" role="alert">
                {t(`voice:screenPicker.${error}`)}
              </span>
            )}
          </div>
          <div className="flex flex-shrink-0 items-center gap-1.5">
            <button
              onClick={() => setSettingsOpen((open) => !open)}
              aria-expanded={settingsOpen}
              aria-controls="stream-settings-drawer-panel"
              aria-label={t('voice:streamSettings.title')}
              title={t('voice:streamSettings.title')}
              className={`btn-quiet ${settingsOpen ? 'bg-interactive-selected text-txt-primary' : ''}`}
            >
              <VoiceIcon name="sliders" size={16} className="flex-shrink-0" />
              <span className="hidden desktop:inline">{t('voice:streamSettings.title')}</span>
            </button>
            <div aria-hidden="true" className="w-px h-5 bg-border-hard mx-0.5" />
            <button
              onClick={handleClose}
              className="btn-quiet"
            >
              {t('common:actions.cancel')}
            </button>
            <button
              onClick={() => void handleStart()}
              disabled={!canStart}
              aria-busy={starting}
              className="btn-primary"
            >
              {t('voice:screenPicker.start')}
            </button>
          </div>
        </div>

      </div>
    </div>,
    portalContainer,
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TabButton({ active, onClick, label, count }: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number | null;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`relative rounded px-3 py-1 text-ui font-medium transition-colors duration-100 ${
        active
          ? 'bg-surface-elevated text-txt-primary'
          : 'text-txt-secondary hover:text-txt-primary hover:bg-interactive-hover active:bg-interactive-active'
      }`}
    >
      {label}
      {count !== null && count > 0 && (
        <span className="tabular ml-1.5 font-mono text-label text-txt-tertiary">
          {count}
        </span>
      )}
      {active && <span aria-hidden="true" className="absolute inset-x-2 bottom-0 h-[2px] rounded-t-[1px] bg-accent-primary" />}
    </button>
  );
}

function SourceCard({ source, selected, onClick, onDoubleClick }: {
  source: ElectronScreenSource;
  selected: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      aria-pressed={selected}
      className={`group flex flex-col rounded-lg overflow-hidden border bg-surface-channel text-left transition-colors duration-100 ${
        selected
          ? 'border-accent-primary ring-1 ring-accent-primary'
          : 'border-border-hard hover:border-interactive-muted hover:bg-surface-elevated'
      }`}
    >
      {/* Thumbnail */}
      <div className="relative aspect-video bg-black overflow-hidden">
        <img
          src={source.thumbnailDataUrl}
          alt={source.name}
          className="w-full h-full object-contain"
          draggable={false}
        />
        {selected && (
          <div className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-accent-primary text-on-accent">
            <Icon name="check" size={14} strokeWidth={2.25} />
          </div>
        )}
      </div>

      {/* Label */}
      <div className="flex items-center gap-1.5 px-2.5 py-2 min-w-0">
        {source.appIconDataUrl && (
          <img
            src={source.appIconDataUrl}
            alt=""
            className="w-4 h-4 flex-shrink-0"
            draggable={false}
          />
        )}
        <span className={`text-meta truncate ${selected ? 'text-txt-primary' : 'text-txt-secondary'}`}>
          {source.name}
        </span>
      </div>
    </button>
  );
}
