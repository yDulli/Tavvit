import React from 'react';
import type { User } from '@backspace/shared';
import type { AvatarFrame } from '@backspace/shared/src/decorations';
import { decorationColors } from '../../utils/decorations';
import { getAvatarGradient, getSpaceGradient } from '../../utils/gradients';
import { FRAME_LAYERS, FRAME_VIEW, frameArt, type FrameLayer } from './decorationArt';
import { useGatedPicture } from './ExternalMedia';

interface AvatarProps {
  src?: string | null;
  name: string;
  size?: number;
  status?: 'online' | 'idle' | 'dnd' | 'offline' | null;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  user?: User;
  userId?: string;
  ring?: { width: number; color: string };
  avatarColor?: string | null;
  /**
   * Which gradient family the initials fallback is painted from. A space's
   * icon is `space`, so it matches the space sidebar and every other space
   * icon (`getSpaceGradient`); people use `user`, the default.
   */
  palette?: 'user' | 'space';
  /**
   * The person's frame (docs/systems/decorations.md): a drawing around the
   * picture (headphones, ears, a crown, a wreath), partly behind it and partly
   * in front, drawn over the space around it without taking any.
   */
  frame?: AvatarFrame | null;
  /**
   * When the frame moves: `on` always (a profile, the picker), `hover` while the
   * row or card around it (`.deco-hover`) is pointed at (a list, a message),
   * `off` never.
   */
  frameMotion?: DecorationMotion;
}

/** When a decoration moves (`styles/decorations.css`, "Where they move"). */
export type DecorationMotion = 'on' | 'hover' | 'off';

/**
 * One layer of a frame's drawing (`decorationArt.tsx`): a view a fifth larger
 * than the avatar on every side, `back` under the picture (the avatar is its own
 * stacking context, so it stays above whatever the avatar sits on) and `front`
 * over it. It shares the status dot's cutout, so the dot is never covered, and
 * carries the person's colours for a design drawn in them.
 */
function FrameArt({ frame, layer, size, outerSize, ringWidth, status, motion, colors }: {
  frame: AvatarFrame;
  layer: FrameLayer;
  size: number;
  outerSize: number;
  ringWidth: number;
  status: AvatarProps['status'];
  motion: DecorationMotion;
  colors: { a: string; b: string };
}) {
  let mask: string | undefined;
  if (status) {
    const { dot, gap, inset } = getDotMetrics(size, ringWidth);
    const centre = outerSize - inset + outerSize * 0.2;
    const hole = dot / 2 + gap;
    mask = `radial-gradient(circle at ${centre}px ${centre}px, transparent ${hole}px, black ${hole + 0.5}px)`;
  }
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="deco-art"
      data-frame={frame}
      data-layer={layer}
      data-motion={motion}
      viewBox={FRAME_VIEW}
      style={{ '--deco-a': colors.a, '--deco-b': colors.b, ...(mask ? { maskImage: mask, WebkitMaskImage: mask } : {}) } as React.CSSProperties}
    >
      {frameArt(frame, layer)}
    </svg>
  );
}

/**
 * How round an avatar's corner is: a share of its size, so a 24px chip, a 40px
 * message avatar and a 96px profile picture are all the same shape. The share
 * is the person's own setting (Settings, Appearance: squircle, circle or
 * square, `--avatar-roundness` on <html>); a squircle is the default. Group
 * avatars (`AvatarStack`) use it too.
 */
export function avatarRadius(size: number): string {
  return `calc(${size}px * var(--avatar-roundness, 0.3))`;
}

/**
 * Each presence state has its own shape as well as its own colour, so it
 * reads without colour: a full disc for online, a crescent for idle, a disc
 * with a bar through it for do not disturb, a ring for offline. Drawn on a
 * 10 by 10 grid and filled even-odd, so the cut parts show the cutout behind.
 */
const STATUS_GLYPHS: Record<string, { path: string; color: string }> = {
  online: { path: 'M5 0a5 5 0 1 1 0 10A5 5 0 0 1 5 0Z', color: 'text-status-online' },
  // The outer circle around the bottom right, back along a circle of radius 3.4 centred at (2.6, 2.6).
  idle: { path: 'M4.8 0A5 5 0 1 1 0 4.8A3.4 3.4 0 1 0 4.8 0Z', color: 'text-status-idle' },
  dnd: { path: 'M5 0a5 5 0 1 1 0 10A5 5 0 0 1 5 0ZM2.3 4.1h5.4v1.8H2.3Z', color: 'text-status-dnd' },
  offline: { path: 'M5 0a5 5 0 1 1 0 10A5 5 0 0 1 5 0ZM5 2.7a2.3 2.3 0 1 0 0 4.6a2.3 2.3 0 1 0 0-4.6Z', color: 'text-status-offline' },
};

/**
 * Builds a CSS radial-gradient mask that punches a circular hole in the avatar
 * where the status dot sits. The hole reveals the parent background, creating
 * a true cutout effect on any surface — no border-color matching needed.
 *
 * Prototype reference (.m-dot): 12px box with 3px border (border-box) = 6px
 * visible color, positioned at bottom:-2 right:-2 → center 4px from corner.
 */
