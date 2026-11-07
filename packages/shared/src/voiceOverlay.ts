import type { AvatarFrame } from './decorations.js';

/**
 * The voice overlay (docs/systems/voice-overlay.md): a page an OBS browser source opens to show a
 * voice channel in a stream, who is in it and who is speaking, on a transparent ground. Its address
 * holds a secret; whoever made it can make a new one, which ends the old, or take it away.
 */

/** How the people stand: one under the other, or side by side. */
export const VOICE_OVERLAY_LAYOUTS = ['list', 'row'] as const;
export type VoiceOverlayLayout = (typeof VOICE_OVERLAY_LAYOUTS)[number];

/** Whom it shows: everyone in the channel, or only whoever is speaking. */
export const VOICE_OVERLAY_SHOWS = ['everyone', 'speaking'] as const;
export type VoiceOverlayShow = (typeof VOICE_OVERLAY_SHOWS)[number];

/** What the address asks of the page, after the secret: `?layout=row&show=speaking&names=0`. */
export interface VoiceOverlayOptions {
  layout: VoiceOverlayLayout;
  show: VoiceOverlayShow;
  names: boolean;
}

export const DEFAULT_VOICE_OVERLAY_OPTIONS: VoiceOverlayOptions = { layout: 'list', show: 'everyone', names: true };

/** The options an address asks for; anything unknown is the default. */
export function voiceOverlayOptionsOf(search: string): VoiceOverlayOptions {
  const params = new URLSearchParams(search);
  const layout = params.get('layout');
  const show = params.get('show');
  return {
    layout: (VOICE_OVERLAY_LAYOUTS as readonly string[]).includes(layout ?? '') ? layout as VoiceOverlayLayout : DEFAULT_VOICE_OVERLAY_OPTIONS.layout,
    show: (VOICE_OVERLAY_SHOWS as readonly string[]).includes(show ?? '') ? show as VoiceOverlayShow : DEFAULT_VOICE_OVERLAY_OPTIONS.show,
    names: params.get('names') !== '0',
  };
}

/** The query an address carries for these options; the defaults are left out. */
export function voiceOverlayQuery(options: VoiceOverlayOptions): string {
  const params = new URLSearchParams();
  if (options.layout !== DEFAULT_VOICE_OVERLAY_OPTIONS.layout) params.set('layout', options.layout);
  if (options.show !== DEFAULT_VOICE_OVERLAY_OPTIONS.show) params.set('show', options.show);
  if (!options.names) params.set('names', '0');
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** Where the overlay page of a secret lives, on the instance that serves it. */
export function voiceOverlayPath(secret: string): string {
  return `/overlay/voice/${secret}`;
}

/** The secret in an overlay page's path, or null for any other path. */
export function voiceOverlaySecretOf(pathname: string): string | null {
  const match = /^\/overlay\/voice\/([A-Za-z0-9_-]{32,64})\/?$/.exec(pathname);
  return match ? match[1]! : null;
}

/** One person in the channel as the overlay shows them: their name and picture in this space. */
export interface VoiceOverlayPerson {
  /** Their id on this instance; LiveKit's identity starts with it. */
  id: string;
  name: string;
  avatar: string | null;
  avatarColor: string | null;
  /** What their picture's tile is worked out from, when they have no picture: their home id. */
  tileKey: string;
  frame: AvatarFrame | null;
  muted: boolean;
  deafened: boolean;
}

/** What the overlay page is told each time it asks (GET /api/overlay/voice/:secret). */
export interface VoiceOverlayState {
  channelName: string;
  people: VoiceOverlayPerson[];
  /** How to hear who speaks: a hidden LiveKit participant that receives nothing else. Null without voice. */
  livekit: { url: string; token: string } | null;
}

/** Whether the asker has a link for a channel (GET /api/channels/:id/overlay). The secret is never shown again. */
export interface VoiceOverlayLinkResponse {
  exists: boolean;
  createdAt: number | null;
}

/** A new link (POST /api/channels/:id/overlay): its secret, shown this once. */
export interface CreateVoiceOverlayResponse {
  secret: string;
  createdAt: number;
}
