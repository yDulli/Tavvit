// Dev-only workbench for watching together (docs/systems/watch-together.md). Nothing in the app
// imports this file; `dev-watch-together.html` is its only entry.
//
// Every component is the real one: the channel list's `VoiceChannel`, the call's `VoiceGrid` and
// `VoiceControlBar`, the call's own floating window and `WatchPlayerHost`. The edge is replaced: a
// small room in this file answers what the controls ask the way `routes/watch.ts` does, so the
// player can be looked at and used without a LiveKit server or a call. "general" leaves the call's
// view, where the video floats. The panel at the bottom left plays the others in the call.
// `?lang=de` picks the interface language.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { MemberWithUser, User } from '@backspace/shared';
import type { ErrorCode, ErrorDetails } from '@backspace/shared/src/errors';
import {
  fileTitleOf,
  parseWatchUrl,
  WATCH_LIMITS,
  WATCH_REACTIONS,
  watchPositionAt,
  type WatchAction,
  type WatchItem,
  type WatchSession,
} from '@backspace/shared/src/watch';
import { HttpError } from '../api/client';
import { ChannelIcon } from '../components/ui/ChannelIcon';
import { Icon } from '../components/ui/Icon';
import { ToastContainer } from '../components/ui/ToastContainer';
import { PictureInPicture } from '../components/voice/PictureInPicture';
import { VoiceChannel } from '../components/voice/VoiceChannel';
import { VoiceControlBar } from '../components/voice/VoiceControlBar';
import { VoiceGrid } from '../components/voice/VoiceGrid';
import { WatchPlayerHost } from '../components/voice/WatchPlayerHost';
import { initI18n } from '../i18n';
import type { ParticipantInfo } from '../hooks/useLiveKit';
import { initializeInterfaceScale } from '../platform/interfaceScale';
import { useAppearanceStore } from '../stores/appearanceStore';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { useSpaceStore } from '../stores/spaceStore';
import { useVoiceStore } from '../stores/voiceStore';
import { useWatchStore } from '../stores/watchStore';
import { applyAppearance } from '../utils/appTheme';
import { PermissionBits, permissionsToString } from '../utils/permissions';
import '../styles/globals.css';

const SPACE = 'space';
const CALL = 'lounge';
const OTHER_CALL = 'film-night';
const ME = 'jonas';

const IN_CALL = [
  { id: 'jonas', name: 'Jonas Weber', color: 'sky' },
  { id: 'lena', name: 'Lena Hoffmann', color: 'rose' },
  { id: 'noor', name: 'Noor Haddad', color: 'lavender' },
  { id: 'theo', name: 'Theo Marchetti', color: 'mint' },
] as const;
const IN_OTHER_CALL = [
  { id: 'mara', name: 'Mara Lindqvist', color: 'amber' },
  { id: 'ari', name: 'Ari Solberg', color: 'coral' },
] as const;

function person(id: string, name: string, avatarColor: string): User {
  return {
    id,
    username: id,
    displayName: name,
    avatar: null,
    banner: null,
    accentColor: null,
    avatarColor,
    bio: null,
    status: 'online',
    customStatus: null,
    isAdmin: false,
    createdAt: 1,
    homeInstance: null,
    homeUserId: null,
    replicatedInstances: [],
  } as User;
}

const participants: ParticipantInfo[] = IN_CALL.map((entry) => ({
  identity: entry.id,
  userId: entry.id,
  username: entry.id,
  homeUserId: null,
  isMuted: false,
  isDeafened: false,
  isCameraOn: false,
  isScreenSharing: false,
  isLocal: entry.id === ME,
  audioTrack: null,
  videoTrack: null,
  screenTrack: null,
  screenAudioTrack: null,
  lkVideoTrack: null,
  lkScreenTrack: null,
  cachedUser: null,
}));

