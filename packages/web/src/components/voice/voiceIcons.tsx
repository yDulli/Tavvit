import React from 'react';
import { ICONS } from '../ui/Icon';

/**
 * The call glyphs `ui/Icon` has no drawing for (a camera that is off, a shared
 * screen, the fullscreen corners), drawn by its rules: a 24 grid, 1.75px strokes,
 * round caps and joins, and the colour of the text. Anything `ui/Icon` already has
 * is taken from there, so a call control and a top-bar switch are the same hand.
 */

const SLASH = 'M4 4l16 16';
const WAVES = 'M4 10.5v3M8 7.5v9M12 4.5v15M16 7.5v9M20 10.5v3';
const EYE = 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z';
const PUPIL = 'M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0';

const GLYPHS = {
  'video-off': [...ICONS.video, SLASH],
  'screen-share': [...ICONS.monitor, 'M12 12.5v-5M9.5 10 12 7.5l2.5 2.5'],
  'screen-off': [...ICONS.monitor, SLASH],
  maximize: ['M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9', 'M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9', 'M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15', 'M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15'],
  minimize: ['M9 4v3.5A1.5 1.5 0 0 1 7.5 9H4', 'M20 9h-3.5A1.5 1.5 0 0 1 15 7.5V4', 'M15 20v-3.5a1.5 1.5 0 0 1 1.5-1.5H20', 'M4 15h3.5A1.5 1.5 0 0 1 9 16.5V20'],
  signal: ['M2.5 9.5a14 14 0 0 1 19 0', 'M6 13a9 9 0 0 1 12 0', 'M9.4 16.4a4 4 0 0 1 5.2 0', 'M11.4 19.5a.6.6 0 1 0 1.2 0a.6.6 0 1 0-1.2 0'],
  waves: [WAVES],
  'waves-off': [WAVES, SLASH],
  sliders: ['M4 7h9M18 7h2M4 17h2M11 17h9', 'M13 7a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0', 'M6 17a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0'],
  expand: ['M14 4h6v6M20 4l-7 7', 'M10 20H4v-6M4 20l7-7'],
  eye: [EYE, PUPIL],
  'eye-off': [EYE, PUPIL, SLASH],
} as const satisfies Record<string, readonly string[]>;

export type VoiceIconName = keyof typeof GLYPHS;

interface VoiceIconProps {
  name: VoiceIconName;
  /** Pixels; the glyph is drawn on a 24 grid and scaled. */
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function VoiceIcon({ name, size = 20, strokeWidth = 1.75, className }: VoiceIconProps): React.JSX.Element {
  const parts: readonly string[] = GLYPHS[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {parts.map((part) => <path key={part} d={part} />)}
    </svg>
  );
}
