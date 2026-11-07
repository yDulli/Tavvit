# WebSocket Protocol Reference

Endpoint: `GET /ws` (upgrade to WebSocket)
Transport: JSON messages over WebSocket
Source: `packages/server/src/ws/handler.ts`, `packages/server/src/ws/events.ts`

---

## Auth Flow

1. Client connects to `/ws`
2. Client sends `{ type: 'auth', token: '<jwt>', client?: 'web' | 'desktop' | 'mobile', batch?: true }` within 10 seconds, which it has done once the server has read it, however long `ready` then takes. With `batch: true` it says it reads `batch` events (below). `client` is optional and the server no longer records it (it fed the removed usage reporting); clients may keep sending it. The wire type is the `auth` variant of `ClientEvent` in `packages/shared/src/types.ts`, where the field is typed `ClientKind`
3. Server validates token with the same check as REST (`verifyAccessToken`: a deleted account, an ended session, a token older than the last password change, a suspended account; see "Refused sockets")
4. Server responds with `ready` event containing full client state, one socket to a turn of the event loop (operations.md). A `ping` before that is answered, and anything else waits, up to 32 frames, and is acted on once the socket is let in
5. Server sets the user's live status to their chosen status (`users.chosen_status` for an account that owns its choice, native or detached; for a replicated user the home instance's last projection, or `online` if there is none) and carries it in the `ready` payload's `user.status`, broadcasts `presence_update` to friends + DM co-members + space co-members (via `collectProfileBroadcastTargetIds`); for native users, also queues a S2S `presence_update` relay to all active peers
6. Heartbeat: server pings every 30s (RFC 6455 ping frames), dead connections detected after ~65s

### Refused sockets

A first message that is not `auth` gets an error and a close. A token that does not open the account gets the check's code, `{ type: 'error', message, code, details? }`, then close 4001: `unauthorized`, `session_ended`, `account_deleted`, `account_suspended`. The client signs out on these instead of reconnecting (auth.md, "Sockets"). `session_ended` also comes to an open socket when its session ends, and the 30-second sweep checks every open socket again.

```typescript
{ type: 'error', message: 'This account is suspended', code: 'account_suspended', details: { reason, until? } }
```

`until` (epoch ms) is there only when the suspension has an end. The socket then closes with code 4001, reason `Account suspended`; no presence is published and no `ready` is sent. The web client, on that error from its home instance, signs out (`handleUnauthorized`: the token goes and `/login` opens, which tells the reason once the password is given) instead of reconnecting. From another instance the error shows as the coded error's toast and the connection keeps retrying with its backoff (see "Known limits" under "Platform administration").

### Forced disconnects

`ConnectionManager.forceDisconnectUser(userId, { reason?, endPresence? })` ends every session of a user on this instance at once: it cancels a pending offline grace, leaves the voice room they are in (as a leave like any other: a DM call it empties ends and the end reaches the peers; a call hosted on a peer is left as if they hung up), ends the DM calls they are ringing as the caller, drops their activities, and closes each socket with code 4001 and `reason` as the close reason (default `Account deleted`). It sends no `error` first. With `endPresence` it also ends the presence those sessions held, as a last disconnect would (`finalizeDisconnect`): `offline` written and sent to the profile audience and relayed to peers, or, for a replicated row, its home's last projection shown again (`offline` when none is known) without a relay. Without it nothing about presence is sent.

| Caller | Options | Presence |
|--------|---------|----------|
| Account deletion: `DELETE /users/@me`, `DELETE /admin/users/:id`, the S2S identity delete | none | the tombstone's `user_updated` (anonymized, `status: 'offline'`), sent before the call |
| `POST /admin/users/:id/reset-password` | `{ reason: 'Password reset', endPresence: true }` | ended by the call |
| `POST /admin/users/:id/suspend` | `{ reason: 'Account suspended', endPresence: true }` | ended by the call |

The client reconnects after any close it did not ask for; the reconnect is then refused at auth: as deleted after a deletion, as revoked after a password reset (the old token predates the new `passwordChangedAt`), as `account_suspended` after a suspension (above).

---

## Several events in one frame

To a socket that said `batch: true` at `auth`, the server may send `{ type: 'batch', events: [...] }`, which is those events, in that order, as if they had come alone. A new message and its `channel_unread_count` go this way, and presence with 100 or more people connected, after waiting up to half a second (operations.md). A client from before this, and a bot, gets each in a frame of its own. Frames of 32 KB and more go compressed (`permessage-deflate`), which every WebSocket client does by itself.

## Frame size and sockets per account

A client frame is at most `WS_MAX_CLIENT_FRAME_BYTES`, 64 KiB unpacked (`packages/shared/src/constants.ts`, `ws/socketOptions.ts`). `ws` closes a socket that sends a larger one with 1009, before `auth` as after it. The largest frame a client sends is a message of 4000 characters, under 30 KB even escaped; the client sends nothing past the limit (`frameOf`, `hooks/useWebSocket.ts`). While a socket's `ready` waits its turn, at most 32 frames and 64 KiB are held for it.

One account keeps at most 10 sockets (`MOST_SOCKETS_PER_ACCOUNT`, `ws/handler.ts`). When an eleventh connects, the oldest is sent `error` `too_many_connections` and closed. A client told that does not reconnect by itself (`pushedOut`) until the page is loaded again, so the account's windows do not push each other out in turn.

A member who leaves, is kicked or banned, and every member of a deleted space, is taken out of the space's audience at once (`ConnectionManager.removeUserSpace`): no more `sendToSpace` events for it, no presence of its members by way of it, no thread of it open. They are taken out of its voice too, LiveKit included (docs/systems/voice.md).

## Client → Server

### Messages
| type | fields | notes |
|------|--------|-------|
| `message_create` | channelId, content, replyToId? | SEND_MESSAGES perm; a space's custom emoji the writer may not use is refused with an `error` coded `emoji_unavailable` (api.md, "Using a space's emoji"); MENTION_EVERYONE for content with `@everyone`, `@here` or a role token (permissions.md, "Mass mentions"); `replyToId` must name a message a member wrote in the same channel; then the space's moderation, as on REST (see below) |
| `message_edit` | messageId, content | author only; `emoji_unavailable` when the edit adds a space's emoji the author may not use (emoji the stored text carried are not asked about again); MENTION_EVERYONE when the edit adds a mass mention the message did not have; a system message cannot be edited (`error` with `system_message_immutable`); then the space's moderation, slow mode excepted |
| `message_delete` | messageId | author or MANAGE_MESSAGES; a delete by someone other than the author is recorded in the audit log |
| `channel_poke` | channelId, targetUserId | VIEW_CHANNEL and SEND_MESSAGES; not while timed out; 5 a minute per actor. See "Channel pokes" |
| `typing_start` | channelId | 5s auto-expire |

