/**
 * The voice channels that have an overlay link (docs/systems/voice-overlay.md), held in memory so
 * that every channel the server sends can say so without asking the database. `voiceOverlays.ts`
 * fills it at start and keeps it with every change; this module imports nothing, so the code that
 * builds channels for the wire can read it without depending on the rest.
 */
const channelsWithOverlay = new Set<string>();

export function channelHasVoiceOverlay(channelId: string): boolean {
  return channelsWithOverlay.has(channelId);
}

/** Sets whether a channel has a link. Answers whether that changed. */
export function markVoiceOverlayChannel(channelId: string, has: boolean): boolean {
  const had = channelsWithOverlay.has(channelId);
  if (has) channelsWithOverlay.add(channelId);
  else channelsWithOverlay.delete(channelId);
  return had !== has;
}

export function resetVoiceOverlayChannels(channelIds: Iterable<string>): void {
  channelsWithOverlay.clear();
  for (const id of channelIds) channelsWithOverlay.add(id);
}
