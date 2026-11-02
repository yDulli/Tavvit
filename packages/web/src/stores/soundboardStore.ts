import { create } from 'zustand';
import type { SpaceSound } from '@backspace/shared/src/soundboard';
import { AudioManager } from '../audio/AudioManager';
import { getApiForOrigin, getChannelOrigin } from './spaceStore';
import { useVoiceStore } from './voiceStore';

const spaceKey = (origin: string, spaceId: string): string => `${origin}|${spaceId}`;

/** Decoded clips, so a second play starts at once. A clip's bytes do not change: a new file is a new id. */
const clips = new Map<string, AudioBuffer>();

async function clipFor(origin: string, soundId: string): Promise<AudioBuffer | null> {
  const known = clips.get(soundId);
  if (known) return known;
  const bytes = await (await getApiForOrigin(origin).sounds.audio(soundId)).arrayBuffer();
  const decoded = await AudioManager.getInstance().decodeClip(bytes);
  if (decoded) clips.set(soundId, decoded);
  return decoded;
}

interface SoundboardState {
  bySpace: ReadonlyMap<string, readonly SpaceSound[]>;
  load: (origin: string, spaceId: string) => Promise<readonly SpaceSound[]>;
  /** Asks to play it in this call; everyone there hears through `hear`. */
  play: (channelId: string, soundId: string) => Promise<void>;
  /** Someone in the call played one. The listener's own switch and volume decide. */
  hear: (origin: string, channelId: string, soundId: string) => Promise<void>;
}

export const useSoundboardStore = create<SoundboardState>((set, get) => ({
  bySpace: new Map(),

  load: async (origin, spaceId) => {
    const { sounds } = await getApiForOrigin(origin).sounds.list(spaceId);
    const next = new Map(get().bySpace);
    next.set(spaceKey(origin, spaceId), sounds);
    set({ bySpace: next });
    return sounds;
  },

  play: async (channelId, soundId) => {
    await getApiForOrigin(getChannelOrigin(channelId)).sounds.play(channelId, soundId);
  },

  hear: async (origin, channelId, soundId) => {
    const voice = useVoiceStore.getState();
    if (!voice.soundboardEnabled || voice.currentVoiceChannelId !== channelId || voice.isDeafened) return;
    try {
      const clip = await clipFor(origin, soundId);
      if (clip) await AudioManager.getInstance().playClip(clip, voice.soundboardVolume / 100);
    } catch (err) {
      console.warn('[soundboard] Could not play a clip:', err);
    }
  },
}));

export function useSpaceSounds(origin: string, spaceId: string | null | undefined): readonly SpaceSound[] | undefined {
  return useSoundboardStore((state) => (spaceId ? state.bySpace.get(spaceKey(origin, spaceId)) : undefined));
}
