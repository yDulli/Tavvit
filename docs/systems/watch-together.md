# Watching together

A voice call watches a video at the same time: YouTube, Vimeo or a video file. Everyone in the call sees the same moment; each device plays the video itself, and the server says where it stands.

**Files:** `packages/shared/src/watch.ts`, `packages/server/src/utils/watchSessions.ts`, `packages/server/src/utils/watchTitles.ts`, `packages/server/src/routes/watch.ts`, `packages/web/src/stores/watchStore.ts`, `packages/web/src/utils/watchSync.ts`, `packages/web/src/utils/watchPlayers/`, `packages/web/src/components/voice/Watch*.tsx`.

## The session

One per voice channel, on its room in the server's memory (`VoiceRoom.watch`, `ws/handler.ts`). Nothing of it is written to the database. It ends when the last person leaves the call (`afterParticipantLeft`), when someone allowed ends it, or with a restart of the server.

`WatchSession` holds `current` (what plays, or null), `queue` (at most `WATCH_LIMITS.QUEUE_MAX`, 50), `playing`, `positionMs` with `stateAt` on the server's clock, `control` (`'everyone'` or `'starter'`) and `starterId`. Each `WatchItem` is a source (`provider`, `ref`, `startMs`, `url`) and its `title`; nothing says who added it, since nothing shows that. Where the video stands at any moment is `watchPositionAt(session, now)`.

**What a session may cost.** The whole session goes to everyone in the call on every change, so it is bounded twice: by count (`QUEUE_MAX`) and by size (`SESSION_MAX_BYTES`, 64 KB when serialized; a link past that answers `watch_queue_full` like a full queue), and a file's address is capped as the parser writes it, not only as pasted (one pasted character can become nine). A change that changes nothing (a pause while paused, a `next` for a video that no longer plays, a `remove` of an id not in the queue, `control` set to its value) is applied as `unchanged` and told to nobody; a play, pause or seek goes out as a position alone (`watch_position`), and the channel list hears of a change only when what plays changed. As defence in depth in `ConnectionManager.deliver`, a socket holding more than `MOST_BUFFERED_BYTES` (16 MiB) unsent is ended rather than fed more: it is not draining.

Only space voice channels have sessions. DM calls do not yet: their rooms can live on another instance.

## Links

`parseWatchUrl` (shared, so the client says at once what the server will refuse) accepts:

- YouTube: `youtube.com` (also `m.`, `music.` and `youtube-nocookie.com`) with `/watch?v=`, `/shorts/`, `/embed/`, `/live/` or `/v/`, and `youtu.be/<id>`.
- Vimeo: `vimeo.com/<id>`, `vimeo.com/<id>/<key>` and `player.vimeo.com/video/<id>?h=<key>`.
- A video file over https ending in `.mp4`, `.m4v`, `.webm`, `.mov` or `.ogv`.

A start time from `t=`, `start=` or `#t=` (`90`, `90s`, `1m30s`, `1h2m3s`) becomes `startMs`, at most a day. Each canonical `url` is https, whatever the pasted link was. Anything else is `watch_link_unsupported`.

**The title.** `lookUpWatchTitle` asks the provider's oEmbed endpoint, two fixed addresses (`www.youtube.com/oembed`, `vimeo.com/api/oembed.json`): no address a client names is fetched by the server, redirects are refused, the answer is capped at 64 KB and 4 s. Only the video's public link goes there. A 401, 403 or 404 means the video is private, removed or may not be embedded, so it is refused (`watch_link_unsupported`) rather than showing everyone an error. With no answer the title stays empty, and the client names the video by its provider (`voice:watch.untitled`, `utils/watchTitle.ts`): a title goes to everyone who can see the channel, and a link may carry the key of an unlisted video. A file is named by the last part of its path (`fileTitleOf`), never by its whole address, which may carry a query. Titles go through `cleanWatchTitle`: one line, without characters that would disguise it, at most 200.

## Routes

Every route is for those in the call right now, as the soundboard's play is (`inCall` in `routes/watch.ts`): the channel must be a space's voice channel (else `404 channel_not_found`), the person in its room and still allowed into it, VIEW_CHANNEL and CONNECT as `voice_join` asks (`403 watch_not_in_call` either way: a right taken away mid-call takes the session with it, even while the room still lists them), and free to act in the space (`memberActionRefusal`). Bots may not use them (no `botAllowed`, bots.md). Each answer that changes the session is `{ session, serverNow }`.

