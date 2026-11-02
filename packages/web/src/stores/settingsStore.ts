import { create } from 'zustand';
import type { InstanceStreamingLimits, InstanceAdminSettings } from '@backspace/shared';
import { api } from '../api/client';
import { getApiForOrigin } from '../utils/crossStoreResolvers';

interface SettingsState {
  /** Home's streaming document. Also carries home's discovery flags. */
  streamingLimits: InstanceStreamingLimits | null;
  /**
   * Streaming documents of other instances, keyed by origin. A voice channel in
   * a federated space streams through that instance's LiveKit, so its limits
   * are the ones a screen share there obeys. Filled by
   * `fetchStreamingLimitsFor` when a voice connection to that origin starts.
   */
  streamingLimitsByOrigin: Record<string, InstanceStreamingLimits>;
  instanceSettings: InstanceAdminSettings | null;
  isAdmin: boolean;
  gifEnabled: boolean;
  fetchStreamingLimits: () => Promise<void>;
  /** Fetch a remote instance's streaming document; `''` is a no-op (home has its own field). */
  fetchStreamingLimitsFor: (origin: string) => Promise<void>;
  updateStreamingLimits: (limits: Partial<InstanceStreamingLimits>) => Promise<void>;
  fetchInstanceSettings: () => Promise<void>;
  updateInstanceSettings: (data: Partial<InstanceAdminSettings>) => Promise<void>;
  fetchGifEnabled: () => Promise<void>;
  setIsAdmin: (isAdmin: boolean) => void;
  /** Forgets the previous session's admin flag on logout (authStore.resetUserStores). */
  resetSessionState: () => void;
}

export const DEFAULT_STREAMING_LIMITS: InstanceStreamingLimits = {
  maxBitrateKbps: 20000,
  minBitrateKbps: 500,
  bitrateStepKbps: 500,
  allowedResolutions: [540, 720, 1080],
  allowedFramerates: [30, 45, 60],
  maxResolution: 1080,
  maxFramerate: 60,
  discoveryEnabled: true,
  directoryEnabled: false,
  // The screen-share path is the only reader of these defaults and never
  // asks this; false is the value that claims nothing.
  directoryConfigured: false,
  bitrateMatrixOverrides: null,
  allowCustomBitrate: true,
};

/**
 * The streaming document of the instance at `origin` (`''` = home), or null
 * while it is not known. Readers that state a fact to the user use this and
 * treat null as unknown.
 */
export function selectStreamingLimits(
  state: Pick<SettingsState, 'streamingLimits' | 'streamingLimitsByOrigin'>,
  origin: string,
): InstanceStreamingLimits | null {
  if (!origin) return state.streamingLimits;
  return state.streamingLimitsByOrigin[origin] ?? null;
}

/**
 * The limits of the instance at `origin`, with the defaults standing in while
 * its document is unknown.
 *
 * This is the one place a default may be substituted: a screen share has to
 * pick a bitrate whatever the server said. Everything that states a fact to
 * the user, or offers to change one, reads `selectStreamingLimits` and treats
 * null as unknown. An unknown remote falls back to the defaults, never to
 * home's document, which says nothing about another instance.
 */
export function getStreamingLimits(origin: string): InstanceStreamingLimits {
  return selectStreamingLimits(useSettingsStore.getState(), origin) ?? DEFAULT_STREAMING_LIMITS;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  streamingLimits: null,
  streamingLimitsByOrigin: {},
  instanceSettings: null,
  isAdmin: false,
  gifEnabled: false,

  fetchStreamingLimits: async () => {
    try {
      const limits = await api.settings.getStreaming();
      set({ streamingLimits: limits });
    } catch (err) {
      // Left null, not filled with defaults. The document carries the two
      // discovery flags, and `DEFAULT_STREAMING_LIMITS` asserts
      // `directoryEnabled: false`: substituting it told an admin on a listed
      // instance that their spaces are not listed, next to a button that
      // writes the setting. Every reader of this field already handles null,
      // and the one consumer that needs a number whatever happened (the
      // screen-share config) goes through `getStreamingLimits(origin)`, which
      // falls back at read time.
      console.warn('[Settings] Failed to fetch streaming limits:', err);
    }
  },

  fetchStreamingLimitsFor: async (origin: string) => {
    if (!origin) return;
    try {
      const limits = await getApiForOrigin(origin).settings.getStreaming();
      set((state) => ({ streamingLimitsByOrigin: { ...state.streamingLimitsByOrigin, [origin]: limits } }));
    } catch (err) {
      // A document this instance sent earlier is still its policy, so a failed
      // refresh keeps it rather than dropping to the defaults.
      console.warn(`[Settings] Failed to fetch streaming limits from ${origin}:`, err);
    }
  },

  updateStreamingLimits: async (limits: Partial<InstanceStreamingLimits>) => {
    const updated = await api.settings.updateStreaming(limits);
    set({ streamingLimits: updated });
  },

  fetchInstanceSettings: async () => {
    try {
      const settings = await api.settings.getInstance();
      set({ instanceSettings: settings });
    } catch (err) {
      console.warn('[Settings] Failed to fetch instance settings:', err);
    }
  },

  updateInstanceSettings: async (data: Partial<InstanceAdminSettings>) => {
    const updated = await api.settings.updateInstance(data);
    set({ instanceSettings: updated });
    // The space settings DiscoveryPanel reads both flags from streamingLimits,
    // the document any signed-in user may fetch. Mirror them from the server's
    // answer rather than from the request: turning discovery off clears the
    // directory server-side, and the answer is where that shows.
    set((state) => ({
      streamingLimits: state.streamingLimits
        ? {
            ...state.streamingLimits,
            discoveryEnabled: updated.discoveryEnabled,
            directoryEnabled: updated.directoryEnabled,
          }
        : state.streamingLimits,
    }));
  },

  fetchGifEnabled: async () => {
    try {
      const { enabled } = await api.gif.enabled();
      set({ gifEnabled: enabled });
    } catch {
      set({ gifEnabled: false });
    }
  },

  setIsAdmin: (isAdmin: boolean) => set({ isAdmin }),

  /**
   * `isAdmin` describes the previous user, not the instance: unlike
   * `streamingLimits` or `instanceSettings`, it must not survive a logout, or a
   * non-admin signing in on the same tab would see admin-only surfaces until
   * the next WebSocket `ready` overwrote it.
   */
  resetSessionState: () => set({ isAdmin: false }),
}));
