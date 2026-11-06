import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalAudioTrack, LocalVideoTrack, Track, type Room } from 'livekit-client';

// AudioManager loads an AudioWorklet module that jsdom cannot evaluate.
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));

const support = vi.hoisted(() => ({ supported: true }));
vi.mock('./support', () => ({ cameraBackgroundsSupported: () => support.supported }));

/** The processor module as the call code sees it: a processor is "ours" when it says so. */
const processors = vi.hoisted(() => ({
  startBackgroundProcessor: vi.fn(),
  isCameraBackgroundProcessor: (value: unknown) => typeof value === 'object' && value !== null && (value as { ours?: boolean }).ours === true,
}));
const resolved = vi.hoisted(() => ({ value: { background: { kind: 'blur', strength: 'strong' }, image: null as string | null, substituted: false } }));
vi.mock('./index', () => ({
  loadBackgroundProcessor: async () => processors,
  resolveBackground: async () => resolved.value,
}));

import { useVoiceStore } from '../stores/voiceStore';
import { applyBackgroundInCall, turnCameraOn } from './call';

interface FakeCamera {
  getProcessor: ReturnType<typeof vi.fn>;
  setProcessor: ReturnType<typeof vi.fn>;
  stopProcessor: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

/** A camera track the code takes for LiveKit's own: its methods are spies. */
function camera(processor?: unknown): LocalVideoTrack & FakeCamera {
  return Object.assign(Object.create(LocalVideoTrack.prototype) as LocalVideoTrack, {
    getProcessor: vi.fn(() => processor),
    setProcessor: vi.fn(async () => undefined),
    stopProcessor: vi.fn(async () => undefined),
    stop: vi.fn(),
  }) as LocalVideoTrack & FakeCamera;
}

function room(kept: { track: LocalVideoTrack; isMuted: boolean } | null, made: unknown[] = []) {
  const localParticipant = {
    getTrackPublication: vi.fn((source: Track.Source) => (source === Track.Source.Camera && kept ? kept : undefined)),
    setCameraEnabled: vi.fn(async () => undefined),
    unpublishTrack: vi.fn(async () => undefined),
    createTracks: vi.fn(async () => made),
    publishTrack: vi.fn(async () => undefined),
  };
  return { room: { localParticipant } as unknown as Room, localParticipant };
}

const capture = { resolution: { width: 1280, height: 720 }, frameRate: 30 };
const publish = { simulcast: true };

beforeEach(() => {
  support.supported = true;
  resolved.value = { background: { kind: 'blur', strength: 'strong' }, image: null, substituted: false };
  processors.startBackgroundProcessor.mockReset();
  processors.startBackgroundProcessor.mockImplementation(async (_background: unknown, _image: unknown, start: (p: unknown) => Promise<void>) => {
    const made = { ours: true };
    await start(made);
    return made;
  });
  useVoiceStore.setState({ cameraBackground: { kind: 'none' }, isCameraOn: false });
});

describe('turning the camera on', () => {
  it('is LiveKit\'s own way with the room as it is', async () => {
    const { room: r, localParticipant } = room(null);
    await expect(turnCameraOn(r, capture, publish)).resolves.toEqual({ substituted: false });
    expect(localParticipant.setCameraEnabled).toHaveBeenCalledWith(true, capture, publish);
    expect(localParticipant.createTracks).not.toHaveBeenCalled();
  });

  it('lets go of a camera kept with a background before the room is shown again', async () => {
    const kept = camera({ ours: true });
    const { room: r, localParticipant } = room({ track: kept, isMuted: true });
    await turnCameraOn(r, capture, publish);
    expect(localParticipant.unpublishTrack).toHaveBeenCalledWith(kept, true);
    expect(localParticipant.setCameraEnabled).toHaveBeenCalledWith(true, capture, publish);
  });

  it('with a background makes the track, gives it the processor, and only then publishes it', async () => {
    useVoiceStore.setState({ cameraBackground: { kind: 'blur', strength: 'strong' } });
    const kept = camera();
    const fresh = camera();
    const { room: r, localParticipant } = room({ track: kept, isMuted: true }, [fresh]);

    await expect(turnCameraOn(r, capture, publish)).resolves.toEqual({ substituted: false });

    expect(localParticipant.unpublishTrack).toHaveBeenCalledWith(kept, true);
    expect(localParticipant.createTracks).toHaveBeenCalledWith({ video: capture });
    expect(fresh.setProcessor).toHaveBeenCalledWith({ ours: true });
    expect(localParticipant.publishTrack).toHaveBeenCalledWith(fresh, { ...publish, source: Track.Source.Camera });
    expect(fresh.setProcessor.mock.invocationCallOrder[0]!).toBeLessThan(localParticipant.publishTrack.mock.invocationCallOrder[0]!);
    expect(localParticipant.setCameraEnabled).not.toHaveBeenCalled();
  });

  it('stops the camera and publishes nothing when the background cannot start', async () => {
    useVoiceStore.setState({ cameraBackground: { kind: 'scene', scene: 'tavern' } });
    processors.startBackgroundProcessor.mockRejectedValue(new Error('no webgl'));
    const fresh = camera();
    const { room: r, localParticipant } = room(null, [fresh]);

    await expect(turnCameraOn(r, capture, publish)).rejects.toThrow('no webgl');
    expect(fresh.stop).toHaveBeenCalled();
    expect(localParticipant.publishTrack).not.toHaveBeenCalled();
  });

  it('stops any track it did not ask for', async () => {
    useVoiceStore.setState({ cameraBackground: { kind: 'blur', strength: 'light' } });
    const fresh = camera();
    const stray = Object.assign(Object.create(LocalAudioTrack.prototype) as LocalAudioTrack, { stop: vi.fn() });
    const { room: r } = room(null, [stray, fresh]);
    await turnCameraOn(r, capture, publish);
    expect(stray.stop).toHaveBeenCalled();
    expect(fresh.stop).not.toHaveBeenCalled();
  });

  it('says when the person\'s own picture was gone and the room is blurred instead', async () => {
    useVoiceStore.setState({ cameraBackground: { kind: 'own' } });
    resolved.value = { background: { kind: 'blur', strength: 'strong' }, image: null, substituted: true };
    const { room: r } = room(null, [camera()]);
    await expect(turnCameraOn(r, capture, publish)).resolves.toEqual({ substituted: true });
  });

  it('takes the room as it is where the browser cannot lay a background', async () => {
    support.supported = false;
    useVoiceStore.setState({ cameraBackground: { kind: 'blur', strength: 'light' } });
    const { room: r, localParticipant } = room(null);
    await turnCameraOn(r, capture, publish);
    expect(localParticipant.setCameraEnabled).toHaveBeenCalled();
    expect(processors.startBackgroundProcessor).not.toHaveBeenCalled();
  });
});

describe('changing the background in a call', () => {
  it('leaves a camera that is off alone', async () => {
    useVoiceStore.setState({ cameraBackground: { kind: 'blur', strength: 'light' }, isCameraOn: false });
    const live = camera();
    const { room: r } = room({ track: live, isMuted: true });
    await expect(applyBackgroundInCall(r)).resolves.toEqual({ kind: 'unchanged' });
    expect(live.setProcessor).not.toHaveBeenCalled();
  });

  it('changes a background in place', async () => {
    useVoiceStore.setState({ cameraBackground: { kind: 'scene', scene: 'library' }, isCameraOn: true });
    resolved.value = { background: { kind: 'scene', scene: 'library' } as never, image: '/library.jpg', substituted: false };
    const show = vi.fn(async () => undefined);
    const live = camera({ ours: true, show });
    const { room: r } = room({ track: live, isMuted: false });
    await expect(applyBackgroundInCall(r)).resolves.toEqual({ kind: 'applied', substituted: false });
    expect(show).toHaveBeenCalledWith({ kind: 'scene', scene: 'library' }, '/library.jpg');
    expect(live.setProcessor).not.toHaveBeenCalled();
  });

  it('shows the room again when the background is turned off', async () => {
    useVoiceStore.setState({ cameraBackground: { kind: 'none' }, isCameraOn: true });
    const live = camera({ ours: true });
    const { room: r } = room({ track: live, isMuted: false });
    await expect(applyBackgroundInCall(r)).resolves.toEqual({ kind: 'applied', substituted: false });
    expect(live.stopProcessor).toHaveBeenCalled();
  });

  it('lays a first background over a live camera, and reports when it cannot', async () => {
    useVoiceStore.setState({ cameraBackground: { kind: 'blur', strength: 'strong' }, isCameraOn: true });
    const live = camera();
    const { room: r } = room({ track: live, isMuted: false });
    await expect(applyBackgroundInCall(r)).resolves.toEqual({ kind: 'applied', substituted: false });
    expect(live.setProcessor).toHaveBeenCalledWith({ ours: true });

    processors.startBackgroundProcessor.mockRejectedValue(new Error('no webgl'));
    const failed = await applyBackgroundInCall(room({ track: camera(), isMuted: false }).room);
    expect(failed.kind).toBe('failed');
  });
});