`message_create` and `message_edit` run the same moderation checks as
`POST /channels/:id/messages` and `PATCH /messages/:id`, in the same order
(`spaceMessageRefusal`; spaces.md, "Moderation"): a refusal is an `error` with
the REST route's code and details (`member_timed_out` with `until`,
`account_too_new`, `membership_too_new`, `slowmode_active` with
`retryAfterSeconds` on a new message, `automod_blocked_word`,
`automod_invite_blocked`, `automod_link_blocked`, `automod_too_many_mentions`
with `max`), sent to the user's sessions as the mass mention refusal is, and
nothing is stored or broadcast.

### DM Messages
| type | fields | notes |
|------|--------|-------|
| `dm_message_create` | dmChannelId, content?, attachments?, replyToId? | member; `replyToId` must name a message in the same DM channel; 5 per 5 seconds per client address, as `POST /api/dm/:id/messages` (`rate_limited`) |
| `dm_message_edit` | messageId, content | member, author only; a system message cannot be edited |
| `dm_message_delete` | messageId | member, author only |
| `dm_typing_start` | dmChannelId | 5s auto-expire |

`dm_message_create` first counts against its rate limit: the REST route's numbers (`utils/dmMessageRateLimit.ts`), keyed on the address the socket connected from (`request.ip` of the upgrade, recorded in `ws/socketAddress.ts`, so it follows `TRUSTED_PROXY_HOPS` as the HTTP limiter does), in a counter of its own. `DISABLE_RATE_LIMITS` switches it off. The three DM message events run the REST routes' checks (`utils/dmMessageRules.ts`), so they refuse what the routes refuse, in the same order and with the same codes (dm-system.md, "Message Operations"), `recipient_deleted` in a 1-on-1 whose partner was deleted included, and `emoji_unavailable` for a space's emoji written by an account whose home is this instance (api.md, "DMs"). A missing `dmChannelId` or `messageId` is `validation_failed`. Each refusal is an `error` with its code, and `details` where the code has placeholders, sent to the socket that sent the event and not to the user's other sessions (they did not act, and the client shows a coded error as a toast); nothing is stored, broadcast or relayed. The web client sends these actions over REST, not over these events.

