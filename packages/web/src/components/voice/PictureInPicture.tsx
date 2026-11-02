import { layoutRect, layoutPixels, MOBILE_LAYOUT_BREAKPOINT } from '../../platform/interfaceScale';
import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useVoiceStore } from '../../stores/voiceStore';
import { useChatStore } from '../../stores/chatStore';
import { useUIStore } from '../../stores/uiStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { Avatar, avatarRadius } from '../ui/Avatar';
import { ChannelIcon } from '../ui/ChannelIcon';
import { Icon } from '../ui/Icon';
import { LiveBadge } from './LiveBadge';
import { VoiceIcon } from './voiceIcons';
import type { ParticipantInfo } from '../../hooks/useLiveKit';
import { useVoiceParticipantMeta } from '../../hooks/useVoiceParticipantMeta';
import { useActiveDmCall } from '../../hooks/useActiveDmCall';
import { dmCallRoomKey } from '../../utils/dmCall';

/** Stable fallback for useVoiceParticipantMeta when no participant exists */
const EMPTY_PARTICIPANT: ParticipantInfo = {
  identity: '', userId: '', username: '', homeUserId: null,
  isMuted: false, isDeafened: false, isCameraOn: false, isScreenSharing: false,
  isLocal: false, audioTrack: null, videoTrack: null, screenTrack: null,
  screenAudioTrack: null, lkVideoTrack: null, lkScreenTrack: null,
  cachedUser: null,
};

const PIP_WIDTH = 320;
const PIP_HEIGHT = 180;
const PIP_MARGIN = 16;
const DRAG_THRESHOLD = 5;

/**
 * Computes PiP boundary box by measuring actual DOM obstacles.
 * Obstacle elements declare themselves with data-pip-obstacle="top"|"left"|"bottom".
 * PiP queries them at boundary-check time — no hardcoded layout values.
 *
 * On mobile (<768px) there are no fixed side/bottom UI obstacles.
 */
function getPipBounds(pipX: number): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  const vw = layoutPixels(window.innerWidth);
  const vh = layoutPixels(window.innerHeight);
  let minX = PIP_MARGIN;
  const maxX = vw - PIP_WIDTH - PIP_MARGIN;
  let minY = PIP_MARGIN;
  let maxY = vh - PIP_HEIGHT - PIP_MARGIN;

  if (vw < MOBILE_LAYOUT_BREAKPOINT) return { minX, maxX, minY, maxY };

  const obstacles = document.querySelectorAll<HTMLElement>('[data-pip-obstacle]');
  for (const el of obstacles) {
    const rect = layoutRect(el.getBoundingClientRect());
    if (rect.width === 0 || rect.height === 0) continue;

    const direction = el.dataset.pipObstacle;
    if (direction === 'top') {
      minY = Math.max(minY, rect.bottom + PIP_MARGIN);
    } else if (direction === 'left') {
      minX = Math.max(minX, rect.right + PIP_MARGIN);
    } else if (direction === 'bottom') {
      const pipRight = pipX + PIP_WIDTH;
      if (pipX < rect.right && pipRight > rect.left) {
        maxY = Math.min(maxY, rect.top - PIP_HEIGHT - PIP_MARGIN);
      }
    }
  }

  return { minX, maxX, minY, maxY };
}

interface SelectedStream {
  participant: ParticipantInfo;
  track: MediaStreamTrack;
  type: 'screen' | 'camera';
}