const members = [...IN_CALL, ...IN_OTHER_CALL].map((entry) => ({
  userId: entry.id,
  spaceId: SPACE,
  roles: [],
  user: person(entry.id, entry.name, entry.color),
})) as unknown as MemberWithUser[];

// ─── The room ──────────────────────────────────────────────────────────────
// What `routes/watch.ts` and `utils/watchSessions.ts` do on the server, for this page's one call.

/** Openly licensed films that may be embedded, one of each kind of link. */
const FILMS = {
  bunny: { url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', title: 'Big Buck Bunny' },
  sintel: { url: 'https://www.youtube.com/watch?v=eRsGyueVLvQ', title: 'Sintel' },
  vimeo: { url: 'https://vimeo.com/1084537', title: 'Big Buck Bunny on Vimeo' },
  file: { url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4', title: 'Elephants Dream' },
} as const;

let itemCount = 0;

function refuse(status: number, code: ErrorCode, details?: ErrorDetails): never {
  throw new HttpError(status, code, undefined, code, details);
}

function itemOf(url: string, title: string): WatchItem {
  const source = parseWatchUrl(url);
  if (!source) refuse(400, 'watch_link_unsupported');
  itemCount += 1;
  return { ...source, id: `item-${itemCount}`, title };
}

function startingSession(): WatchSession {
  return {
    channelId: CALL,
    spaceId: SPACE,
    current: itemOf(FILMS.bunny.url, FILMS.bunny.title),
    queue: [FILMS.sintel, FILMS.vimeo, FILMS.file].map((film) => itemOf(film.url, film.title)),
    playing: true,
    positionMs: 0,
    stateAt: Date.now(),
    control: 'everyone',
    starterId: ME,
  };
}

function sessionNow(): WatchSession | null {
  return useWatchStore.getState().sessions.get(CALL)?.session ?? null;
}

/** Tell the call where the session stands, as `announceWatch` does; this page is the call. */
function announce(session: WatchSession | null): void {
  useWatchStore.getState().applyState(CALL, session, Date.now());
}

function playNext(session: WatchSession, now: number): WatchSession {
  const [next = null, ...rest] = session.queue;
  return { ...session, current: next, queue: rest, positionMs: next?.startMs ?? 0, playing: next !== null, stateAt: now };
}

function withAction(session: WatchSession, action: WatchAction, userId: string): WatchSession {
  const now = Date.now();
  if (action.action === 'control') {
    if (session.starterId !== userId) refuse(403, 'watch_not_controller');
    return { ...session, control: action.control };
  }
  if (session.control !== 'everyone' && session.starterId !== userId) refuse(403, 'watch_not_controller');
  switch (action.action) {
    case 'play':
    case 'pause': {
      if (!session.current) refuse(404, 'watch_not_found');
      const playing = action.action === 'play';
      return session.playing === playing ? session : { ...session, positionMs: watchPositionAt(session, now), playing, stateAt: now };
    }
    case 'seek':
      if (!session.current) refuse(404, 'watch_not_found');
      return { ...session, positionMs: Math.max(0, Math.round(action.positionMs)), stateAt: now };
    case 'next':
      return action.itemId === undefined || action.itemId === session.current?.id ? playNext(session, now) : session;
    case 'remove':
      return session.current?.id === action.itemId
        ? playNext(session, now)
        : { ...session, queue: session.queue.filter((item) => item.id !== action.itemId) };
  }
}

useWatchStore.setState({
  add: async (_channelId, url) => {
    const source = parseWatchUrl(url);
    if (!source) refuse(400, 'watch_link_unsupported');
    // The server asks the provider for a title; without an answer the video is named by its provider.
    const item = itemOf(url, source.provider === 'file' ? fileTitleOf(source.url) : '');
    const session = sessionNow();
    const now = Date.now();
    if (!session) {
      announce({ channelId: CALL, spaceId: SPACE, current: item, queue: [], playing: true, positionMs: item.startMs, stateAt: now, control: 'everyone', starterId: ME });
    } else if (!session.current) {
      announce({ ...session, current: item, positionMs: item.startMs, playing: true, stateAt: now });
    } else {
      if (session.queue.length >= WATCH_LIMITS.QUEUE_MAX) refuse(409, 'watch_queue_full', { max: WATCH_LIMITS.QUEUE_MAX });
      announce({ ...session, queue: [...session.queue, item] });
    }
  },
  change: async (_channelId, action) => {
    const session = sessionNow();
    if (!session) refuse(404, 'watch_not_found');
    announce(withAction(session, action, ME));
  },
  end: async () => {
    const session = sessionNow();
    if (!session) refuse(404, 'watch_not_found');
    if (session.control !== 'everyone' && session.starterId !== ME) refuse(403, 'watch_not_controller');
    announce(null);
  },
  react: async (_channelId, reaction) => {
    if (!sessionNow()?.current) refuse(404, 'watch_not_found');
    // The server sends a reaction to everyone in the call, the one who reacted included.
    useWatchStore.getState().addReaction(CALL, reaction);
  },
});

// ─── The page ──────────────────────────────────────────────────────────────

/** Says which channel is open, as opening one in the app does; the call's floating window reads it. */
function useViewing(channelId: string): void {
  useEffect(() => {
    useChatStore.setState({ currentChannelId: channelId });
  }, [channelId]);
}

function Sidebar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (
    <aside className="flex w-60 flex-shrink-0 flex-col gap-0.5 border-r border-border-hard bg-surface-channel p-2">
      <p className="label-mono px-2 pb-1 pt-2">Text</p>
      <button
        type="button"
        onClick={() => navigate(`/channels/${SPACE}/general`)}
        data-active={pathname.endsWith('/general') ? 'true' : undefined}
        className="nav-item group w-full text-left"
      >
        <ChannelIcon type="text" size={16} className="flex-shrink-0 text-txt-tertiary" />
        <span className="min-w-0 flex-1 truncate">general</span>
      </button>
      <p className="label-mono px-2 pb-1 pt-4">Voice</p>
      <VoiceChannel channelId={CALL} channelName={CALL} onClick={() => navigate(`/channels/${SPACE}/${CALL}`)} />
      <VoiceChannel channelId={OTHER_CALL} channelName={OTHER_CALL} onClick={() => undefined} />
    </aside>
  );
}

function CallView() {
  const { t } = useTranslation(['spaces']);
  useViewing(CALL);
  return (
    <div className="group/voice flex min-h-0 flex-1 flex-col">
      <div className="panel-bar flex items-center gap-3 px-5">
        <Icon name="volume" size={19} className="text-txt-tertiary" />
        <span className="text-lead font-semibold tracking-[-0.01em] text-txt-primary">{CALL}</span>
        <span className="ml-2 text-meta font-medium text-status-online">{t('spaces:main.voice.connected')}</span>
        <span className="ml-1 text-meta text-txt-tertiary">{t('spaces:main.voice.participants', { count: participants.length })}</span>
      </div>
      <div className="relative flex min-h-0 flex-1 pb-20">
        <VoiceGrid participants={participants} />
        <VoiceControlBar />
      </div>
    </div>
  );
}

function OtherChannel() {
  useViewing('general');
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="panel-bar flex items-center gap-3 px-5">
        <ChannelIcon type="text" size={19} className="text-txt-tertiary" />
        <span className="text-lead font-semibold tracking-[-0.01em] text-txt-primary">general</span>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div className="empty-state">
          <div className="empty-state-icon">
            <Icon name="watch" size={18} />
          </div>
          <p className="empty-state-title">Another channel</p>
          <p className="empty-state-body">The call goes on, and its video floats where the call&apos;s own window would.</p>
        </div>
      </div>
      <div data-pip-obstacle="bottom" className="glass-bubble mx-4 mb-4 rounded-lg px-4 py-3 text-ui text-txt-tertiary">
        Message #general
      </div>
    </div>
  );
}