### Reactions (space + DM, auto-detected)
| type | fields | notes |
|------|--------|-------|
| `reaction_add` | messageId, emoji | ADD_REACTIONS perm (space); refused with an `error` coded `member_timed_out` (`until`) while the user is timed out in the space. `emoji` is a native emoji, a custom emoji `emoji:<id>` (of the instance's library or of a space; api.md, "Custom emoji and space stickers") or a sticker token (`sticker:<asset URL>`, uploads.md "Personal stickers"); the server stores and relays each as the same string. A custom emoji must be one this instance holds (`error` coded `emoji_not_found`) and, when it is a space's, one the reactor may use: in that space's channels, or as the space's member (`emoji_unavailable`). Joining a reaction someone already gave on the message is always allowed. On a DM message only an account whose home is this instance is checked, since another account's `emoji:<id>` names an emoji of its home. One reaction per user and emoji: a repeat stores nothing, sends no `reaction_added` and queues no relay. The client does not send one either (`chatStore.addReaction` skips a reaction the user holds or has an add in flight for) |
| `reaction_remove` | messageId, emoji | own reactions only |

### Read State
| type | fields | notes |
|------|--------|-------|
| `channel_ack` | channelId, messageId | mark read up to message |
| `mark_unread` | channelId, messageId | `'0'` to clear all |

### Presence & Activity
| type | fields | notes |
|------|--------|-------|
| `presence_update` | status: online/idle/dnd | stored as the user's chosen status and published while connected; same path as `PATCH /api/users/@me { status }` (activity-presence.md "DB Persistence") |
| `activity_update` | activities: Activity[] | rate-limited 3s, respects showActivity; `source` is dropped, and what the home derived (Live on Twitch) stays beside it (activity-presence.md) |

### Voice (Space Channels)
| type | fields | notes |
|------|--------|-------|
| `voice_join` | channelId | one room per user enforced; while the user is timed out in the space, refused with an `error` coded `member_timed_out` (`until`) and `voice_disconnected` with reason `rejected`, a resume included |
| `voice_leave` | (none) | leaves the voice the user holds on this instance: a voice channel or DM call hosted here, or a call hosted on a peer that they joined through here (relayed to the host as their leave in a group call). A client joining voice on another instance sends it to the instance its DM call goes through (voice.md, "Client-Side Call Routing") |
| `voice_status` | isMuted, isDeafened, isCameraOn, isScreenSharing | server enforces space/permission mute |

### Voice Moderation

1.32.8: `voice_space_mute`, `voice_space_deafen`, `voice_move` and `voice_disconnect` answer `Target user is not in a voice channel you can moderate` both when the target is in no voice channel and when the actor may not moderate theirs, so nobody learns who sits in voice anywhere. `voice_permission_muted` goes to those who can see the channel (`sendToChannel`), and `space_voice_state` / `ready` carry `permissionMuted` only for rooms the viewer sees. `voice_join` takes a voice channel only. `channel_poke` is held to what any message in the channel is (slow mode, the space's age rules, a forum's posts only) and reaches nobody across a block. A private category is named only to those who see a channel in it or may manage channels (permissions.md, "Private channels and categories"), in `ready`, `channel_layout_updated` and `category_updated`.
| type | fields | permission |
|------|--------|------------|
| `voice_space_mute` | userId, muted | MUTE_MEMBERS |
| `voice_space_deafen` | userId, deafened | DEAFEN_MEMBERS |
| `voice_move` | userId, targetChannelId | MOVE_MEMBERS |
| `voice_disconnect` | userId | DISCONNECT_MEMBERS |

All four also need the actor to outrank the target (permissions.md, "Role hierarchy"); a refusal is an `error` with `code: 'role_hierarchy'`.

### DM Calls
| type | fields | notes |
|------|--------|-------|
| `dm_call_start` | dmChannelId | 60s auto-timeout if not accepted. In a DM whose call is hosted here, a member not in it joins it (handled as `dm_call_accept`). A member already in it, or any member while the DM's call hosted on another instance still rings or has a member here in it, gets `error` with `code: 'dm_call_in_progress'` and the `dmChannelId`, on the sending socket only (a record of such a call with nobody here in it is dropped and the start goes on); a non-member gets `code: 'not_dm_member'`, a missing `dmChannelId` `code: 'validation_failed'` |
| `dm_call_accept` | dmChannelId?, federatedCallId? | ringing→active; later accepts join the active call (late join). Refused on the sending socket only with `error` and a code: `dm_call_not_found` (no call any more), `not_dm_member`, `validation_failed`, with the id the client sent as `dmChannelId` |
| `dm_call_reject` | dmChannelId?, federatedCallId? | 1-on-1: ends the call. Group: stops only the sender's ring; ends the call only when it still rings and every member but the caller has declined. Ignored from the caller or a participant |
| `dm_call_end` | dmChannelId?, federatedCallId? | 1-on-1: ends the call. Group: takes only the sender out; the caller of a call nobody joined ends it; the call ends with its last participant. Ignored from a member who is not in the call |

### Window focus

`client_focus` `{ focused }`: whether this socket's window is in front of someone, at `ready` and when it changes. A person looking at the app gets no push (push.md).

### System
| type | fields |
|------|--------|
| `auth` | token |
| `ping` | — (gets `pong`) |

---

## Server → Client

### System
| type | fields | scope |
|------|--------|-------|
| `ready` | (see Ready Payload below) | user |
| `pong` | — | user |
| `error` | message, code?, details?, dmChannelId? | user; `details` fills the code's placeholders, as in an HTTP error body (`content_too_long` carries `max`); a refused `dm_call_start` or `dm_call_accept` goes to the sending socket only and names its `dmChannelId`; a refused `dm_message_create`, `dm_message_edit`, `dm_message_delete` or `channel_poke` goes to the sending socket only; the auth refusal of a suspended account carries `code: 'account_suspended'` and `details: { reason, until? }`, on that socket before it closes (see "Refused sockets") |

### Messages
| type | fields | scope |
|------|--------|-------|
| `message_created` | message: MessageWithUser | channel (VIEW_CHANNEL). The message carries `mentionEveryone` and `mentionRoleIds`, the mass mentions the space allowed (permissions.md, "Mass mentions"); clients alert on mass mentions from these alone |
| `message_updated` | message: MessageWithUser | channel (VIEW_CHANNEL) |
| `message_deleted` | messageId, channelId | channel (VIEW_CHANNEL) |
| `messages_deleted` | messageIds (at most 500), channelId | channel (VIEW_CHANNEL): a ban that took someone's recent messages with it, in batches per channel |
| `typing` | channelId, userId, username | channel (VIEW_CHANNEL, excludes sender) |
| `reaction_added` | messageId, reaction (includes user) | channel (VIEW_CHANNEL) |
| `reaction_removed` | messageId, userId, emoji | channel (VIEW_CHANNEL) |
| `embeds_resolved` | messageId, channelId, embeds[] | channel (VIEW_CHANNEL) |
| `channel_poke` | message: MessageWithUser (`type: 'system'`) | channel (VIEW_CHANNEL); see "Channel pokes" |

In a space channel every event above is emitted with
`connectionManager.sendToChannel`, from the REST route and from the WebSocket
handler alike, so both paths reach the same audience. (`reaction_added` and
`reaction_removed` are reused on the DM path, where they go out with
`sendToDmMembers`.) See permissions.md, "Broadcast audience".

#### Channel pokes

A member pokes another member in a space channel: the web client offers Poke
when the viewer right-clicks a message author's avatar or name. The instance
hosting the space handles it (`ws/channelPoke.ts`); a poke is never relayed
to a peer, and DMs have none.

**Capability.** `ready.supportsPoke` is `true` from an instance that handles
`channel_poke`. The client keeps it per origin (`stores/channelPokeStore.ts`)
and offers Poke only for messages from an origin that said so. A 1.10.0 or
older instance sends no flag, so its messages get no Poke. On any instance,
the author menu also has no Poke in DMs, without SEND_MESSAGES, on a message
still sending, or on the viewer's own message. It may still offer Mention, which only writes into the composer and
sends nothing; with neither item, right-clicking the author opens the message
menu (permissions.md, the author right-click row).

**Checks**, in order, each refused with an `error` and its code on the
sending socket only, storing and sending nothing:

| Refusal | Code |
|---------|------|
| `channelId` or `targetUserId` is not a string | `validation_failed` |
| no such channel, or the actor lacks VIEW_CHANNEL there | `channel_not_found` |
| the actor lacks SEND_MESSAGES there | `missing_permission` (`details.permission` = `SEND_MESSAGES`) |
| the actor is timed out in the space (spaces.md, "Moderation") | `member_timed_out` (`details.until`) |
| the target has no member row in the space (an instance admin who never joined included) | `member_not_found` |
| the target lacks VIEW_CHANNEL there | `poke_target_no_access` |
| the actor poked 5 times in the last minute | `rate_limited` |

Both ids are the hosting instance's own: the actor is the socket's user there
(a federated member's replicated row), the target is the `userId` of the
message the client right-clicked. Anything else the event carries is
ignored. The limit is a fixed window of 5 per 60 seconds per actor row,
across every channel and target (`CHANNEL_POKE_RATE_LIMIT`), on top of the
per-user limit on every event; a refused poke is not counted.
`DISABLE_RATE_LIMITS` switches it off.

**Stored row.** A poke is stored as a channel message with `type: 'system'`
(database.md, "messages"), authored by the actor, whose content is
`{ event: 'channel_poke', targetUserId, targetDisplayName }`
(`@backspace/shared/src/channelSystemEvents.ts`, which holds the parser).
`targetDisplayName` is the target's nickname in the space, else their account
name without the instance (`dmSystemName`), at the time of the poke.

**Delivery.** After the row is stored, one `channel_poke` event carries it,
hydrated like any channel message, to everyone with VIEW_CHANNEL
(`sendToChannel`). It is not sent as a `message_created`: a client from
before pokes ignores an event type it does not know, where a
`message_created` would mark the channel unread, play the message sound and,
on the `all` notification level, raise a notification showing the JSON. No
`channel_unread_count` follows it.

**A passive row.** A system row is not something a member wrote
(`userWrittenMessages()`): it does not count as unread, does not move the
last message id in `ready` (so it never makes a channel unread), is left out
of channel search, cannot be replied to, and cannot be edited
(`system_message_immutable`). It carries no mass mention stamps, whatever
names it records. It can be deleted like any message, by the actor or with
MANAGE_MESSAGES.

**Client.** The author menu sends `channel_poke` to the space's instance
(`wsSend` with its origin); when that socket is closed it shows
`chat:poke.disconnected` instead, and a refusal shows as the coded error's
toast. A `channel_poke` event adds the row to the timeline through
`chatStore.addRealtimeMessage`, which keeps channel system rows out of
`realtimeMessageEvents`, so no sound, notification or unread dot follows. The
row renders as `ChannelSystemMessage`: "{actor} poked {target}", both named
through `spaceMemberName` from the space's roster like every other surface of
the space, the stored name used only for a target no longer in it. Content
the client does not know renders "System message". Then, for a viewer of the
channel on that origin, the target's newest avatar in the message list
(`data-poke-user`) shakes and a pointing hand slides in
(`components/chat/channelPoke.ts`). The cue does not play with reduced
motion, nor, unless the viewer is the actor, in DND or in a channel that is
muted or set to `nothing`. Loading history never plays it. An older client
shows a stored poke as "System message" when it loads history.

### Pins and polls

| Event | Fields | Audience |
|-------|--------|----------|
| `message_pin_changed` | `channelId` (a conversation's id for a DM), `messageId`, `pinnedAt`, `pinnedBy` | The channel, or the conversation's members |
| `poll_updated` | `channelId`, `messageId`, `poll` | The channel, with no `myVotes`; the voter also gets one with `myVotes`, which the client keeps when a later one has none |
| `thread_updated` | `parentChannelId`, `starterMessageId`, `thread` | The parent channel, when a thread's count or last activity changes |
| `forum_tags_updated` | `channelId`, `tags` | Who can see the forum, when its tags change ([forums.md](forums.md)) |
| `thread_deleted` | `parentChannelId`, `threadId`, `starterMessageId` | The parent channel |
| `thread_followed` | `thread` | The account that now follows it |
| `thread_unfollowed` | `threadId` | The account |
| `event_updated` | `event` | The space, with no `amGoing`, which each client keeps |
| `event_deleted` | `eventId`, `spaceId` | The space |
| `event_reminder` | `eventId`, `spaceId`, `title`, `startsAt` | Those going, once, shortly before it starts |
| `space_welcome_changed` | `spaceId` | The space: fetch the welcome again, since who must agree may have changed |
| `saved_changed` | `messageId`, `saved` | The account's other devices |
| `saved_reminder` | `item`, `preview` | The account, once, when it is due |
| `soundboard_play` | `channelId`, `spaceId`, `soundId`, `userId` | Those in the call |
| `watch_state` | `channelId`, `session` (`WatchSession`, or null once it ended), `serverNow` | Those in the call when what plays, the queue or who steers changed; also to everyone joining or moving into a call, null when it watches nothing ([watch-together.md](watch-together.md)) |
| `watch_position` | `channelId`, `position` (`itemId`, `playing`, `positionMs`, `stateAt`), `serverNow` | Those in the call, for a play, pause or seek |
| `watch_presence` | `spaceId`, `channelId`, `presence` (`{ title, provider }` or null) | Who can see the voice channel, for the line under it in the channel list |
| `watch_reaction` | `channelId`, `reaction` | Those in the call; nobody is named |
| `space_sounds_changed` | `spaceId` | The space: fetch the clips again |
| `command_invoked` | `name`, `args`, `options`, `interactionId`, `channelId`, `spaceId`, `user` | The bot asked |
| `command_reply` | `id`, `channelId`, `spaceId`, `botId`, `botName`, `botAvatar`, `content`, `cards?`, `createdAt` | The person who asked, alone. Stored nowhere ([bots.md](bots.md), "Commands") |

A pin's line and a poll are ordinary `message_created`. A pin's line is `type: 'system'`, so it raises no unread count, sound or notification.

### Emoji and stickers
| type | fields | scope |
|------|--------|-------|
| `emoji_upserted` | emoji: CustomEmoji | everyone connected to this instance (`sendToAll`) |
| `emoji_removed` | emojiId | everyone connected to this instance |
| `space_emojis_changed` | spaceId | space |
| `space_stickers_changed` | spaceId | space |

`emoji_upserted` follows `POST /api/emojis` and `PATCH /api/emojis/:id`, an emoji of the instance's library added or renamed, and carries it whole; `emoji_removed` follows `DELETE /api/emojis/:id`. `space_emojis_changed` and `space_stickers_changed` follow every add, rename, description change and removal of a space's emoji or sticker, and a batch of a Discord import that brought at least one (api.md, "Custom emoji and space stickers" and "Import"); they carry no list, only which space to read again. None of this is in `ready`: a client asks an instance for `GET /api/emojis/available` when it first needs what that instance offers.

**Client.** `stores/emojiStore.ts` keeps everything per origin, since an emoji's id means something only on the instance that holds it. `emoji_upserted` and `emoji_removed` change the library of the instance whose socket delivered them (`upsertLibrary`, `dropLibrary`), from the home instance also the flat home library its settings page edits; up to 1.33 the client applied them only from the home instance. The two space events read that space's emoji and stickers again from that instance (`reloadSpace`: `GET /api/spaces/:id/emojis` and `/stickers`), once that origin's offer is loaded. Each `ready` of an origin whose offer was loaded reads it again, and disconnecting from an instance forgets it (`forgetOrigin`). Mixed versions: a client before 1.34.0 ignores the two space events, and an instance before 1.34.0 sends none.

### DM Messages
| type | fields | scope |
|------|--------|-------|
| `dm_message_created` | message: DmMessageWithUser | DM members |
| `dm_message_updated` | message: DmMessageWithUser | DM members |
| `dm_message_deleted` | messageId, dmChannelId | DM members |
| `dm_typing` | dmChannelId, userId, username | DM members (excludes sender) |
| `dm_typing_stop` | dmChannelId, userId | DM members (excludes typer) |
| `dm_embeds_resolved` | messageId, dmChannelId, embeds[] | DM members |

### Read State
| type | fields | scope |
|------|--------|-------|
| `channel_ack` | channelId, messageId | user (multi-tab sync) |
| `mark_unread` | channelId, messageId | user (multi-tab sync) |
| `channel_unread_count` | counts: Record<channelId, number> | user; follows the event that moved the count, on the same socket (see "Unread counts") |

#### Unread counts

The sidebar badges show how many messages are unread, not how many
channels. The instance that hosts a channel or DM counts it, and the client
keeps the counts per origin (`stores/unreadCountStore.ts`).

**What is counted.** Messages after the user's persisted read cursor
(`read_states`), leaving out the user's own. Ids are compared as numbers
(`CAST(id AS INTEGER)`), because snowflakes grew a digit in late 2024 and
grow another in 2031. A space channel is counted only when the user has
VIEW_CHANNEL and READ_MESSAGE_HISTORY there (or ADMINISTRATOR); a DM only
while the user is an open member of a conversation that is not deleted.
Deleted messages are gone from the table and drop out of the next count.
DM system messages count like any other message, as they do for the
unread dot. A space channel's system rows (pokes) do not count, as they do
not move the unread dot (see "Channel pokes").

**The cap.** A count stops at 100, which reads "100 or more". The badges
show anything above 99 as "99+", and a sum of capped counts reaches 100
exactly when the real sum does. The cap also bounds the work: a count
walks at most 100 entries of `idx_messages_channel_unread` or
`idx_dm_messages_channel_unread` (database.md), however long the channel.

**Snapshot.** `ready.unreadCounts` holds an entry for every countable space
channel and open DM in the payload, zero included. The client replaces that
origin's counts with it on every `ready`. It reuses the permissions and read
states the payload already loaded.

**Follow-ups.** `ConnectionManager.sendToUser` sends a `channel_unread_count`
with the user's new count right after these events, on the same sockets, so
the count never runs ahead of or behind the event it belongs to
(`unreadCountFollowUp`, `ws/channelUnreadCounts.ts`):

| Event | Why the count moved |
|-------|---------------------|
| `message_created`, `message_deleted` | a message after the cursor came or went |
| `dm_message_created`, `dm_message_deleted` | the same, in a DM |
| `channel_ack`, `mark_unread` | the cursor moved, here or relayed from a peer as `read_state_update` |
| `channel_updated` | the user's access may have changed |
| `dm_channel_created` | a DM opened or reopened with messages already in it |

A channel fan-out (`sendToChannel`, the visibility broadcast in
`routes/channels.ts`) passes the permissions it computed to choose the
audience, so a follow-up costs one read-state lookup and one bounded count
per recipient. `sendToSpace` events are never followed. A new channel has
nothing to count, and a deleted channel or closed DM leaves the sidebar
with its row, so neither is followed.

**Client.** `SpaceUnreadBadge` sums the counts of the space's channels
from the space's own origin; `DmUnreadBadge` sums the pinned copy of each
conversation from the origin that serves it (`channelOriginMap`), so a
conversation mirrored on several instances counts once. Both sum only
channels in `chatStore.unreadChannels`, so the badge and the unread dot
agree. A muted space keeps its badge in a quieter colour (sounds.md,
"Notification settings").

**Older releases.** An instance on 1.9.1 or earlier sends no
`unreadCounts`; the client then holds no counts for that origin and shows
the unread dot alone. A client on 1.9.1 or earlier ignores
`channel_unread_count` and the extra `ready` field. Federation is unchanged: each instance counts its own
copies.

**Known limits.** A channel that becomes visible through a role change
(`space_access_changed`) or a space joined mid-session has no count until
its next follow-up or the next `ready`; its unread dot shows meanwhile.

### Presence & Activity
| type | fields | scope |
|------|--------|-------|
| `presence_update` | userId, status, activities?, homeUserId?, homeInstance? | friends + DM co-members + space co-members of the user (via `collectProfileBroadcastTargetIds`), plus self for multi-tab sync. For federated stubs, the local instance receives status and activities via S2S `presence_update` relay from the home (see `federation.md` §10 — Presence Sync) and re-broadcasts to the same recipient set, with `activities` whenever the relay changed them (empty clears). `activities` absent = unchanged. `homeUserId`/`homeInstance` are the subject row's federated identity, both null for a row native to this instance; the client keys activities and friend status by that identity (activity-presence.md "Keying"). Every emitter builds the event with `presenceUpdateFor`/`presenceUpdateEvent` (`ws/presenceEvent.ts`). Also sent when a friendship is created: each side gets the other's current status and activities (activity-presence.md "Friendship Snapshot"). Servers that predate the identity fields omit them. |
| `user_updated` | user | user |
| `linked_accounts_update` | accounts: `LinkedAccountView[]` | only to the person, after any change to their linked accounts (linked-accounts.md); a client takes it from its home only |

### Space / Channel Management
| type | fields | scope |
|------|--------|-------|
| `space_updated` | space | space |
| `member_joined` | spaceId, member: MemberWithUser | space |
| `member_updated` | spaceId, member: MemberWithUser | space |
| `member_left` | spaceId, userId | space |
| `member_banned` | spaceId, reason | user (banned) |
| `channel_created` | channel, spaceId | space |
| `channel_updated` | channel, spaceId | space |
| `channel_deleted` | channelId, spaceId | space |
| `category_created` | category, spaceId | space |
| `category_updated` | category, spaceId | space |
| `category_deleted` | categoryId, spaceId | space |
| `channel_layout_updated` | spaceId, channels[], categories[] | space |
| `space_access_changed` | spaceId | space; one user for an instance admin change |
| `space_layout_updated` | layout[], folders[], updatedAt? | user |
| `notification_settings_updated` | setting: NotificationSetting | user (all of their sockets on this instance) |

`notification_settings_updated` follows every successful
`PATCH /spaces/:spaceId/notification-settings` and
`PATCH /channels/:channelId/notification-settings` (api.md, "Notification
settings"), including to the socket of the session that made the change. It
names the instance's own ids; the client files it under the origin of the
socket that delivered it, which is the instance that hosts the space
(`notificationSettingsStore.apply`), and keeps the newer `updatedAt` when
several sources disagree. A setting with `level` null, `muted` false and no suppress flag was
cleared. Space settings carry `suppressEveryone` and `suppressRoles`;
an old client ignores them. Clients load the full list with `GET /users/@me/notification-settings`
when each instance's `ready` arrives; the `ready` payload itself does not
carry it. Mixed versions: an old client ignores the event; a new client on an
old server gets a 404 from the list route, logs it and uses the defaults.

**Moderation fields.** No event type is new for space moderation
(spaces.md, "Moderation"); the payloads carry it. Every `MemberWithUser`
(`member_joined`, `member_updated`, the space detail, `ready`) has
`timedOutUntil`: the end of a running timeout (epoch ms, the hosting server's
clock), null otherwise, so an ended one is never sent as in force and no event
marks its end. Every `Channel` (`channel_created`, `channel_updated`,
`channel_layout_updated`, the space detail, `ready`) has `slowmodeSeconds`, 0
when off. Every `Space` (`space_updated`, join answers, the space detail,
`ready`, `join_request_accepted`) has `defaultNotificationLevel`, `'all'`,
`'mentions'` or null. All three are built by `utils/spaceWire.ts`. A host that
predates them sends none of the three. Every `Channel` also has `icon`, its
own icon or null (spaces.md, "Channel icons"); a host before 1.32.3 sends
none, which the client shows as the type's icon.

**Roles and profiles.** No event type is new for role display, owner listing
or space profiles either. Every `Role` (the space detail, `ready`, member rows)
carries `description`, `colorSecondary`, `icon`, `hoist` and `mentionable`;
every `Space` carries `ownerGroup`; every `MemberWithUser` carries `avatar`,
`banner` and `bio` (the member's space profile, null when unset), and
`member_updated` follows `PATCH /spaces/:id/members/@me/profile` like any other
member change (spaces.md, "Space profiles"). A Discord template import into an
existing space ends with `space_access_changed` to every member (spaces.md,
"Importing a Discord template"). Every `User` carries `pronouns`,
`profileLinks` and `profileLayout` (auth.md, "Profile fields"), and the five
decoration fields `avatarFrame`, `profileEffect`, `nameplate`, `nameFont` and
`nameEffect`, null for none, so that a `user_updated` merged over an older copy
takes a decoration off (decorations.md).

**Badges.** No event type is new for badges either (registry:
`packages/shared/src/badges.ts`; api.md, "Users" and "Spaces"). Every `User`
carries `badges`: `staff` for an instance admin, then the badges an admin
granted. Every `Space` carries `badges`: `verified` while its verification
stands, then the granted ones. Every `MemberWithUser` of the space detail,
`ready` and `member_updated` carries `badges`, `administrator` or `moderator`
from the member's role bits, which the hosting server works out because
members cannot see them (`memberStaffBadges`, `utils/spaceWire.ts`); a
`member_joined` member carries `[]`. Changes reach clients through the events
that carry those objects: a change to a person's granted badges sends
`user_updated` to them and to everyone who sees their profile
(`collectProfileBroadcastTargetIds`), a change to a space's granted badges and
every verification step send `space_updated` to the space (`announceSpaceUpdate`,
`utils/reviewNotify.ts`). `PATCH /admin/users/:id/role` sends `user_updated`
to the target only, so other clients see a changed `staff` badge the next time
they load that user. Hosts that predate badges send none of these fields.

`member_updated` follows every successful `PATCH /spaces/:id/members/:uid`
(a nickname, a role set or both) and every `PUT` or `DELETE
/spaces/:id/members/:uid/timeout` that changed the member, and carries the
member row the route answered: `nickname`, `timedOutUntil`, and `roles` with
display fields only (permissions.md, "Who receives role and override data"). The client applies it only when the
space with that id and the origin of the socket that delivered it is the
loaded space (`applySpaceMemberUpdate` in `stores/spaceMemberUpdates.ts`), and
takes only `nickname` and `roles` from it; the user row and presence have
their own events. The HTTP answer goes through the same function. Mixed
versions: an older client ignores the event; an older server does not send
it, and its role changes still arrive through `space_access_changed`.

`space_access_changed` follows any change to the space's roles or to a
member's roles: `POST`, `PATCH`, `DELETE /spaces/:id/roles[/:rid]`,
`PATCH /spaces/:id/members/:uid`, `POST`/`DELETE /spaces/:id/members/:uid/roles`.
It also follows `PATCH /spaces/:id/transfer-ownership` (sent to the space,
after `space_updated`; the former and the new owner are the members whose own
permissions changed), and `PATCH /admin/users/:id/role` when the admin flag
changes: an instance admin holds every permission in every space on the
instance, so that user alone is sent one event for each space they belong to
(`ConnectionManager.announceUserAccessChange`), followed by the
`space_voice_state` they can see there now. What the receiver may see or do
there, and how the roles and members look, may be different now. The client
refetches the space's detail from its own instance with `loadSpaceDetail(spaceId, { quiet: true })`: no loading state
(no skeleton) and no message cache touched. One action can send several of
these events (a member role edit, quick role moves), and their refetches can
answer out of order; which load lands, and what lands for a space that is
not open, is in spaces.md ("Client Load State"). Every channel the detail lists
goes through `upsertChannel`, and a channel of that space it no longer lists
goes through the `channel_deleted` path, which also closes it when it is
open (`refreshSpaceAccess` in `hooks/useWebSocket.ts`). The detail carries no
voice presence, so the members whose own permissions the change may reach
(the member whose roles changed; the holders of a changed or deleted role;
everyone for @everyone; nobody for a new role; the former and the new owner)
are each sent a
`space_voice_state` right after the event, built by `pushSpaceVoiceState`
exactly as for a mid-session join (below): a voice channel a member just
gained shows who is in it at once (`ConnectionManager.announceSpaceAccessChange`).
These routes used to
push a whole `ready` instead, which every client handles as a reconnect.
Mixed versions: an old client connected to a new server ignores the event
and misses live role changes in that space until it reconnects; a new client
connected to an old server still gets the old `ready` push.

An `error` that carries a `code` is the refusal of something the user just
did (`role_hierarchy` from the voice moderation events, the moderation refusals
of `message_create`, `message_edit`, `reaction_add`, `voice_join` and
`channel_poke` (see "Messages" above), the custom emoji refusals of
`message_create`, `message_edit` (`emoji_unavailable`) and `reaction_add`
(`emoji_not_found`, `emoji_unavailable`), `dm_call_in_progress`,
`not_dm_member` and `validation_failed` from `dm_call_start`, `dm_call_not_found`,
`not_dm_member` and `validation_failed` from `dm_call_accept`, and the DM
message events (see "DM Messages")); the client shows it as a warning
toast in the user's language (`describeErrorCode`, with the event's `details`). The exception is
`account_suspended` from the home instance, the refusal of the socket itself:
it signs the client out instead of showing a toast (see "Refused sockets").
An `error` without a code is only logged. An `error` with a `dmChannelId` equal to the DM the client is
calling, from the instance that serves that DM, also clears the calling state
(`outgoingCall`), which stops the outgoing ring. A `dm_call_not_found` or
`not_dm_member` naming the call the client is in, from that call's instance,
takes the client out of it (`teardownDmCall`).

### DM Channel Management
| type | fields | scope |
|------|--------|-------|
| `dm_channel_created` | dmChannel | user |
| `dm_channel_closed` | dmChannelId | user |
| `dm_member_added` | dmChannelId, user | DM members |
| `dm_member_removed` | dmChannelId, userId | DM members |
| `dm_owner_updated` | dmChannelId, newOwnerId, newOwnerHomeUserId?, newOwnerHomeInstance? | DM members |

### Voice
| type | fields | scope |
|------|--------|-------|
| `voice_state_update` | channelId, userId, action: join/leave, channelElapsedSeconds? | space members who can see the channel (`sendToChannel`; a hidden voice channel's comings and goings, and that it exists, are nobody else's business, as in `buildSpaceVoiceState`) |
| `voice_status_update` | userId, channelId, isMuted, isDeafened, isCameraOn, isScreenSharing | room: for a space, its members who can see the channel; for a DM call, its members |
| `space_voice_state` | spaceId, voiceStates, voiceChannelElapsedSeconds, voiceUserStates, spaceVoiceStates | the joining user, or a member whose access changed. Scoped per-space voice-presence snapshot pushed when a user joins a space mid-session, after `space_access_changed` (see below), and to each member who can see a voice channel after an override on it or its category changed or it moved to another category (spaces.md, "Channel/Category Permission Overrides"). |
| `voice_space_muted` | userId, channelId, spaceId, muted | space members who can see the channel |
| `voice_space_deafened` | userId, channelId, spaceId, deafened | space members who can see the channel |
| `voice_permission_muted` | userId, spaceId, muted | space |
| `voice_moved` | userId, oldChannelId, newChannelId | user (target) |
| `voice_disconnected` | userId, channelId, reason? | user (target) |
reason: `'displaced'` (new tab) | `'session_closed'`

### DM Calls
| type | fields | scope |
|------|--------|-------|
| `dm_call_incoming` | dmChannelId?, federatedCallId, callerId, callerName, callOrigin?, livekitUrl?, livekitToken? | DM members (excludes caller). `dmChannelId` can be null for Path B federated calls (no local DM channel). `callOrigin` identifies the hosting instance for cross-instance calls. |
| `dm_call_accepted` | dmChannelId?, federatedCallId?, answeredBy? | DM members, on every accept including late joins. A client acts on it only when it names the call it holds (`dmCallEventIsOurs`). `answeredBy` (`{ homeUserId, homeInstance }`, absent from servers up to 1.9.0) is the member who answered: the client stops ringing only when that is the signed-in user, compared by federated identity (`acceptStopsRing`), so in a group call another member's answer leaves the ring on. Without it the ring stops as before |
| `dm_call_rejected` | dmChannelId?, federatedCallId? | DM members when the call ends as rejected; only the decliner (all sessions) for a group decline that leaves the call running |
| `dm_call_ended` | dmChannelId?, federatedCallId? | DM members. Preceded by a `voice_state_update` leave for each participant still in the call. A client tears down its call state only when the event names the call it holds (`dmCallEventIsOurs`) |
| `dm_call_undeliverable` | Sent to the originator when a call relay (start / accept / reject / end) to one or more peers fails. Includes `phase: 'start' \| 'accept' \| 'reject' \| 'end' \| 'host_unreachable'` identifying the action; `failures[]` enumerates failed peers with a `reason` (`peer_rejected` / `peer_awaiting_approval` / `peer_transient_failure` / `livekit_unavailable` / `no_recipient` / `identity_not_accepted`, the last when the peer accepts no name this instance could give the acting user, so nothing was sent; see federation.md "Who a call relay names"). `terminal: true` means local call state should be (or has been) torn down; `terminal: false` is informational. See `docs/systems/voice.md` for the full phase × terminal matrix. | originator (caller / acceptor / rejector / ender) |

### Social
| type | fields | scope |
|------|--------|-------|
| `friend_request_received` | request | user (target) |
| `friend_request_accepted` | friend, requestId | user (requester) |
| `friend_request_declined` | requestId, userId | user (requester) |
| `friend_request_cancelled` | requestId, userId | user (target) |
| `friend_removed` | userId | user |
| `blocks_updated` | blockedUserIds: string[] | the blocker only; the whole current set after every block or unblock, home instance only |

### Discovery
| type | fields | scope |
|------|--------|-------|
| `join_request_received` | request | space (managers) |
| `join_request_accepted` | request, space | user (requester) |
| `join_request_declined` | request | user (requester) |

### Platform administration
| type | fields | scope |
|------|--------|-------|
| `space_review_updated` | spaceId, spaceName, process, action, status, note | user: the space's owner (`spaces.owner_id`, the owner's row on this instance), all of their sockets here |
| `review_queue_count` | verificationOpen, discoveryOpen | every connected instance admin (`sendToAdmins`) |

Both follow every step of a space's two reviews, Verification and Discovery
approval (api.md, "Reviews" and "Platform administration"), sent by
`announceReviewStep` (`utils/reviewNotify.ts`): an owner's request or
withdrawal (`routes/spaceReview.ts`), an admin's decision
(`routes/platformAdmin.ts`), and an edit that moved the Discovery status
(`PATCH /api/spaces/:id`, action `changed`, whoever made the edit). The
payload types are `SpaceReviewUpdatedPayload` and `ReviewQueueCountPayload`
in `packages/shared/src/platform.ts`.

`space_review_updated` tells the owner what moved: `process` is
`verification` or `discovery`, `action` one of `REVIEW_ACTIONS` (`submit`,
`withdraw`, `approve`, `reject`, `request_info`, `request_changes`, `revoke`,
`admin_withdraw`, `changed`), `status` the status the step left (null for a
withdrawn verification request), `note` the admin's reason (null for every
other step), and `spaceName` the name at the time. `review_queue_count`
carries the open requests after the step (`openReviewCounts`: verifications
`pending` or `needs_info`, Discovery requests `pending` or `changes_requested`),
the same counts the `ready` payload carries as `reviewQueueCount`. A
verification step is also followed by `space_updated` to the space, so the
verified badge shows or goes at once; a Discovery step of a space opted in to
the directory marks the directory dirty instead (directory.md).

**Client.** `space_review_updated` moves the space's revision in
`stores/reviewStore.ts`, so an open Discovery or Verification panel of that
space reloads its review state, and shows a toast naming the space and its new
status (`common:review.toast.verification` / `.discovery`). The open-request
count comes from the home instance only: `ready.reviewQueueCount` and
`review_queue_count` from another origin are ignored, and `reviewStore.queue`
stays null for anyone but the home instance's admins.

**Known limits.** Deleting a space with an open request sends no
`review_queue_count`; the admins' count catches up at their next `ready`. A
socket to another instance that refuses the account as suspended is retried
with the client's reconnect backoff, and each refusal shows its toast again.

### Federation
| type | fields | scope |
|------|--------|-------|
| `federation_file_rejected` | messageId, dmChannelId, attachmentId, affectedUsers[] | DM members |
| `federation_approval_request_received` | — (refetch trigger; payload: `{ type }`) | admins. Fires for **both** inbound peering requests (remote → us) AND outbound queue creation when the [Outbound Peering Gate](federation.md#outbound-peering-gate) creates a `peer_approval_requests` row in response to a user_action. Payload shape unchanged from the inbound-only behavior; only the firing surface widened. |
| `federation_peer_reset_detected` | `{ origin: string }` | admins. Fires from `markPeerReset` when a peer's advertised instance epoch differs from the trusted baseline (a wipe-and-reinstall on the same domain — see [Reset Detection](federation.md#reset-detection-markpeerreset--utilsfederationresetts)). Detection-only: the peer was routed to `needs_attention` (reason `peer_reset_detected`) with no rekey/tombstone. Paired with a `federation_peers_changed` broadcast. **Client handler:** `onFederationPeerResetDetected(cb)` (`useWebSocket.ts`) — the FederationPanel's Reset-cleanup surface subscribes and refetches `GET /api/federation/peers` + `GET /api/federation/reset-events`, raising a persistent banner with one-click Re-peer (see `admin.md` "FederationPanel", `client-federation.md` §8). |
| `peering_subscription_changed` | — (refetch trigger; payload: `{ type }`) | the subscribing user (all of their connected sessions). Fires when a `peer_approval_subscribers` row belonging to the user is created, modified, or deleted (gate fan-in, user cancel, parent cascade). Client refetches `GET /api/federation/peering-subscriptions`. |
| `peering_notification_received` | `{ type, kind: 'approved' \| 'denied' \| 'expired' }` | the user the notification belongs to. Fires when a `peer_approval_notifications` row is created (`onPeerActivated` outbound fanout, outbound `/deny` fanout, janitor outbound expiry). Client refetches `GET /api/federation/peering-notifications` and may surface a transient toast for online users. |

**S2S relay-only event (not a direct client WS event):**

`read_state_update` — sent peer-to-peer via the federation relay when a user acknowledges a DM channel on one instance. The receiving instance processes it, upserts the `read_states` row, and then emits a standard `channel_ack` event to the user's local WebSocket connections. The relay event itself is never forwarded to clients directly.

---

## Ready Payload

```typescript
{
  type: 'ready',
  user: User,
  spaces: SpaceWithChannelsAndMembers[], // channels and categories carry isPrivate (permissions.md, "Private channels and categories")
  dmChannels: DmChannel[],
  folders?: SpaceFolder[],
  spaceLayout?: SpaceLayoutItem[] | null,
  layoutUpdatedAt?: number,
  voiceStates?: Record<channelId, userId[]>,
  voiceChannelElapsedSeconds?: Record<channelId, number>,
  voiceUserStates?: Record<string, { isMuted, isDeafened, isCameraOn, isScreenSharing }>,
  spaceVoiceStates?: Record<string, { spaceMuted, spaceDeafened, permissionMuted }>,
  watching?: Record<channelId, { title, provider }>, // what each voice call watches together (watch-together.md)
  readStates?: ReadState[],
  supportsPoke?: boolean,          // true from an instance that handles channel_poke (see "Channel pokes"); absent before
  unreadCounts?: Record<channelId, number>, // unread messages per countable space channel and open DM, capped at 100 (see "Unread counts")
  activeCalls?: ActiveCallInfo[],  // includes federatedCallHost?, livekitUrl?, livekitToken? for federated calls
  userActivities?: Record<userId, Activity[]>,  // space members, DM members and friends; keys are this instance's row ids
  userActivityIdentities?: Record<userId, { homeUserId: string | null, homeInstance: string | null }>,  // identity of each userActivities key; null pair = native row
  rejectedPeerOrigins: string[],         // origins with status 'rejected'; used for DM unreachable indicators
  awaitingApprovalPeerOrigins: string[], // origins with status 'awaiting_approval'
  pendingApprovalCount: number,          // count of peer_approval_requests rows; only non-zero for admins
  reviewQueueCount: { verificationOpen: number, discoveryOpen: number } | null  // open review requests (see "Platform administration"); null for anyone but an instance admin, absent from hosts that predate it
}
```

**Roles:** each space's `roles` carry their display fields for every member and their `permissions` only when the user holds `MANAGE_ROLES` there; `members[].roles` carry display fields only. The payload has no override rows; the user's own permissions are `myPermissions` on the space and on each channel. The same shaping applies to the `space` in `join_request_accepted` (permissions.md, "Who receives role and override data").

**Federated users:** When the connecting user is federated (`homeInstance` is set), the ready payload carries their DMs on this instance like anyone else's: `dmChannels` (this instance's copies, each with its `federatedId`, which is how the client shows a conversation it also gets from the user's home once) and `activeCalls` for those memberships. `readStates` is filtered to the space channels and DMs in the payload, and a DM with messages but no read state yet gets one at its newest message, so conversations mirrored here before the user first connected do not show as unread.

**Voice-state assembly:** `voiceStates` / `voiceChannelElapsedSeconds` / `voiceUserStates` / `spaceVoiceStates` / `watching` for each of the user's spaces are produced by `ConnectionManager.buildSpaceVoiceState(spaceId, userId)` — the single source of truth shared with the mid-session join push (see below). `voiceChannelElapsedSeconds` is a whole-second duration computed from the in-memory `VoiceRoom.startedAt`; clients advance that duration from receipt time, so server/client clock skew cannot change the value. It disappears when the room becomes empty. Because rooms are intentionally in-memory, a server restart clears both occupancy and its duration until participants reconnect; this is not persisted to the database. Voice presence is VIEW_CHANNEL-filtered per `computePermissions`: a user is never told who occupies a voice channel they cannot see.

### Mid-session space join — `space_voice_state` push

**Client: one session per socket.** The web client treats the first `ready` of a socket as a new session (it may follow a gap, so the message cache of that origin is refetched) and any later `ready` on the same socket as a state refresh that leaves the message cache alone. See docs/systems/message-list.md, "Reconnects and refresh readies".

The `ready` payload is the **only** carrier of voice presence at connect time. When a user joins a space *mid-session* (invite, public join, or join-request approval) without reloading, they would otherwise see empty voice channels until a refresh, because `member_joined` carries no voice state and `GET /api/spaces/:id` (the channel-sidebar hydrator) has none either.

To close this, `ConnectionManager.addUserSpace(userId, spaceId)` — the single chokepoint every join path funnels through, and which is **not** used on reconnect (that path uses `setUserSpaces`) — calls `pushSpaceVoiceState(userId, spaceId)`, which builds the same per-space snapshot via `buildSpaceVoiceState` and pushes it to the user as a `space_voice_state` event. Delivery rides the same ordered WebSocket as the `voice_state_update` deltas, so there is no snapshot-vs-stream race. The push is skipped when the user has no connection, or the space has no active voice and no restrictions (e.g. space creation). The client applies it scoped to `spaceId` (`utils/voiceStateSync.applySpaceVoiceState`): it merges occupants/statuses and rebuilds only that space's restriction keys, never disturbing voice state in other spaces.

## Legal events

| Event | To | Fields | Means |
|-------|----|--------|-------|
| `report_queue_count` | admins | `open` | How many reports wait; also `reportQueueCount` in `ready` |
| `legal_updated` | everyone | none | Operator details or a document changed: reload `GET /api/legal` |
| `user_notice` | one person | `notice: UserNotice` | What the operator decided about them ([legal.md](legal.md)) |
| `announcements_changed` | everyone connected | none | What the operator says to everyone changed: ask `GET /api/announcements` again ([admin.md](admin.md), "The console") |

## Threads on the wire

A message in a thread goes only to those who follow it or have it open. The client says what it has open with the client event `thread_watch` (`{ threadId }`, or `null` when it closes it). `ready` carries `followedThreads`, those not gone quiet. See [threads.md](threads.md).

## A bot on the socket

`{ type: 'auth', token: 'Bot <token>' }` opens a socket for a bot. It may then send only `BOT_SOCKET_EVENTS` (`typing_start`, `reaction_add`, `reaction_remove`) and the ping; anything else answers `{ type: 'error', code: 'bot_route_forbidden' }`. `revalidateSockets` checks a bot's socket by what stops a bot ([bots.md](bots.md)).
