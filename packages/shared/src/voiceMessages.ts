/** Voice messages (docs/systems/uploads.md, "Voice messages"): an audio attachment that carries its waveform. */

export const VOICE_MESSAGE_LIMITS = {
  /** A recording stops by itself at this length. */
  MAX_SECONDS: 300,
  /** How many bars a waveform has at most. */
  MAX_BARS: 64,
  /** The height of a bar goes up to this. */
  MAX_BAR: 100,
} as const;

/**
 * A waveform as a list of bar heights, or null when the value is not one. It arrives as a list
 * in a relay's JSON, and as `12,40,7` from an upload's metadata and from the column.
 */
export function parseWaveform(value: unknown): number[] | null {
  const items: unknown[] | null = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : null;
  if (!items || items.length === 0 || items.length > VOICE_MESSAGE_LIMITS.MAX_BARS) return null;
  const bars: number[] = [];
  for (const item of items) {
    const text = String(item);
    if (!/^\d{1,3}$/.test(text)) return null;
    const bar = Number(text);
    if (bar > VOICE_MESSAGE_LIMITS.MAX_BAR) return null;
    bars.push(bar);
  }
  return bars;
}

/** The form an upload's metadata and the column hold. */
export function waveformText(value: unknown): string | null {
  return parseWaveform(value)?.join(',') ?? null;
}
