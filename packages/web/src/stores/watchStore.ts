import { create } from 'zustand';
import {
  isWatchSession,
  type WatchAction,
  type WatchPosition,
  type WatchPresence,
  type WatchReaction,
  type WatchSession,
} from '@backspace/shared/src/watch';
import { getApiForOrigin, getChannelOrigin, useSpaceStore } from './spaceStore';
import { useVoiceStore } from './voiceStore';
import { clockOffset } from '../utils/watchSync';

/**
 * Watching together (docs/systems/watch-together.md): the session of the call this client is in,
 * what plays in the voice channels the channel list shows, and the reactions flying over the
 * picture. Keyed by channel id, as the voice store is: ids are unique across instances, and the
 * instance a channel lives on is `getChannelOrigin`'s to say.
 */

export interface WatchEntry {
  session: WatchSession;
  /** The server's clock minus this one, when the session last arrived (utils/watchSync.ts). */
  offsetMs: number;
}

/** A reaction in the air. Nobody is named: the call sees a reaction, not who gave it. */
export interface FlyingReaction {
  id: number;
  channelId: string;
  reaction: WatchReaction;
}

/** How long a reaction flies before it is gone; the animation lasts as long. */
export const REACTION_FLIGHT_MS = 2_400;
/** The most reactions in the air at once, so a burst cannot fill the screen. */
const MAX_FLYING = 24;

let nextReactionId = 1;

interface WatchState {
  sessions: ReadonlyMap<string, WatchEntry>;
  presence: ReadonlyMap<string, WatchPresence>;
  reactions: readonly FlyingReaction[];
  /** The place in the voice view the player is shown over; null while that view is not open. */
  slot: HTMLElement | null;
  setSlot: (slot: HTMLElement | null) => void;
  /**
   * The call whose video the person put away (in the call's view, or its floating window): it does
   * not play for them until they show it again. Held by the call, not by the view: a view rebuilt
   * around the same call keeps the choice, and another call starts with its video shown.
   */
  videoHiddenFor: string | null;
  setVideoHidden: (channelId: string, hidden: boolean) => void;
  /** Take a session as the server sent it; one that is not a session as the server sends them is dropped. */
  applyState: (channelId: string, session: unknown, serverNow: number) => void;
  /** Where the call's video stands now (`watch_position`); ignored while the session plays another video. */
  applyPosition: (channelId: string, position: WatchPosition, serverNow: number) => void;
  applyPresence: (channelId: string, presence: WatchPresence | null) => void;
  /**
   * A snapshot of what plays (ready, space_voice_state): authoritative for the channels it covers,
   * which `covers` names, and for nothing else.
   */
  applyPresenceSnapshot: (covers: (channelId: string) => boolean, watching: Record<string, WatchPresence> | undefined) => void;
  addReaction: (channelId: string, reaction: WatchReaction) => void;
  dropReaction: (id: number) => void;
  /** This client left the call: its session is not this client's to follow any more. */
  forgetCall: (channelId: string) => void;
  add: (channelId: string, url: string) => Promise<void>;
  change: (channelId: string, action: WatchAction) => Promise<void>;
  end: (channelId: string) => Promise<void>;
  react: (channelId: string, reaction: WatchReaction) => Promise<void>;
}

function withPresence(current: ReadonlyMap<string, WatchPresence>, channelId: string, presence: WatchPresence | null): Map<string, WatchPresence> {
  const next = new Map(current);
  if (presence) next.set(channelId, presence);
  else next.delete(channelId);
  return next;
}

function presenceOf(session: WatchSession | null): WatchPresence | null {
  return session?.current ? { title: session.current.title, provider: session.current.provider } : null;
}