/** The others in the call, played by hand. */
function Workbench() {
  const speaking = useVoiceStore((state) => state.speakingParticipantIds.has('lena'));
  const session = useWatchStore((state) => state.sessions.get(CALL)?.session ?? null);
  const [reactions, setReactions] = useState(0);
  const lenaSteers = session?.starterId === 'lena' && session.control === 'starter';

  const someoneReacts = () => {
    const reaction = WATCH_REACTIONS[(reactions * 3) % WATCH_REACTIONS.length]!;
    setReactions((count) => count + 1);
    useWatchStore.getState().addReaction(CALL, reaction);
  };
  const toggleSpeaking = () => {
    const ids = speaking ? new Set<string>() : new Set(['lena']);
    useVoiceStore.setState({ speakingParticipantIds: ids, speakingUserIds: ids });
  };
  const toggleLenaSteers = () => {
    if (!session) return;
    announce(lenaSteers ? { ...session, starterId: ME, control: 'everyone' } : { ...session, starterId: 'lena', control: 'starter' });
  };

  return (
    <div className="glass fixed bottom-4 left-4 z-[60] flex w-[208px] flex-col gap-1 rounded-lg p-3">
      <p className="label-mono pb-1">Workbench</p>
      <button type="button" onClick={someoneReacts} disabled={!session?.current} className="btn-quiet btn-sm justify-start">Someone reacts</button>
      <button type="button" onClick={toggleSpeaking} className="btn-quiet btn-sm justify-start">{speaking ? 'Lena stops speaking' : 'Lena speaks'}</button>
      <button type="button" onClick={toggleLenaSteers} disabled={!session} className="btn-quiet btn-sm justify-start">
        {lenaSteers ? 'Jonas started it again' : 'Lena started it, steers alone'}
      </button>
      <button type="button" onClick={() => announce(startingSession())} className="btn-quiet btn-sm justify-start">Start over</button>
    </div>
  );
}

