# Voice overlay

A link that shows a voice channel in a stream: an OBS browser source opens it and lays over the
stream who is in the channel and who is speaking, on a transparent ground. Made by someone who may
stream in the channel; everyone in its space sees that the channel has one.

## Files

- `packages/shared/src/voiceOverlay.ts`: the options (`layout`, `show`, `names`) and their query, the path, the wire shapes
- `packages/server/src/utils/voiceOverlays.ts`: making and removing links, the page's state, the LiveKit token
- `packages/server/src/utils/voiceOverlayChannels.ts`: which channels have a link, in memory
- `packages/server/src/routes/voiceOverlay.ts`: the four routes
- `packages/web/src/components/voice/VoiceOverlayModal.tsx`: the dialog (voice channel menu → Overlay for OBS)
- `packages/web/src/overlay/`: `entry.ts`, `boot.tsx`, `VoiceOverlayPage.tsx`, `VoiceOverlayView.tsx`, `overlay.css`
- `packages/web/src/main.tsx`: `/overlay/voice/<secret>` loads the overlay and nothing of the app

## Links

`voice_overlays` (migration 0074): `id`, `channel_id`, `space_id`, `user_id` (who made it),
`token_hash` (SHA-256 of the secret, hex, unique), `created_at`, `last_used_at` (to the minute).
One per person and channel.

| Route | Who | What |
|-------|-----|------|
| `GET /api/channels/:id/overlay` | signed in, VIEW_CHANNEL | `{ exists, createdAt }` for the asker; never the secret |
| `POST /api/channels/:id/overlay` | VIEW_CHANNEL + CONNECT + STREAM, voice set up | a new link, the old one ended: `201 { secret, createdAt }`, the secret shown this once; `403 missing_permission { permission: 'STREAM' }`, `503 voice_disabled`, 10 a minute |
| `DELETE /api/channels/:id/overlay` | signed in, VIEW_CHANNEL | the asker's link gone: `{ success: true }` |
| `GET /api/overlay/voice/:secret` | the secret, no account | the page's state, `Cache-Control: no-store`, 120 a minute; `404 voice_overlay_unavailable` |

The secret is 32 random bytes in base64url (43 characters). A link works only while its maker may
still be in the channel and stream there (`OVERLAY_PERMISSIONS`), is not deleted and not
suspended; a new link from the same person for the same channel ends the old.

**The page's state** (`VoiceOverlayState`): the channel's name, everyone in its voice room as the
space shows them (nickname and space picture before the account's, the frame decoration, muted and
deafened from the voice states) and a LiveKit token for a participant that is `hidden` and can
neither publish, subscribe nor send data. It only learns who speaks (`ActiveSpeakersChanged`); a
leaked link cannot listen in. The token lasts 10 minutes; the page asks again every 3 seconds.

**The channel says so.** Every voice channel the server sends carries `streamOverlay` (true while
any link exists), and a change goes out as `channel_updated`; the channel list shows a screen mark
with "Shown in a stream". The memory of which channels have one is filled at start
(`loadVoiceOverlayChannels`) and kept by every change.

## The page

`/overlay/voice/<secret>?layout=row&show=speaking&names=0` (the defaults are left out:
list, everyone, names). The server answers it with the app's document; `main.tsx` sees the path
before anything else and loads `overlay/boot.tsx`, which makes the page transparent all the way
down (`html.voice-overlay-page`) and draws `VoiceOverlayView`: each person's picture (the initial
on their tile without one), a green ring while they speak, a mark while muted or deafened, and their
name on a dark label that reads over any stream. Nothing else is fetched, no catalog is loaded (its
one sentence, for a link that no longer works, comes in five languages with the page), nothing is
stored.

## The dialog

Voice channel → right click → Overlay for OBS, for whoever may stream there. The layout, whom it
shows and names, a preview (the asker speaking, two stand-ins, one muted, on a checked ground),
the note that the channel shows it, and the link: made, copied, made anew (the old one ends) or
removed. The address carries the options, so changing them changes the link to copy.

## Privacy

The privacy draft says that names, pictures, mute state and who speaks can be seen through such a
link, that the channel shows it, and what is stored (the hash, the maker, the last use). No sound or
picture goes through it ([legal.md](legal.md)).

## When a link ends

- **A link taken away ends its connection.** Replacing or deleting a link, and the first refusal after its maker lost the right to stream there, put the hidden participant `overlay:<id>` out of the call at LiveKit (`evictIdentityFromLiveKitRoom`). Before, a page that stayed connected went on learning who was in the call and who spoke.
- **The secret is not in the request log.** `pathForLog` (`utils/webhookAccounts.ts`) writes `/api/overlay/voice/[secret]`; the page asks every few seconds, and the log held the secret in clear while the database holds only its hash.

## Known limits

- Who speaks needs voice (LiveKit) running; without it the page shows who is in the channel only.
- The phone's channel list does not show the mark yet; the desktop's does.