export const useWatchStore = create<WatchState>((set, get) => ({
  sessions: new Map(),
  presence: new Map(),
  reactions: [],
  slot: null,
  videoHiddenFor: null,

  setSlot: (slot) => set({ slot }),
  setVideoHidden: (channelId, hidden) => set({ videoHiddenFor: hidden ? channelId : get().videoHiddenFor === channelId ? null : get().videoHiddenFor }),

  applyState: (channelId, received, serverNow) => {
    if (received !== null && !isWatchSession(received)) return;
    const session = received as WatchSession | null;
    const sessions = new Map(get().sessions);
    if (session) sessions.set(channelId, { session, offsetMs: clockOffset(serverNow) });
    else sessions.delete(channelId);
    set({ sessions, presence: withPresence(get().presence, channelId, presenceOf(session)) });
  },

  applyPosition: (channelId, position, serverNow) => {
    const entry = get().sessions.get(channelId);
    if (!entry || entry.session.current?.id !== position.itemId) return;
    const sessions = new Map(get().sessions);
    sessions.set(channelId, {
      session: { ...entry.session, playing: position.playing, positionMs: position.positionMs, stateAt: position.stateAt },
      offsetMs: clockOffset(serverNow),
    });
    set({ sessions });
  },

  applyPresence: (channelId, presence) => set({ presence: withPresence(get().presence, channelId, presence) }),

  applyPresenceSnapshot: (covers, watching) => {
    const presence = new Map([...get().presence].filter(([channelId]) => !covers(channelId)));
    // An entry for a channel the snapshot does not cover is not its sender's to state.
    for (const [channelId, entry] of Object.entries(watching ?? {})) if (covers(channelId)) presence.set(channelId, entry);
    set({ presence });
  },

  addReaction: (channelId, reaction) => {
    const id = nextReactionId++;
    set({ reactions: [...get().reactions, { id, channelId, reaction }].slice(-MAX_FLYING) });
    setTimeout(() => get().dropReaction(id), REACTION_FLIGHT_MS);
  },

  dropReaction: (id) => set({ reactions: get().reactions.filter((entry) => entry.id !== id) }),

  forgetCall: (channelId) => {
    if (!get().sessions.has(channelId)) return;
    const sessions = new Map(get().sessions);
    sessions.delete(channelId);
    set({ sessions, reactions: get().reactions.filter((entry) => entry.channelId !== channelId) });
  },

  add: async (channelId, url) => {
    const answer = await getApiForOrigin(getChannelOrigin(channelId)).watch.add(channelId, url);
    takeAnswer(channelId, answer.session, answer.serverNow);
  },

  change: async (channelId, action) => {
    const answer = await getApiForOrigin(getChannelOrigin(channelId)).watch.change(channelId, action);
    takeAnswer(channelId, answer.session, answer.serverNow);
  },

  end: async (channelId) => {
    const answer = await getApiForOrigin(getChannelOrigin(channelId)).watch.end(channelId);
    takeAnswer(channelId, answer.session, answer.serverNow);
  },

  react: async (channelId, reaction) => {
    await getApiForOrigin(getChannelOrigin(channelId)).watch.react(channelId, reaction);
  },
}));

/**
 * What a request answered, taken as the socket's word is: as the call's session only while this
 * client is still in that call (the answer may land after it left), else as what the channel list
 * shows.
 */
function takeAnswer(channelId: string, session: unknown, serverNow: number): void {
  if (session !== null && !isWatchSession(session)) return;
  const inCall = useVoiceStore.getState().currentVoiceChannelId === channelId;
  if (inCall) useWatchStore.getState().applyState(channelId, session, serverNow);
  else useWatchStore.getState().applyPresence(channelId, presenceOf(session as WatchSession | null));
}

/**
 * Whether the video of the call on `channelId` plays outside the call's view, which then has no
 * place for it: it floats where the call's own floating window would (which steps aside for it),
 * or plays on unseen where there is none.
 */
export function videoOutsideStage(state: Pick<WatchState, 'sessions' | 'slot' | 'videoHiddenFor'>, channelId: string | null): boolean {
  return channelId !== null && state.slot === null && state.videoHiddenFor !== channelId && state.sessions.get(channelId)?.session.current != null;
}

/**
 * Whether `channelId` is one of the channels of `spaceId` on `origin`, as the space store knows
 * them: two instances' spaces may share an id, and each instance speaks for its own only.
 */
export function channelOfSpace(spaceId: string, origin: string): (channelId: string) => boolean {
  const map = useSpaceStore.getState().channelToSpaceMap;
  return (channelId) => map.get(channelId) === spaceId && getChannelOrigin(channelId) === origin;
}

/** Whether `channelId` lives on `origin`. */
export function channelOfOrigin(origin: string): (channelId: string) => boolean {
  return (channelId) => getChannelOrigin(channelId) === origin;
}
