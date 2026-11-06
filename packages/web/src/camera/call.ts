import { LocalVideoTrack, Track, type Room, type TrackPublishOptions, type VideoCaptureOptions } from 'livekit-client';
import { useVoiceStore } from '../stores/voiceStore';
import { isActiveBackground, type ActiveBackground } from './backgrounds';
import { loadBackgroundProcessor, resolveBackground } from './index';
import { cameraBackgroundsSupported } from './support';

/**
 * The camera in a call with a background (docs/systems/voice.md, "Camera
 * backgrounds"). The rule everything here keeps: once a background is chosen,
 * no frame of the room leaves without it. A background that cannot be laid
 * over the picture turns the camera off rather than showing the room.
 */

/** The background the camera should have now; null for the room as it is, or where the browser cannot. */
function wantedBackground(): ActiveBackground | null {
  const chosen = useVoiceStore.getState().cameraBackground;
  return isActiveBackground(chosen) && cameraBackgroundsSupported() ? chosen : null;
}

function cameraTrackOf(room: Room): LocalVideoTrack | null {
  const track = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
  return track instanceof LocalVideoTrack ? track : null;
}

export interface CameraOn {
  /** The person's own picture was gone, so the room is blurred instead (`resolveBackground`). */
  substituted: boolean;
}

/**
 * Turns the camera on. Without a background this is LiveKit's own path: a
 * camera turned off earlier in the call comes back (LiveKit keeps it muted),
 * or a new one is published.
 *
 * With a background the camera is always new: the track is made, given its
 * processor, and only then published, so the first frame that leaves already
 * has the background, and a failure leaves nothing running. A camera kept
 * from earlier in the call is let go first. If the processor cannot start,
 * the camera is stopped and `CameraBackgroundFailed` is thrown.
 */
export async function turnCameraOn(room: Room, capture: VideoCaptureOptions, publish: TrackPublishOptions): Promise<CameraOn> {
  const wanted = wantedBackground();
  const kept = cameraTrackOf(room);

  if (!wanted) {
    // A camera kept with a background would come back with it.
    if (kept?.getProcessor()) await room.localParticipant.unpublishTrack(kept, true);
    await room.localParticipant.setCameraEnabled(true, capture, publish);
    return { substituted: false };
  }

  const processors = await loadBackgroundProcessor();
  const { background, image, substituted } = await resolveBackground(wanted);
  if (kept) await room.localParticipant.unpublishTrack(kept, true);

  const tracks = await room.localParticipant.createTracks({ video: capture });
  const camera = tracks.find((track): track is LocalVideoTrack => track instanceof LocalVideoTrack);
  for (const other of tracks) if (other !== camera) other.stop();
  if (!camera) throw new Error('the camera gave no video track');
  try {
    await processors.startBackgroundProcessor(background, image, (processor) => camera.setProcessor(processor));
    await room.localParticipant.publishTrack(camera, { ...publish, source: Track.Source.Camera });
  } catch (error) {
    // Stops the camera and the processor with it.
    camera.stop();
    throw error;
  }
  return { substituted };
}

export type BackgroundChange =
  /** Nothing to do: the camera is off, or already shows what is chosen. */
  | { kind: 'unchanged' }
  | { kind: 'applied'; substituted: boolean }
  /** The background could not start; the camera was turned off (see `applyBackgroundInCall`). */
  | { kind: 'failed'; error: unknown };

/**
 * Brings the live camera in line with the chosen background, after the
 * person changed it in the settings during a call. Changing from one
 * background to another happens in place; turning one off lets the room be
 * seen again, as asked.
 *
 * Turning one on while the camera is live sends the room until the processor
 * stands (as it did a moment ago); if it cannot start, `failed` is returned and
 * the caller turns the camera off, since the person just asked for the room
 * to be hidden. A camera that is off is left alone: `turnCameraOn` sets it up.
 */
export async function applyBackgroundInCall(room: Room): Promise<BackgroundChange> {
  const publication = room.localParticipant.getTrackPublication(Track.Source.Camera);
  const camera = cameraTrackOf(room);
  if (!camera || !publication || publication.isMuted || !useVoiceStore.getState().isCameraOn) return { kind: 'unchanged' };

  const current = camera.getProcessor();
  const wanted = wantedBackground();
  if (!wanted) {
    if (!current) return { kind: 'unchanged' };
    await camera.stopProcessor();
    return { kind: 'applied', substituted: false };
  }

  const processors = await loadBackgroundProcessor();
  const { background, image, substituted } = await resolveBackground(wanted);
  if (processors.isCameraBackgroundProcessor(current)) {
    await current.show(background, image);
    return { kind: 'applied', substituted };
  }
  try {
    if (current) await camera.stopProcessor();
    await processors.startBackgroundProcessor(background, image, (processor) => camera.setProcessor(processor));
    return { kind: 'applied', substituted };
  } catch (error) {
    return { kind: 'failed', error };
  }
}