| Route | Rule |
|-------|------|
| `GET /api/channels/:id/watch` | Where the session stands. |
| `POST /api/channels/:id/watch` | `{ url }`. Bit 25 `STREAM`, the right to show one's screen there (`403 missing_permission`). Starts a session, or adds to the queue of the one running (`409 watch_queue_full`, by count or by size). The title is asked for in between (up to 4 s), so everything is checked again after it, as if the request came in then. 20 a minute per person. |
| `POST /api/channels/:id/watch/state` | `{ action }`: `play`, `pause`, `seek` (`positionMs`), `next` (`itemId?`), `remove` (`itemId`), `control` (`control`). `403 watch_not_controller` for someone who may not steer; `404 watch_not_found` without a session. A change that changes nothing answers with the session and is told to nobody. 60 a minute per person. |
| `DELETE /api/channels/:id/watch` | Its starter, anyone while everyone steers, or someone with `MOVE_MEMBERS`. |
| `POST /api/channels/:id/watch/react` | `{ reaction }`, one of `WATCH_REACTIONS` (eight emoji), while something plays. Nobody is named to the call: it sees a reaction, not who gave it. 8 in 10 seconds per person. |

**Who steers.** Everyone in the call, until the starter says only they do (`control`, the starter's alone to change). When that starter leaves the call, the session goes back to everyone: a session nobody may steer helps no one.

**Skipping once.** `next` with the `itemId` of the video it skips does nothing once another plays. Every player reports the end of a video, so the room skips one video, not one per person.

## On the socket

| Event | Fields | Audience |
|-------|--------|----------|
| `watch_state` | `channelId`, `session` (null once it ended), `serverNow` | Those in the call, when what plays, the queue or who steers changed. Also to everyone joining or moving into a call (`voice_join`, `voice_move`), null when it watches nothing, so nothing of an earlier call plays on. |
| `watch_position` | `channelId`, `position` (`itemId`, `playing`, `positionMs`, `stateAt`), `serverNow` | Those in the call, for a play, pause or seek: a few bytes in place of the session. A client whose session plays another video ignores it. |
| `watch_presence` | `spaceId`, `channelId`, `presence` (`{ title, provider }` or null) | Everyone who can see the channel (`sendToChannel`), for the line under it in the channel list |
| `watch_reaction` | `channelId`, `reaction` | Those in the call |

`ready` and `space_voice_state` carry `watching` (`Record<channelId, WatchPresence>`), built in `buildSpaceVoiceState` with the voice occupancy and filtered the same way, so the channel list is right after a reconnect or a mid-session join. The client takes such a snapshot as the whole truth for the channels it covers (`applyPresenceSnapshot`) and leaves other instances' channels alone.

A `watch_state` the client gets for a call it is not in (it left meanwhile) only updates the channel list.

## Keeping in step

The client keeps the offset between its clock and the server's from `serverNow` (`clockOffset`), and reads where the room is on its own clock (`roomPositionMs`). Once a second the player is made to play or pause as the room does, and moved when it has run off by more than `WATCH_LIMITS.DRIFT_TOLERANCE_MS` (2 s, `needsSeek`). Right after it starts, and after every change in the room, it is first put within `SETTLE_TOLERANCE_MS` (0.6 s) once: a player that just loaded starts behind by its loading time, which the wider tolerance would leave for the whole video. A change applies at once, since it arrives as a new `watch_state` or `watch_position` (`applyPosition` moves the session only while it plays the video the position names). A player told to do what it already does sends nothing, so the provider shows its marks only when something changes.

## The players

`utils/watchPlayers/` gives the three kinds one interface (`WatchPlayer`: play, pause, seek, position, length, volume, subtitles where the player has them, destroy) and reports the end, a start the browser refused, and playing.

- **YouTube** in an iframe from `www.youtube-nocookie.com` with `enablejsapi=1` and its own controls off, steered over postMessage only. Commands are posted to that origin alone, and only messages from that origin and that iframe's window are heard.
- **Vimeo** in an iframe from `player.vimeo.com` with `dnt=1`, the same way.
- **A file** in a `<video>`.

No script of either provider runs on our page, and the CSP stays as it is: both hosts are in `EMBED_FRAME_ORIGINS`, and `media-src` already allows https. The providers' own controls are off and a layer over the player keeps clicks from it, so nobody steers only their own copy. The iframes may autoplay (`allow="autoplay"`) and send a referrer of the origin only.

**Consent.** A video from another server loads on a person's device only after their yes, through the same gate as any embed (`useBlockedHost`, legal.md "Content from other servers"): until then the frame shows the title and "Load" / "Always allow", and the moment they agree the player starts where the room is. A start the browser blocks without a click shows "Click to watch along".

**Sound.** One's own volume for the video (kept on the device), times the call's output volume, quieter while someone else speaks when the setting that softens a stream for speech is on (`streamAttenuationEnabled`, by its strength), silent while deafened, by oneself or by the space.

**Subtitles** (1.35.0). Off until the viewer turns them on with the subtitles button under the picture, a choice of their own kept on the device (`tavvit.watch.captions`) like the volume. Left to itself YouTube turns them on where the video's language is not the browser's, and with the providers' controls off nobody could turn them off again. `WatchPlayer.setCaptions` carries the choice: YouTube's player loads or unloads its captions module (`loadModule` / `unloadModule('captions')`, and `cc`, its older name) once ready and again each time the video starts to play, when YouTube loads the module anew; Vimeo's disables its text track once ready (also a track its owner made the default) and, turned on, enables the track in the browser's language, else English, else the first (`getTextTracks`, `chooseTrack`). A file has none, so the button is not there.

## The view

The one player lives in `WatchPlayerHost`, mounted in `AppLayout` beside the call's audio, so it never unmounts while the call watches: an iframe moved in the page would load again. It is in one of three places (`data-watch-frame`):

- **stage:** while the call's view is open, the grid gives its stage to `WatchStage`, a place that holds no player, with the call's tiles in a strip under it, and the host lies exactly over that place (`useSlotBox`). The stage registers itself and is measured before the view is painted, so the frame never shows anywhere else first.
- **float:** anywhere else on the desktop, the video takes the place of the call's own floating window (`PictureInPicture`, bottom right, above the bar under it; the rules are `pipBounds.ts`), and that window steps aside for it (`videoOutsideStage`). It offers a way back to the call and one to put the video away.
- **unseen:** where the call's own window would not show (the phone, whose call has its own bars, mobile-ui.md "Voice Overlay"; or with the floating window turned off), the video plays on invisible, as the call's sound does, until the call's view is open again.

"Hide the video" on the stage and the X of the float both put the video away for this person (`videoHiddenFor`, the call it was put away in): it stops for them, the call's floating window comes back, and the grid shows "Show the video". It is held by the call, not by the view, so a view rebuilt around the same call (the layout changing between phone and desktop remounts the host) keeps the choice, and another call starts with its video shown. The others watch on.

On the stage, a bar above the picture names what plays and offers full screen (where the browser allows it) and hide; a bar under it holds the position, play or pause, next, the time, the reactions, the subtitles (YouTube and Vimeo), one's own volume and the queue. They sit outside the picture because the providers draw marks of their own in it (title, logo, a symbol while a video starts or seeks) that cannot be turned off. The queue opens beside the picture, or over it in a frame narrower than 560 px: it lists what is coming, lets those who steer remove, those with `STREAM` add, the starter say who steers, and those allowed end it. Floating, only the way back and the way away show, under the pointer. Controls someone may not use are disabled, and the server refuses them anyway.

Reactions rise over the picture for 2.4 s (`REACTION_FLIGHT_MS`), at most 24 at once, and not at all with reduced motion.

The button is in the call's controls on the desktop (`VoiceControlBar`) and in the phone's call screen (`MobileVoiceFullScreen`), which shows the same grid. The channel list shows "Watching: <title>" under a voice channel with people in it (`VoiceChannel.tsx`).

## Federation

A space's voice channel lives on the space's instance, so the client talks to that instance (`getApiForOrigin(getChannelOrigin(channelId))`), and its store keys by channel id as the voice store does. Nothing of a session crosses to a peer: everyone in the call is connected to the instance that holds it.

**Only that instance speaks for it.** A client connected to several instances takes `watch_state`, `watch_presence` and `watch_reaction` only from the socket of the channel's own origin (`getChannelOrigin(channelId) === origin` in `useWebSocket.ts`), and a snapshot (`ready`, `space_voice_state`) only for the channels it covers (`channelOfOrigin(origin)`, `channelOfSpace(spaceId, origin)`; entries for other channels are dropped). Otherwise another instance the person is connected to could put a video into their call, one from its own server even without the consent prompt, since a connected server's content needs none (tested in `hooks/useWebSocket.watchOrigin.test.ts`). The gate rests on `channelOriginMap`, so the channel index lets no instance write or drop an id another instance issued (`spaceChannels.ts`, client-federation.md): an event from elsewhere that names the call's id changes nothing.

**What the client keeps.** A session arrives over the socket or as the answer of a request; both go through `isWatchSession` (shared), and one that is not a session as the server sends them (an unknown provider, a ref no player here takes) is dropped: a player for it would load nothing the person agreed to. The answer of a request is taken as the call's session only while the client is still in that call (`takeAnswer`), else as what the channel list shows: an answer may land after the person left.

## Privacy

The draft says that the link, the title and the queue are held in memory only while the call lasts, that whoever can see the channel sees the title and those in the call see the links, the queue and who started the session, that the server asks YouTube or Vimeo for the title with only the video's link, and that the video itself loads only after consent. Nothing names who added a video or who reacted, since nothing shows that. Nothing goes into a person's export, since nothing is kept.

## Limits

- A restart ends every session.
- Someone who loses VIEW_CHANNEL or CONNECT on the channel mid-call is taken out of the call (`checkVoicePermissions`, voice.md), and with it out of the session; the routes refuse them either way.
- A provider's player may still show ads or refuse to play in some countries; the room cannot see that.
- A video that ends early on one device (a shorter copy, an ad) asks for the next only once, through the `itemId` rule.
- A live stream has no position the room can share: its players are moved to the room's position like any video, which may jump.
- Real syncing across real devices and networks has to be tried by hand.
