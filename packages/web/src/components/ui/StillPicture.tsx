import { useEffect, useRef } from 'react';

/**
 * Pictures of people and spaces that may move (an animated GIF or WebP) stand on their first frame
 * wherever their decorations stand still, and move where those move (`Avatar`'s `pictureMotion`):
 * an <img> of an animated picture keeps decoding and painting frames for as long as it is on
 * screen, and a member list or a channel shows dozens of them.
 */

/** A picture that may move: a GIF, or a WebP, which can. Any other is drawn as it is. */
const MAY_MOVE = /\.(gif|webp)(?:[?#]|$)/i;

export function mayMove(address: string): boolean {
  return MAY_MOVE.test(address) || address.startsWith('data:image/gif') || address.startsWith('data:image/webp');
}

/**
 * Whether this browser can take a picture's first frame (`HTMLImageElement.decode` and
 * `createImageBitmap`); where it cannot, the picture is shown as it is, moving.
 */
export function stillsSupported(): boolean {
  return typeof window !== 'undefined'
    && typeof window.createImageBitmap === 'function'
    && typeof HTMLImageElement !== 'undefined'
    && typeof HTMLImageElement.prototype.decode === 'function';
}

/**
 * First frames already taken, by address: one person's picture stands beside every message they
 * wrote. An image decoded outside the page does not animate, so what it holds is its first frame.
 * Bounded, as addresses come and go with the people on screen.
 */
const firstFrames = new Map<string, Promise<ImageBitmap>>();
const FRAMES_KEPT = 300;

function firstFrameOf(address: string): Promise<ImageBitmap> {
  const known = firstFrames.get(address);
  if (known) return known;
  const image = new Image();
  image.decoding = 'async';
  image.src = address;
  const frame = image.decode().then(() => createImageBitmap(image));
  frame.catch(() => {
    if (firstFrames.get(address) === frame) firstFrames.delete(address);
  });
  if (firstFrames.size >= FRAMES_KEPT) firstFrames.clear();
  firstFrames.set(address, frame);
  return frame;
}

/**
 * A picture's first frame on a canvas the picture's size, cut to a square from its middle as
 * `object-fit: cover` would. `onFail` is told when the picture cannot be read, so the initials can
 * stand in, as they do for an <img> that fails.
 */
export function StillPicture({ address, pixels, radius, onFail }: { address: string; pixels: number; radius: string | number; onFail: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const failRef = useRef(onFail);
  failRef.current = onFail;

  useEffect(() => {
    let cancelled = false;
    firstFrameOf(address).then((bitmap) => {
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      const side = Math.max(1, Math.round(pixels * (window.devicePixelRatio || 1)));
      canvas.width = side;
      canvas.height = side;
      const context = canvas.getContext('2d');
      if (!context) return;
      const crop = Math.min(bitmap.width, bitmap.height);
      context.drawImage(bitmap, (bitmap.width - crop) / 2, (bitmap.height - crop) / 2, crop, crop, 0, 0, side, side);
    }, () => {
      if (!cancelled) failRef.current();
    });
    return () => {
      cancelled = true;
    };
  }, [address, pixels]);

  return <canvas ref={canvasRef} aria-hidden="true" className="avatar-still block h-full w-full" style={{ borderRadius: radius }} />;
}