function selectPipStream(
  participants: ParticipantInfo[],
  lastFocusedId: string | null,
  watchingStreams: Set<string>,
): SelectedStream | null {
  // Priority 1: Last-focused stream tile (identity:stream suffix → screen share)
  if (lastFocusedId?.endsWith(':stream')) {
    const identity = lastFocusedId.slice(0, -':stream'.length);
    const focused = participants.find(p => p.identity === identity);
    if (focused?.screenTrack) {
      return { participant: focused, track: focused.screenTrack, type: 'screen' };
    }
  }

  // Priority 2: Last-focused user tile (identity match → camera)
  if (lastFocusedId && !lastFocusedId.endsWith(':stream')) {
    const focused = participants.find(p => p.identity === lastFocusedId);
    if (focused?.videoTrack) {
      return { participant: focused, track: focused.videoTrack, type: 'camera' };
    }
  }

  // Priority 3: Screen share from a user we're watching
  const screenSharer = participants.find(
    p => p.screenTrack !== null && watchingStreams.has(p.userId),
  );
  if (screenSharer?.screenTrack) {
    return { participant: screenSharer, track: screenSharer.screenTrack, type: 'screen' };
  }

  // Priority 4: Remote participant with camera
  const remoteWithCamera = participants.find(p => !p.isLocal && p.videoTrack !== null);
  if (remoteWithCamera?.videoTrack) {
    return { participant: remoteWithCamera, track: remoteWithCamera.videoTrack, type: 'camera' };
  }

  // Priority 5: Local participant with camera
  const localWithCamera = participants.find(p => p.isLocal && p.videoTrack !== null);
  if (localWithCamera?.videoTrack) {
    return { participant: localWithCamera, track: localWithCamera.videoTrack, type: 'camera' };
  }

  return null;
}