function buildCutoutMask(avatarSize: number, ringWidth: number = 0): string {
  const outerSize = avatarSize + ringWidth * 2;
  const { dot, gap, inset } = getDotMetrics(avatarSize, ringWidth);
  const cx = outerSize - inset;
  const cy = outerSize - inset;
  const r = dot / 2 + gap;
  return `radial-gradient(circle at ${cx}px ${cy}px, transparent ${r}px, black ${r + 0.5}px)`;
}

/** Returns visible dot diameter, gap width, and center inset from outer edge. */
function getDotMetrics(avatarSize: number, ringWidth: number = 0) {
  let dot: number, gap: number, avatarInset: number;
  if (avatarSize <= 24) {
    dot = 5; gap = 2; avatarInset = 3;
  } else if (avatarSize <= 48) {
    dot = 6; gap = 3; avatarInset = 4;
  } else {
    dot = Math.round(avatarSize * 0.15);
    gap = Math.round(avatarSize * 0.05);
    avatarInset = Math.round(avatarSize * 0.10);
  }
  return { dot, gap, inset: avatarInset + ringWidth };
}

export function Avatar({ src, name, size = 40, status, className = '', onClick, user, userId, ring, avatarColor, palette = 'user', frame = null, frameMotion = 'off' }: AvatarProps) {
  const initials = name.charAt(0).toUpperCase();
  const address = src
    ? ((src.startsWith('http') || src.startsWith('blob:') || src.startsWith('data:') || src.startsWith('/')) ? src : `/api/uploads/${src}`)
    : null;
  // A picture on a server this client does not talk to waits for a yes like anything else from
  // there (docs/systems/legal.md): the initials stand in, and that server learns nothing. What the
  // server lets through is checked there too (utils/remoteMedia.ts); this holds wherever it is not.
  const shown = useGatedPicture(address);
  const fontPx = Math.round(size * 0.4);
  const gradient = palette === 'space'
    ? getSpaceGradient(userId, name, avatarColor)
    : getAvatarGradient(userId ?? user?.homeUserId ?? user?.id, name, avatarColor ?? user?.avatarColor);

  const ringWidth = ring?.width ?? 0;
  const outerSize = size + ringWidth * 2;
  const radius = avatarRadius(outerSize);
  const innerRadius = avatarRadius(size);

  // Only compute mask when status dot is visible
  const cutoutMask = status ? buildCutoutMask(size, ringWidth) : undefined;
  const maskStyle: React.CSSProperties | undefined = cutoutMask
    ? { maskImage: cutoutMask, WebkitMaskImage: cutoutMask }
    : undefined;

  const { dot: dotDiameter, inset: dotInset } = getDotMetrics(size, ringWidth);
  // A frame's drawing has a layer behind the picture, one over it, or both.
  const frameColors = frame ? decorationColors({ accentColor: user?.accentColor, accentColorSecondary: user?.accentColorSecondary }, gradient) : null;
  const artLayer = (layer: FrameLayer) => frame && frameColors && FRAME_LAYERS[frame].includes(layer) && (
    <FrameArt frame={frame} layer={layer} size={size} outerSize={outerSize} ringWidth={ringWidth} status={status} motion={frameMotion} colors={frameColors} />
  );

  return (
    <div
      data-avatar
      className={`relative inline-flex flex-shrink-0 ${frame ? 'isolate' : ''} ${onClick ? 'cursor-pointer' : ''} ${className}`}
      style={{ width: outerSize, height: outerSize }}
      onClick={onClick}
    >
      {artLayer('back')}
      {/* Inner masked square — ring background + avatar content */}
      <div
        className="w-full h-full"
        style={{
          borderRadius: radius,
          padding: ringWidth,
          backgroundColor: ring?.color,
          ...maskStyle,
        }}
      >
        {shown ? (
          <img
            src={shown}
            alt={name}
            loading="lazy"
            className="w-full h-full object-cover"
            style={{ borderRadius: innerRadius }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
              const parent = (e.target as HTMLImageElement).parentElement;
              if (parent) {
                const fallback = parent.querySelector('.avatar-fallback') as HTMLElement;
                if (fallback) fallback.style.display = 'flex';
              }
            }}
          />
        ) : null}
        <div
          className={`avatar-fallback w-full h-full flex items-center justify-center font-semibold text-white ${shown ? 'hidden' : 'flex'}`}
          style={{ background: gradient.gradient, fontSize: fontPx, borderRadius: innerRadius, ...(shown ? { display: 'none' } : {}) }}
        >
          {initials}
        </div>
      </div>
      {artLayer('front')}
      {/* Status dot — outside the masked div so it isn't clipped */}
      {status && (
        <svg
          viewBox="0 0 10 10"
          aria-hidden="true"
          data-status={STATUS_GLYPHS[status] ? status : 'offline'}
          className={`absolute ${(STATUS_GLYPHS[status] ?? STATUS_GLYPHS.offline!).color}`}
          style={{
            width: dotDiameter,
            height: dotDiameter,
            bottom: dotInset - dotDiameter / 2,
            right: dotInset - dotDiameter / 2,
          }}
        >
          <path d={(STATUS_GLYPHS[status] ?? STATUS_GLYPHS.offline!).path} fill="currentColor" fillRule="evenodd" />
        </svg>
      )}
    </div>
  );
}
