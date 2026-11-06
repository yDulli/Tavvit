/**
 * Whether this browser can lay a background behind the camera picture. The
 * picker is not shown where it cannot (docs/systems/voice.md, "Camera
 * backgrounds").
 *
 * The checks are those of `supportsBackgroundProcessors()` in
 * `@livekit/track-processors` (OffscreenCanvas, VideoFrame, createImageBitmap,
 * WebGL 2, and either MediaStreamTrackProcessor or a canvas's captureStream),
 * made here so deciding does not load the effects' code, plus WebAssembly
 * SIMD: the app serves only MediaPipe's SIMD build (`src/build/visionAssets.mjs`).
 */

/**
 * The smallest module that uses a SIMD instruction; a browser without SIMD
 * refuses it. The same bytes MediaPipe tests with.
 */
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

function hasWebAssemblySimd(): boolean {
  try {
    return typeof WebAssembly === 'object' && WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}

function hasWebGl2(): boolean {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) return false;
  // Give the context back at once: a page may hold only a few at a time.
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return true;
}

function hasFrameApis(): boolean {
  if (typeof OffscreenCanvas === 'undefined' || typeof VideoFrame === 'undefined' || typeof createImageBitmap === 'undefined') return false;
  const streams = 'MediaStreamTrackProcessor' in globalThis && 'MediaStreamTrackGenerator' in globalThis;
  const canvasCapture = typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype;
  return streams || canvasCapture;
}

let known: boolean | null = null;

export function cameraBackgroundsSupported(): boolean {
  if (known === null) {
    try {
      known = typeof document !== 'undefined' && hasWebAssemblySimd() && hasFrameApis() && hasWebGl2();
    } catch {
      known = false;
    }
  }
  return known;
}

/** Tests only: forget the answer, so a test can stage another browser. */
export function resetCameraBackgroundSupportForTests(): void {
  known = null;
}
