# Changelog

## What is promised

**Documented routes only change by adding to them.** A new field in an answer, a new optional field in a request, a new kind of socket event: none of these is a breaking change, so skip what you do not know. Taking something away or changing what it means would get a new path, `/api/v2`, and the old one would stay for a good while, with a note here.

What is not in these docs is not promised, and is closed to a bot's token anyway.

## 1.34.0

- A new right, `MANAGE_EMOJIS` (536870912), for a space's own emoji and stickers. The routes it opens are not open to bots.
- A reaction `emoji:<id>` must name an emoji of this instance that the bot may use there: 400 `emoji_not_found` for an id the instance does not know, 403 `emoji_unavailable` for a space's emoji it may not use. Adding to a reaction someone already gave is always allowed.
- A message or an edit with a space's emoji (`<:name:id>`) that the sender may not use answers 403 `emoji_unavailable`; an id the instance does not know stays text. A bot may use the instance's emoji and those of the spaces it is in, a webhook the instance's and those of its channel's space.

## 1.32.3

- A channel has `icon`: null, `glyph:<name>` for one of the icons the app draws, or one emoji. Show the channel type's own icon when it is null, and for a name you do not know.

## 1.32.0

- Forum channels, `type: "forum"`: `GET` and `POST /api/channels/:id/posts`. A post is a thread, so its messages go through the routes of any channel. Writing into the forum itself answers 400 `forum_takes_posts`.
- Announcement channels, `type: "announcement"`, hold messages, threads and webhooks like a text channel. Who may write is an ordinary override.
- A message's author can have `accountKind: "follow"`: the copy of a post from a channel this one follows. Nothing is alerted by it.

## 1.30.0

- These docs.
- `/.well-known/security.txt`.

## 1.29.0

- [Cards](/developers/docs/cards) for bots and webhooks.
- [Files](/developers/docs/files): `POST /api/bots/@me/files`.
- Reactions by request: `PUT` and `DELETE /api/messages/:id/reactions/:emoji`.
- Moderation: removing a member, bans and timeouts.
- [Commands](/developers/docs/commands) with options, and answers: `POST /api/interactions/:id/reply`, also for the person alone.
- `command_invoked` gains `options` and `interactionId`.
- `X-RateLimit-*` on every answer to a bot.
- Webhooks take [Discord's `embeds`](/developers/docs/webhooks).
- A bot has a picture, set in the [portal](/developers/bots).

## 1.26.0

- Bots: tokens, the socket, messages, roles and slash commands.

## 1.24.0

- Webhooks.
