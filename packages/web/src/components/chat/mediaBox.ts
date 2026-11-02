import type React from 'react';

const MAX_WIDTH = 400;
const MAX_HEIGHT = 300;

/**
 * The box a picture or clip takes in a message: at most 400 × 300 at its own
 * proportions. A picture is never enlarged; a clip is, so its controls have room.
 * It is reserved before the file loads, so nothing below it moves
 * (docs/systems/message-list.md, "Embed renderer contract"), and `max-w-full`
 * beside it keeps it inside a narrower column. Without known dimensions there is
 * no box: a guessed proportion would letterbox the real one.
 */
export function mediaBox(
  width: number | null | undefined,
  height: number | null | undefined,
  { enlarge = false }: { enlarge?: boolean } = {},
): React.CSSProperties | undefined {
  if (!width || !height) return undefined;
  const fit = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height);
  const scale = enlarge ? fit : Math.min(1, fit);
  return { aspectRatio: `${width}/${height}`, width: Math.round(width * scale) };
}