export function PictureInPicture() {
  const { t } = useTranslation(['voice', 'common']);
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Store state
  const currentVoiceChannelId = useVoiceStore((s) => s.currentVoiceChannelId);
  const activeDmCall = useVoiceStore((s) => s.activeDmCall);
  // The conversation of the DM call, as this client can open it: never the
  // call's key, which names no conversation here.
  const { dmChannelId: dmCallChannel } = useActiveDmCall();
  const dmCallKey = activeDmCall ? dmCallRoomKey(activeDmCall) : null;
  const participants = useVoiceStore((s) => s.participants);
  const focusedParticipantId = useVoiceStore((s) => s.focusedParticipantId);
  const watchingStreams = useVoiceStore((s) => s.watchingStreams);
  const speakingParticipantIds = useVoiceStore((s) => s.speakingParticipantIds);
  const pipEnabled = useVoiceStore((s) => s.pipEnabled);
  const currentChannelId = useChatStore((s) => s.currentChannelId);
  const voiceFullscreen = useUIStore((s) => s.voiceFullscreen);
  const pipCollapsed = useUIStore((s) => s.pipCollapsed);
  const setPipCollapsed = useUIStore((s) => s.setPipCollapsed);
  const channelToSpaceMap = useSpaceStore((s) => s.channelToSpaceMap);
  const channels = useSpaceStore((s) => s.channels);

  // Drag state
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: -1, y: -1 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const dragStartPos = useRef({ x: 0, y: 0 });
  const hasMoved = useRef(false);

  // Reset pipCollapsed when joining a new call
  const prevVoiceChannel = useRef(currentVoiceChannelId);
  const prevDmCall = useRef(dmCallKey);
  useEffect(() => {
    const voiceChanged = currentVoiceChannelId !== prevVoiceChannel.current;
    const dmChanged = dmCallKey !== prevDmCall.current;
    prevVoiceChannel.current = currentVoiceChannelId;
    prevDmCall.current = dmCallKey;
    if ((voiceChanged && currentVoiceChannelId) || (dmChanged && dmCallKey)) {
      setPipCollapsed(false);
    }
  }, [currentVoiceChannelId, dmCallKey, setPipCollapsed]);

  // Visibility — split into wouldShow (ignores collapsed) and shouldShow (full check)
  const isInServerVoice = currentVoiceChannelId !== null && currentChannelId !== currentVoiceChannelId;
  const isInDmCall = activeDmCall !== null && currentChannelId !== dmCallChannel;
  const wouldShow = (isInServerVoice || isInDmCall) && !voiceFullscreen && pipEnabled;
  const shouldShow = wouldShow && !pipCollapsed;

  // Reset pipCollapsed when wouldShow transitions false → true
  // (user navigated away from voice channel view → PiP reappears)
  const prevWouldShow = useRef(wouldShow);
  useEffect(() => {
    if (wouldShow && !prevWouldShow.current) {
      setPipCollapsed(false);
    }
    prevWouldShow.current = wouldShow;
  }, [wouldShow, setPipCollapsed]);

  // Track last speaker for avatar fallback (persists after they stop speaking)
  const lastSpeakerRef = useRef<string | null>(null);
  useEffect(() => {
    for (const id of speakingParticipantIds) {
      const p = participants.find(pp => pp.identity === id && !pp.isLocal);
      if (p) {
        lastSpeakerRef.current = p.identity;
        break;
      }
    }
  }, [speakingParticipantIds, participants]);

  // Track last non-null focusedParticipantId so PiP persists when grid focus clears
  const lastFocusRef = useRef<string | null>(null);
  useEffect(() => {
    if (focusedParticipantId) {
      lastFocusRef.current = focusedParticipantId;
    }
  }, [focusedParticipantId]);

  // Clear stale last-focus when the focused participant/track is gone
  const effectiveLastFocus = useMemo(() => {
    const id = lastFocusRef.current;
    if (!id) return null;
    if (id.endsWith(':stream')) {
      const identity = id.slice(0, -':stream'.length);
      const p = participants.find(pp => pp.identity === identity);
      if (p?.screenTrack) return id;
    } else {
      const p = participants.find(pp => pp.identity === id);
      if (p?.videoTrack) return id;
    }
    // Focused content is gone — clear ref
    lastFocusRef.current = null;
    return null;
  }, [participants]);

  // Stream selection
  const selectedStream = useMemo(
    () => selectPipStream(participants, effectiveLastFocus, watchingStreams),
    [participants, effectiveLastFocus, watchingStreams],
  );

  // Fallback participant for avatar (last speaker > first remote > local)
  const fallbackParticipant = useMemo(() => {
    // Currently speaking remote
    const speaking = participants.find(p => !p.isLocal && speakingParticipantIds.has(p.identity));
    if (speaking) return speaking;
    // Last speaker (persists after they stop)
    if (lastSpeakerRef.current) {
      const last = participants.find(p => p.identity === lastSpeakerRef.current);
      if (last) return last;
    }
    // Any remote
    const remote = participants.find(p => !p.isLocal);
    if (remote) return remote;
    return participants[0] ?? null;
  }, [participants, speakingParticipantIds]);

  // Channel name for display
  const channelName = useMemo(() => {
    if (currentVoiceChannelId) {
      const ch = channels.find(c => c.id === currentVoiceChannelId);
      return ch?.name ?? t('voice:status.voiceChannel');
    }
    return t('voice:status.dmCall');
  }, [currentVoiceChannelId, channels, t]);
  // A DM call has none, and shows the speaker.
  const channelIcon = useMemo(
    () => (currentVoiceChannelId ? channels.find(c => c.id === currentVoiceChannelId)?.icon ?? null : null),
    [currentVoiceChannelId, channels],
  );

  // Derive the LiveKit Track from the selected stream's participant
  const lkTrack = selectedStream
    ? (selectedStream.type === 'screen'
        ? selectedStream.participant.lkScreenTrack
        : selectedStream.participant.lkVideoTrack)
    : null;

  // Video track attachment — use LiveKit's track.attach() to register the element
  // with the adaptive stream observer (enables SFU layer switching by viewport size)
  // shouldShow in deps ensures re-run when PiP becomes visible (videoRef was null before)
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    if (lkTrack) {
      lkTrack.attach(videoEl);
      return () => { lkTrack.detach(videoEl); };
    } else {
      videoEl.srcObject = null;
    }
  }, [lkTrack, shouldShow]);

  // Initialize position to bottom-right
  useEffect(() => {
    if (shouldShow && position.x === -1) {
      const initX = layoutPixels(window.innerWidth) - PIP_WIDTH - PIP_MARGIN;
      const { maxY } = getPipBounds(initX);
      setPosition({ x: initX, y: maxY });
    }
  }, [shouldShow, position.x]);

  // Re-clamp PiP when viewport resizes, obstacles appear/disappear, or obstacles resize
  useEffect(() => {
    if (!shouldShow) return;

    const reclamp = () => {
      setPosition(prev => {
        if (prev.x === -1) return prev;
        const { minX, maxX } = getPipBounds(prev.x);
        const clampedX = Math.max(minX, Math.min(maxX, prev.x));
        const { minY, maxY } = getPipBounds(clampedX);
        return { x: clampedX, y: Math.max(minY, Math.min(maxY, prev.y)) };
      });
    };

    // Observe obstacle elements for size changes (e.g., voice panel expanding)
    let knownObstacles = new Set(document.querySelectorAll<HTMLElement>('[data-pip-obstacle]'));
    const resizeObserver = new ResizeObserver(reclamp);
    knownObstacles.forEach(el => resizeObserver.observe(el));

    // Detect obstacle elements being added/removed from the DOM
    const mutationObserver = new MutationObserver(() => {
      const current = new Set(document.querySelectorAll<HTMLElement>('[data-pip-obstacle]'));
      if (current.size !== knownObstacles.size || ![...current].every(el => knownObstacles.has(el))) {
        resizeObserver.disconnect();
        current.forEach(el => resizeObserver.observe(el));
        knownObstacles = current;
        reclamp();
      }
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });

    window.addEventListener('resize', reclamp);
    return () => {
      window.removeEventListener('resize', reclamp);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [shouldShow]);

  // Snap to nearest horizontal edge
  const snapToEdge = useCallback((currentX: number, currentY: number) => {
    const centerX = currentX + PIP_WIDTH / 2;
    const screenMidX = layoutPixels(window.innerWidth) / 2;
    const { minX } = getPipBounds(currentX);
    const targetX = centerX < screenMidX
      ? minX
      : layoutPixels(window.innerWidth) - PIP_WIDTH - PIP_MARGIN;
    const { minY, maxY } = getPipBounds(targetX);
    const clampedY = Math.max(minY, Math.min(maxY, currentY));
    setPosition({ x: targetX, y: clampedY });
  }, []);

  // Drag handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-pip-action]')) return;
    setIsDragging(true);
    hasMoved.current = false;
    dragOffset.current = { x: layoutPixels(e.clientX) - position.x, y: layoutPixels(e.clientY) - position.y };
    dragStartPos.current = { x: layoutPixels(e.clientX), y: layoutPixels(e.clientY) };
    containerRef.current?.setPointerCapture(e.pointerId);
  }, [position]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = Math.abs(layoutPixels(e.clientX) - dragStartPos.current.x);
    const dy = Math.abs(layoutPixels(e.clientY) - dragStartPos.current.y);
    if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
      hasMoved.current = true;
    }
    const rawX = layoutPixels(e.clientX) - dragOffset.current.x;
    const bounds = getPipBounds(rawX);
    const newX = Math.max(bounds.minX, Math.min(bounds.maxX, rawX));
    const { minY, maxY } = getPipBounds(newX);
    const newY = Math.max(minY, Math.min(maxY, layoutPixels(e.clientY) - dragOffset.current.y));
    setPosition({ x: newX, y: newY });
  }, [isDragging]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    containerRef.current?.releasePointerCapture(e.pointerId);

    if (!hasMoved.current) {
      // Click — navigate back to voice channel
      if (activeDmCall) {
        // A call whose conversation this client has no copy of has nowhere
        // to return to.
        if (dmCallChannel) navigate(`/channels/@me/${dmCallChannel}`);
      } else if (currentVoiceChannelId) {
        const spaceId = channelToSpaceMap.get(currentVoiceChannelId);
        if (spaceId) {
          navigate(`/channels/${spaceId}/${currentVoiceChannelId}`);
        }
      }
    } else {
      // Drag ended — snap to edge
      snapToEdge(position.x, position.y);
    }
  }, [isDragging, activeDmCall, dmCallChannel, currentVoiceChannelId, channelToSpaceMap, navigate, snapToEdge, position]);

  const handleClose = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setPipCollapsed(true);
  }, [setPipCollapsed]);

  // Compute displayParticipant before early return so hook is called unconditionally
  const displayParticipant = useMemo(
    () => selectedStream?.participant ?? fallbackParticipant,
    [selectedStream, fallbackParticipant],
  );

  const { displayName: resolvedName, avatar: resolvedAvatar, user: resolvedUser } =
    useVoiceParticipantMeta(displayParticipant ?? EMPTY_PARTICIPANT);

  if (!shouldShow) return null;

  const displayName = displayParticipant
    ? (displayParticipant.isLocal ? `${resolvedName} ${t('voice:badges.you')}` : resolvedName)
    : channelName;
  const hasVideo = selectedStream !== null;
  const isScreen = selectedStream?.type === 'screen';

  return (
    <div
      ref={containerRef}
      className={`glass fixed z-[40] overflow-hidden rounded-lg select-none ${
        isDragging ? 'cursor-grabbing' : 'cursor-grab'
      }`}
      style={{
        width: PIP_WIDTH,
        height: PIP_HEIGHT,
        left: position.x,
        top: position.y,
        transition: isDragging ? 'none' : 'left 0.2s ease, top 0.2s ease',
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Video or Avatar fallback */}
      {hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
          style={{ imageRendering: 'auto' }}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-surface-channel">
          {displayParticipant ? (
            <div className="relative flex">
              <Avatar
                src={resolvedAvatar}
                name={resolvedName}
                size={64}
                userId={displayParticipant.homeUserId ?? displayParticipant.userId}
                user={resolvedUser ?? undefined}
              />
              {speakingParticipantIds.has(displayParticipant.identity) && (
                <div
                  className="absolute inset-0 ring-2 ring-status-online"
                  style={{ borderRadius: avatarRadius(64) }}
                />
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-txt-tertiary">
              <ChannelIcon type="voice" icon={channelIcon} size={20} />
              <span className="text-body font-medium">{channelName}</span>
            </div>
          )}
        </div>
      )}

      {/* LIVE badge */}
      {isScreen && <LiveBadge className="absolute top-2 left-2 h-5" />}

      {/* Close button */}
      <button
        data-pip-action="close"
        onClick={handleClose}
        aria-label={t('common:actions.close')}
        className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-md bg-black/60 text-white/80 transition-colors duration-100 hover:bg-black/80 hover:text-white active:bg-black/90"
      >
        <Icon name="x" size={14} />
      </button>

      {/* Bottom overlay with name; the scrim is there for the picture */}
      <div className={`absolute bottom-0 left-0 right-0 pl-3 pr-8 py-2 ${hasVideo ? 'bg-gradient-to-t from-black/70 to-transparent' : ''}`}>
        <div className="flex items-center gap-1.5">
          <span className="text-white text-meta font-medium truncate">{displayName}</span>
          {displayParticipant && speakingParticipantIds.has(displayParticipant.identity) && (
            <div className="w-1.5 h-1.5 rounded-full bg-status-online flex-shrink-0" />
          )}
        </div>
        <div className="text-white/60 text-label truncate">{channelName}</div>
      </div>

      {/* Expand icon hint (bottom-right) */}
      <div className="absolute bottom-2 right-2 flex h-5 w-5 items-center justify-center text-white/50">
        <VoiceIcon name="expand" size={14} />
      </div>
    </div>
  );
}
