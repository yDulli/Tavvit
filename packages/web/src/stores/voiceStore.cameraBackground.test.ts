import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVoiceStore } from './voiceStore';

// AudioManager loads an AudioWorklet module that jsdom cannot evaluate.
vi.mock('../audio/AudioManager', () => ({
  AudioManager: { getInstance: () => ({}) },
}));

const STORAGE_KEY = 'backspace-voice-settings';

afterEach(() => {
  localStorage.removeItem(STORAGE_KEY);
  useVoiceStore.setState(useVoiceStore.getInitialState(), true);
});

function stored(): Record<string, unknown> {
  const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as { state?: Record<string, unknown> };
  return parsed.state ?? {};
}

describe('the camera background in the voice settings', () => {
  it('is the room as it is until chosen', () => {
    expect(useVoiceStore.getInitialState().cameraBackground).toEqual({ kind: 'none' });
  });

  it('is kept on this device once chosen', () => {
    useVoiceStore.getState().setCameraBackground({ kind: 'scene', scene: 'library' });
    expect(stored().cameraBackground).toEqual({ kind: 'scene', scene: 'library' });
  });

  it('comes back as it was kept', async () => {
    const version = useVoiceStore.persist.getOptions().version;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { cameraBackground: { kind: 'blur', strength: 'light' } }, version }));
    await useVoiceStore.persist.rehydrate();
    expect(useVoiceStore.getState().cameraBackground).toEqual({ kind: 'blur', strength: 'light' });
  });

  it('is the room as it is when what was kept is not a background the app knows', async () => {
    const version = useVoiceStore.persist.getOptions().version;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { cameraBackground: { kind: 'scene', scene: 'moon' } }, version }));
    await useVoiceStore.persist.rehydrate();
    expect(useVoiceStore.getState().cameraBackground).toEqual({ kind: 'none' });
  });

  it('takes no shape it does not know from a caller either', () => {
    // @ts-expect-error — what a careless caller might hand over
    useVoiceStore.getState().setCameraBackground({ kind: 'blur', strength: 'huge' });
    expect(useVoiceStore.getState().cameraBackground).toEqual({ kind: 'none' });
  });
});