function WatchTogetherPreview() {
  return (
    <MemoryRouter initialEntries={[`/channels/${SPACE}/${CALL}`]}>
      <div className="flex h-screen bg-surface-base">
        <Sidebar />
        <main className="lit flex min-h-0 min-w-0 flex-1 flex-col bg-surface-chat">
          <Routes>
            <Route path={`/channels/${SPACE}/${CALL}`} element={<CallView />} />
            <Route path="*" element={<OtherChannel />} />
          </Routes>
        </main>
      </div>
      <Workbench />
      <PictureInPicture />
      <WatchPlayerHost />
      <ToastContainer />
    </MemoryRouter>
  );
}

initializeInterfaceScale();
applyAppearance(document.documentElement, useAppearanceStore.getState());
useAuthStore.setState({ user: person(ME, 'Jonas Weber', 'sky') });
useSpaceStore.setState({
  members,
  channelToSpaceMap: new Map([[CALL, SPACE], [OTHER_CALL, SPACE], ['general', SPACE]]),
  channelPermissions: new Map([[CALL, permissionsToString(PermissionBits.SPEAK | PermissionBits.STREAM)]]),
});
// Only what a call sets while it runs: the settings the voice store keeps on this device stay as they are.
useVoiceStore.setState({
  currentVoiceChannelId: CALL,
  participants,
  isLiveKitConnected: true,
  voiceConnectionStatus: 'connected',
  voiceUsers: new Map<string, string[]>([[CALL, IN_CALL.map((entry) => entry.id)], [OTHER_CALL, IN_OTHER_CALL.map((entry) => entry.id)]]),
  speakingParticipantIds: new Set(),
  speakingUserIds: new Set(),
});
useWatchStore.setState({ presence: new Map([[OTHER_CALL, { title: 'Spring', provider: 'youtube' }]]) });
announce(startingSession());

void initI18n().finally(() => {
  const root = document.getElementById('root');
  if (root) createRoot(root).render(<WatchTogetherPreview />);
});
