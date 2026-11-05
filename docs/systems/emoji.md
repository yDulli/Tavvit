# Emoji and stickers

Pictures people put into what they write. An **emoji** stands in a line of text or as a reaction; a **sticker** is a message, or a reaction, of its own. There are three kinds: the instance's **library** of emoji, a **space's own** emoji and stickers, and each person's **collection** of stickers. All of them are named, served and drawn the same way, so most of the app does not need to know which kind it holds.

**Files:** `packages/shared/src/customEmoji.ts`, `packages/shared/src/spaceExpressions.ts`, `packages/shared/src/stickers.ts`, `packages/server/src/routes/emojis.ts`, `packages/server/src/routes/spaceExpressions.ts`, `packages/server/src/routes/stickers.ts`, `packages/server/src/utils/spaceExpressions.ts`, `packages/server/src/utils/emojiUse.ts`, `packages/server/src/utils/emojiImage.ts`, `packages/server/src/utils/stickerImage.ts`, `packages/server/src/utils/stickerAssets.ts`, `packages/web/src/stores/emojiStore.ts`, `packages/web/src/utils/emojiSets.ts`, `packages/web/src/utils/emojiWire.ts`, `packages/web/src/utils/emojiName.ts`, `packages/web/src/components/ui/CustomEmojiImage.tsx`, `packages/web/src/components/chat/EmojiPicker.tsx`, `StickerPicker.tsx`, `ReactionPill.tsx`, `packages/web/src/components/modals/spaceSettingsPanels/EmojiStickersPanel.tsx`, `spaceSettingsTabs.ts`, `packages/web/src/components/modals/settingsPanels/EmojiSettingsPanel.tsx`.

## Three kinds

| Kind | Table | Who adds it | Who may use it |
|------|-------|-------------|----------------|
| The instance's library | `custom_emojis` | Administrators, or everyone when `instance_settings.emoji_policy` is `everyone` ([admin.md](admin.md), "Emoji"). Whoever added one, or an administrator, renames or removes it. | Anyone on the instance |
| A space's emoji | `space_emojis` | Holders of MANAGE_EMOJIS in the space | Anyone who writes in the space's channels, and its members anywhere on the instance ("Who may use which") |
| A space's stickers | `space_stickers`, over `sticker_assets` | Holders of MANAGE_EMOJIS in the space | Offered to its members in the sticker picker; the server cannot hold anyone to that ("Known limits") |
| A person's stickers | `personal_stickers`, over `sticker_assets` ([uploads.md](uploads.md#14-personal-stickers)) | The person | The person |

What they share:

- **Ids.** The library and the spaces take emoji ids from one snowflake generator, so an id names exactly one picture on its instance, of whichever kind.
- **Tokens.** In text an emoji is `<:name:id>`, as a reaction `emoji:<id>`. The id decides. The name is only what a reader of the raw text sees, so a rename never breaks an old message, and a reaction carries no name, so a rename does not split its count. A token inside code stays text, as a mention does.
- **One picture route.** `GET /api/emojis/<id>.webp` serves the picture of either kind, so a reader draws an emoji from its id alone. It needs no sign-in, like an upload: an `<img>` cannot send a token, and a message that uses a space's emoji is read outside the space too. It sends the same headers as a sticker asset ([uploads.md](uploads.md#14-personal-stickers), "Serving"): cached for a year as immutable, `nosniff`, and a CSP that allows nothing to run.
- **One kind of sticker.** A space's sticker is a named entry over the content-addressed assets personal stickers use, and is sent with the same token, `sticker:<origin>/api/stickers/assets/<sha256>.webp`. Everything that draws, previews or collects a sticker works for it, and "Add to my stickers" takes one into a person's own collection.

Pictures live in `UPLOAD_DIR/emoji/<id>.webp` for both kinds of emoji and in `UPLOAD_DIR/stickers/<sha256>.webp` for every sticker. The attachment phases of the janitor read only the top level of the upload directory and never see them.

## Tables

Migration `0071_tavvit_space_expressions`; every column is in [database.md](database.md).

- **`space_emojis`**: `id` (a snowflake), `space_id` (cascades), `name`, `animated`, `size` (the stored bytes), `discord_id`, `created_by` (no foreign key; `tombstoneUser` clears it), `created_at`. A name is unique in its space, and so is a Discord id where there is one (a partial unique index). `created_by` has an index.
- **`space_stickers`**: `id` (a snowflake), `space_id` (cascades), `sticker_id` (the asset, a foreign key with no `ON DELETE` action), `name`, `description` (null for none), `animated`, `size`, `discord_id`, `created_by`, `created_at`. The database keeps a name unique in its space as written, and the routes also compare names without regard to case. A Discord id is unique in its space; `sticker_id` and `created_by` have indexes.
- **`spaces.discord_imported_at`**: set by every template import, into a new space or an existing one, and by an emoji and sticker import that brought anything. The invite page's welcome for people coming from Discord rests on it ([spaces.md](spaces.md)).

## Limits

| What | Limit | Refusal |
|------|-------|---------|
| Emoji in the library | 500, and 50 per person; administrators have no limit of their own (`CUSTOM_EMOJI_LIMITS`) | 409 `emoji_limit_reached` `{ max }` |
| Emoji of a space | 200 (`SPACE_EXPRESSION_LIMITS.EMOJI_PER_SPACE`) | 409 `space_emoji_limit_reached` `{ max }` |
| Stickers of a space | 60 (`STICKERS_PER_SPACE`) | 409 `space_sticker_limit_reached` `{ max }` |
| A person's stickers | 200 (`MAX_PERSONAL_STICKERS`) | 409 `sticker_collection_full` `{ max }` |
| Pictures per minute, per account | The library 10; a space's emoji and stickers together 30; personal stickers 30 | 429 `rate_limited` |
| Stickers per day, per account | To spaces 100 (`STICKER_UPLOADS_PER_DAY`), which the Discord import does not count; personal stickers 50. A removed sticker's file stays until the janitor's grace has passed, so adding and removing them over and over would otherwise fill the disk. | 429 `rate_limited` |
| An emoji's name | `[a-z0-9_]`, 2 to 32 (`normalizeEmojiName`, which forgives capitals, surrounding space and colons), unique in the library or in its space | 400 `emoji_name_invalid` `{ min, max }`; 409 `emoji_name_taken`, `space_emoji_name_taken` |
| A sticker's name | One visible line of at most 100 (`normalizeStickerName`), unique in its space without regard to case | 400 `sticker_name_invalid` `{ max }`; 409 `space_sticker_name_taken` |
| A sticker's description | One visible line of at most 200, null for none (`normalizeStickerDescription`) | 400 `validation_failed` `{ field: 'description' }` |

The library and each space may hold an emoji of the same name; the pickers tell them apart ("Pickers and shortcodes").

**Pictures.** Every picture is decoded and written again, never stored as sent, so what is served is always an image this code produced.

- **An emoji**, of either kind (`encodeEmoji`, `utils/emojiImage.ts`): PNG, JPEG, WebP or GIF; at most 3 MB in; at most 16,777,216 decoded pixels over all frames, and at most 120 frames; stored as WebP within 128 by 128 pixels and at most 256 KB, trying quality 85, 65 and 45 in turn, with one limit of 30 seconds over all passes together (`PICTURE_ENCODE_SECONDS`). Refusals: 400 `emoji_image_invalid`, 413 `emoji_image_too_large`.
- **A sticker**, personal or a space's (`encodeStickerImage`, `utils/stickerImage.ts`): the same formats, at most 5 MB in and out, WebP within 512 pixels, and at most 300 frames (`MAX_STICKER_FRAMES`), counted before anything is encoded: a tiny picture with a huge number of frames stays under the pixel limit and would keep the encoder busy for minutes. The same 30 seconds. Refusal: 400 `sticker_invalid_image` `{ max }` (in MB).

**Picture work** waits for the same turns as all media work, two at a time (`runMediaJob`, `utils/thumbnail.ts`), with two bounds on top. An account has at most one picture job queued or running, whatever it is for (a library emoji, a personal sticker, a space's emoji or sticker, the Discord import): a second is refused at once instead of waiting with its picture in memory. And while 24 jobs wait, a new one is refused too, so many accounts together cannot grow the queue without end. Both answer 429 `rate_limited` (`MediaBusyError`). An upload's own thumbnail is never refused here. The settings panel sends one picture after another, so a person adding many does not meet the first bound.

**Storage.** A space's emoji and stickers count on the storage of whoever added them, by hand or through the Discord import, for as long as the space keeps them (`storageUsedByAccount`, [uploads.md](uploads.md), "Limits per account"). What counts is the stored `size` of each entry, so a picture in two spaces counts twice though its file is kept once. The add checks the encoded size and holds it (`reserveUpload`) from before the file is written until the row is in. Refusals: 413 `storage_limit_reached`, 507 `disk_full`. Library emoji and personal stickers count on no account; they have the limits above.

## Routes

None of these routes is open to bots ([bots.md](bots.md)); a bot uses emoji under the same rule as anyone when it writes or reacts. Shapes and every error code: [api.md](api.md).

| Route | Rule |
|-------|------|
| `GET /api/emojis` | The library, by name. |
| `POST /api/emojis`, `PATCH /api/emojis/:id`, `DELETE /api/emojis/:id` | Adding follows `emoji_policy` (403 `emoji_admins_only`); renaming and removing are for whoever added it or an administrator. |
| `GET /api/emojis/:id.webp` | Public: the picture of a library emoji or a space's. |
| `GET /api/emojis/available` | What the caller may pick on this instance: `{ library, spaces: [{ spaceId, emojis, stickers }] }`, with every space they are a member of here in the order they joined, also those with nothing yet, so a client can tell an empty space from one it has not heard of. Not part of `ready`: it grows with the spaces a person is in. |
| `GET /api/spaces/:id/emojis`, `GET /api/spaces/:id/stickers` | Members, or holders of MANAGE_EMOJIS (an instance administrator); anyone else 403 `not_space_member`. `{ emojis, max }` by name, `{ stickers, max }` in the order they were added. `max` is the limit of the instance that hosts the space, which a client of another version may not know. |
| `POST /api/spaces/:id/emojis` | `{ name, image }`, the picture in base64. 201 with the emoji. |
| `PATCH /api/space-emojis/:id` | `{ name }`. |
| `DELETE /api/space-emojis/:id` | The row and its file. Messages that used it show its `:name:` from then on. |
| `POST /api/spaces/:id/stickers` | `{ name, description?, image }`. 201 with the sticker and its token. |
| `PATCH /api/space-stickers/:id` | `{ name?, description? }`, at least one; `null` clears the description. |
| `DELETE /api/space-stickers/:id` | The row. Its picture stays while anything names it ("When things go away"). |

An entry that does not exist answers 404 `space_emoji_not_found` or `space_sticker_not_found`.

**Who may change a space's emoji and stickers** is asked on the server by `expressionManagerRefusal` (`utils/spaceExpressions.ts`): MANAGE_EMOJIS (403 `missing_permission`, `{ permission: 'MANAGE_EMOJIS' }`), and nothing that holds the person back in the space (`memberActionRefusal`: a timeout, an address not yet confirmed, rules not yet accepted). An add asks it at the route, then once more right before its row goes in, together with the room and the name, with nothing awaited between that check and the insert. So adds side by side cannot all pass the first check, and someone who lost the right while their picture was being encoded (banned, timed out, demoted, deleted) adds nothing; the file written for it is taken back. The Discord import goes through the same add (`addSpaceEmoji`, `addSpaceSticker`).

**Audit log.** `emoji_create`, `emoji_update`, `emoji_delete`, `sticker_create`, `sticker_update` and `sticker_delete`, with `targetType` `space`, the entry's id as `targetId`, its name as `targetLabel`, and `name` or `description` as the changes.

## The right

MANAGE_EMOJIS is bit 29 (`1n << 29n`, 536870912), shown as "Manage Emoji and Stickers". It is asked for the space as a whole, never in a channel, so no override changes it. No default role has it; the owner, instance administrators and holders of ADMINISTRATOR always do. It opens the "Emoji and stickers" tab and the emoji and sticker import in "Get from Discord" ("Space settings").

A Discord template gives it, together with MANAGE_SOUNDS, only to a role that held both Manage Expressions (Discord's bit 30) and Create Expressions (bit 43). Each Tavvit right both adds and changes, which on Discord takes the two together, so a role with one of them gets neither, and the one it held is listed as unsupported (`DISCORD_COMBINED_PERMISSIONS`, [spaces.md](spaces.md)).

## Which instance a token names

An emoji's id means something only on the instance that holds it. Which instance a token names follows from where the text stands:

| Where | The token names an emoji of | The client draws it from |
|-------|-----------------------------|--------------------------|
| A message in a space's channel: a text or announcement channel, a thread, a forum post | The channel's host | `getChannelOrigin(channelId)` |
| A reaction to such a message | The channel's host | The same |
| A direct message | The writer's home | `emojiOriginOfPerson(author)`; this page's instance for one's own messages |
| A reaction to a direct message | The reactor's home | The home of the pill's first reactor, for the whole pill |
| Text that belongs to no channel | This page's instance | `''` |

The server judges only tokens that name its own emoji: everything in its spaces' channels, and in direct messages what its own accounts write ("Who may use which"). The client draws from the same instance: `Message.tsx` works it out (`emojiOriginOfPerson` in `utils/emojiSets.ts`) and passes it as `emojiOrigin` to `MarkdownRenderer` and `MessageTranslation`, which hand it down through `EmojiOriginContext`, to `InlineMessageText` for a reply's preview, and to `ReactionPill`. Without it, a renderer takes the channel's host.

**The text names an id, never an address.** The instance comes from where the text stands or from who wrote it, so a token cannot point a reader's browser at any other server.

Where only text can stand (a notification, a push, a preview in a list, a thread's summary), a token reads `:name:` (`emojiTokensToText`).

Nothing about an emoji crosses to a peer. A token travels as text inside a message or a reaction, through the relays that already carry them, and each reader fetches the picture from the instance it names.

Before 1.34 a channel hosted on another instance showed its emoji as `:name:`, and the reaction picker could send this instance's ids to another one. Both follow the table now.

## Drawing an emoji

`CustomEmojiImage` draws `<origin>/api/emojis/<id>.webp` for any id, known to this client or not: a space's emoji in a space the reader is not in is still a picture. The name it shows and reads out is the current one where the client knows the emoji, otherwise the one in the text.

- **From an instance this client is not connected to**, the picture is not requested until the reader said yes to its host, as for any picture from elsewhere (`GatedPicture`, [legal.md](legal.md), "Content from other servers"). Meanwhile `:name:` stands in its place. An emoji has no button of its own: a "Load" given to that host elsewhere in this session, or "Always allow", lets it load.
- **A picture that fails** (removed, never there) shows `:name:`, and a cache for the session, by origin and id, keeps the client from asking again, since browsers do not cache a 404.

## Who may use which

On the server, `utils/emojiUse.ts`:

| Emoji | Who may use it |
|-------|----------------|
| The library's | Anyone, anywhere on the instance |
| A space's | Anyone who writes in that space's channels, there; and the space's members anywhere on the instance: in other spaces' channels and in direct messages written here |
| An id the instance does not know | In text it stays as written, and readers see `:name:`, as for an emoji removed later. As a reaction it is refused (400 `emoji_not_found`): a reaction has no text to fall back on. |

A space's emoji someone may not use answers 403 `emoji_unavailable`, for a message and for a reaction. An edit is asked only about emoji its text did not carry before, since the writer may have left the space in between. Joining a reaction someone already gave is always allowed. The client offers only what the rule allows, so the refusal meets a client that is behind (a space left since its offer was loaded) or a token written by hand.

### Where it is asked

| Path | Where |
|------|-------|
| `POST /api/channels/:id/messages`, `PATCH /api/messages/:id` | `routes/messages.ts` |
| Socket `message_create`, `message_edit` | `ws/events.ts` |
| A forum post's first message, `POST /api/channels/:id/posts` | `routes/forums.ts` |
| A bot's answer to a command, `POST /api/interactions/:id/reply` | `routes/bots.ts` |
| A poll's question, `POST /api/channels/:id/polls` (its card draws the question as a message; the answers stay plain text) | `routes/polls.ts` |
| A webhook's post, `POST /api/webhooks/:id/:token`. Its account belongs to no space, so only the emoji of its channel's space and the library. | `routes/webhooks.ts` |
| A direct message written or edited here, by REST or on the socket, by an account whose home is this instance | `checkDmMessageCreate`, `checkDmMessageEdit` (`utils/dmMessageRules.ts`) |
| A reaction in a space, on the socket or through `PUT /api/messages/:id/reactions/:emoji` | `addSpaceReaction` (`utils/reactions.ts`) |
| A reaction to a direct message on the socket, by an account whose home is this instance | `ws/events.ts` |

**A new path that writes message text or a reaction has to ask this rule** (`emojiUseRefusal`, `reactionEmojiRefusal`). `utils/emojiUse.test.ts` and the "custom emoji of a space" part of `routes/channelsMessages.errorCodes.test.ts` hold it.

### What is not asked, and why

- **A direct message relayed from another instance**, and **a direct message, or a reaction to one, that an account whose home is elsewhere writes here** (`namesEmojiOfThisInstance`): their tokens name emoji of that home, which this instance does not hold and cannot judge.
- **A copy a followed announcement channel brings** ([forums.md](forums.md), "Following") keeps its text as written, emoji included: it is the post as it was written in its own space, not something the follow's account wrote.

## Forwarding

A forward copies what someone else wrote, so it is not refused for their emoji; it only cannot hand them on. `forwardableEmojiText` (used by `routes/forward.ts`) turns each space's emoji the forwarder may not use where the copy lands into the `:name:` its token carries. The library's, the target space's own and those of spaces the forwarder is in stay emoji. Into a direct message by an account whose home is elsewhere every emoji becomes text, since readers there look for it on that home.

## Pickers and shortcodes

`EmojiContext` (`utils/emojiSets.ts`) says where an emoji is picked or typed: the instance whose emoji the text names (`origin`, `''` for this page's) and the space it is in (`spaceId`, null in a direct message). `emojiContextOfChannel` gives a channel's host and space. A direct message's context is this page's instance, which is the writer's home (`DIRECT_MESSAGE_EMOJI_CONTEXT`).

`emojiSetsFor` lists the sets on offer, in the order they are shown and their names take precedence:

1. the space written in;
2. the instance's library;
3. the instance's other spaces the person is in, in the order of the space list.

A space the list no longer shows (left meanwhile) is not offered, and one with nothing in it makes no set. The offer mirrors what the server allows.

- **The emoji picker** has one category per set, named after its space, or "Shared emoji" for the library, each with an icon of its own. The composer's picker gets its channel's context, and the reaction picker its message's. A channel's icon is chosen without custom emoji (`custom={false}`), since an icon has to read the same on every instance ([spaces.md](spaces.md), "Channel icons").
- **The sticker picker** shows the person's own collection first, then a section for each space that has stickers, the space written in first. Those sections are for sending only, so Manage mode hides them: a space's stickers are managed in its settings. The search covers them too. In a direct message only spaces of this page's instance are offered, since a sticker is accepted only from the writer's home or from the instance that takes the message (`mayPostSticker`, [uploads.md](uploads.md#14-personal-stickers)).

### Shortcodes

What a person types and sees is `:name:`; what is sent is the token. Where two sets on offer have an emoji of the same name, the first keeps the name and the later ones are `name~2`, `name~3`… in the order above (`shortcodeIndex`; `EMOJI_SHORTCODE_ALIAS` in `shared/src/customEmoji.ts`). The picker shows and inserts that shortcode, and its search finds every one of them by the plain name. A shortcode therefore holds where it is typed: an emoji can be `:wave:` in its own space and `:wave~2:` in another.

`tokenizeCustomEmojiShortcodes` accepts aliases and writes the plain name into the token, so an alias never reaches anyone else. `toWireText` (`utils/emojiWire.ts`) turns what was typed into tokens with the shortcodes of its context, in channels hosted elsewhere too; a shortcode nothing on offer carries stays as typed. `fromWireText` is the way back when a message is edited: a token reads as the shortcode of its emoji there, and a token whose emoji is not on offer stays a token, so saving cannot lose or swap a picture.

## Reactions

A custom emoji reacts as `emoji:<id>`, counted by its exact text.

- **In a space** it names the host's emoji and is asked like text, except that an id the instance does not know is refused (400 `emoji_not_found`).
- **In a direct message** it names the reactor's home's emoji and is asked only when the reactor's home is this instance. The pill is drawn from the home of its first reactor ("Known limits").
- **A removed emoji's pill** keeps its count and shows `:emoji:`, since a reaction carries no name.
- **A space's sticker** can be a reaction like any sticker: the reaction picker's sticker tab has the same sections. The server asks only where its file lives (`mayPostSticker`).

## The client's store

`stores/emojiStore.ts` keeps everything per instance, since an id means something only on its own: `origins` maps an origin (`''` for this page's instance) to `{ status, library, spaces, byId }`. `spaces` holds every space the person is in there, in the order of joining, and `byId` every emoji of both kinds.

- **Loaded when first needed** (`ensureOrigin`, then `loadOrigin`, which asks that instance for `GET /api/emojis/available`): when a channel's composer is shown, so a `:name:` typed without opening the picker still becomes its emoji, and when a picker opens.
- **Loaded again** when the space list shows a space of that instance the offer does not know (joined since; `useEmojiSets`), and at that instance's `ready` if it had been loaded, since things may have changed while the tab was away.
- **One space again** (`reloadSpace`: its two lists) on `space_emojis_changed` or `space_stickers_changed` from the instance that hosts it.
- **The library** follows `emoji_upserted` and `emoji_removed` from each instance's own socket (`upsertLibrary`, `dropLibrary`). The home library also keeps the flat fields (`emojis`, `byId`, `idsByName`) that its settings page edits.
- **Forgotten** when the instance is disconnected (`forgetOrigin`), and all of it at sign-out (`reset`), which drops answers still on their way.

The store imports no other store, so the message renderer and the composer can read it without import cycles; the space list the sets are ordered by is read in `utils/emojiSets.ts`.

## Events

| Event | Fields | Sent to | The client |
|-------|--------|---------|-----------|
| `emoji_upserted` | `emoji` | Everyone on the instance (`sendToAll`) | Updates that instance's library |
| `emoji_removed` | `emojiId` | Everyone on the instance | The same |
| `space_emojis_changed` | `spaceId` | The space (`sendToSpace`) | Reads the space's lists again |
| `space_stickers_changed` | `spaceId` | The space | The same |

The two library events are older; since 1.34 the client applies them to the instance that sent them, not always to its home. The routes send the space events after each change, the Discord import at the end of each batch that brought something.

## Space settings

Two tabs ([spaces.md](spaces.md), "Settings tabs"):

- **Emoji and stickers** (`EmojiStickersPanel`), for MANAGE_EMOJIS. It reads the space's lists from its host. Several pictures can be picked at once. Each is named from its file name, an emoji by `suggestEmojiName` (`emoji` when nothing usable is left), a sticker with `_` and `-` read as spaces ("Sticker" when nothing usable is left), and made free in the space (`name_2`, `name (2)`; `freeExpressionName`). They go one after another, only as many as there is room for, and a batch stops at a refusal every later picture would meet (`rate_limited`, `storage_limit_reached`, `disk_full`, a full space, `missing_permission`). An entry can be renamed in place, a sticker given a description for screen readers, and either removed after a confirmation. From 24 entries a field finds them by name. A space with none offers "Get from Discord".
- **Get from Discord** (`DiscordMovePanel`), for MANAGE_ROLES and MANAGE_CHANNELS, or MANAGE_EMOJIS: the template import (moved here from Overview), the emoji and sticker import, and a text that tells the Discord server's people where the community went. Each part shows for whoever holds what its routes check ([spaces.md](spaces.md)).

`spaceSettingsTabs.ts` decides which tabs a person may open, for the settings window and for the phone's settings button alike. The button shows when any tab beyond the person's own settings is allowed, so a member who may manage only the emoji finds the way in. The server checks every request on its own.

The library is edited in the Emoji tab of a person's own settings (`EmojiSettingsPanel`; [admin.md](admin.md), "Emoji").

## When things go away

- **A space's emoji removed:** the row and its file go at once. Messages that used it show the `:name:` their text carries.
- **A space's sticker removed:** only the row. Its asset is shared and content-addressed, so it stays while a collection, another space's entry, a message or a reaction on this instance names it, and messages that show it keep showing it. Once nothing does and its 24-hour grace has passed, the sticker janitor removes it (`cleanupUnusedStickerAssets`, [uploads.md](uploads.md#14-personal-stickers), "Storage and cleanup"). `getReferencedStickerIds` counts `space_stickers.sticker_id`; it must, since that foreign key would make deleting the asset's row fail.
- **A space deleted:** its rows go by cascade, and `deleteSpaceCompletely` removes its emoji files (`removeEmojiFiles`). Its stickers' assets are left to the janitor.
- **Files no emoji names:** `removeUnusedEmojiFiles` removes pictures in `UPLOAD_DIR/emoji` that no row of either kind names, left by a deletion that stopped between the row and the file, or an add that stopped between the file and the row. At start every such file goes; the hourly storage janitor leaves those younger than an hour, whose row may still be on its way in.
- **An account deleted:** `tombstoneUser` clears `created_by` in `space_emojis`, `space_stickers` and `custom_emojis`. The entries stay, since they belong to the space or the instance, and their size then counts on no one. Before 1.34 the library's column kept the id: its `ON DELETE SET NULL` never fires, because a tombstone keeps the `users` row.
- **The personal export** holds what a person added: library emoji as `files/emoji/<name>.webp`, a space's emoji as `files/space-emoji/<spaceId>-<name>.webp`, a space's stickers as `files/space-stickers/<spaceId>-<id>-<name>.webp` (the entry's id; the name is made safe before the ids go in front, so a slash cannot cut them off), and personal stickers in `files/stickers/`. The README says so.

## From Discord

Whoever may manage a space's emoji can bring a Discord server's emoji and stickers over in "Get from Discord": they give the server's id and the token of a bot of their own that is on that server. The server uses the token for exactly two requests to Discord's API (the server's emoji, then its stickers) and never stores, logs or returns it. It then fetches the pictures from Discord's content servers without the token, at most 8 per request, and adds each through the same `addSpaceEmoji` and `addSpaceSticker` as an upload, with `discord_id` set. So what is said above holds for it: the right is asked again before every picture, the pictures count on the importer's storage, and a second import skips what came before. The per-minute and per-day upload limits do not apply; the import is bounded by its batches and limits of its own. An import that brought anything writes `discord_expressions_import` in the audit log once, with how many emoji and stickers came (`targetType` `space`, changes `emoji` and `stickers`); the single pictures are not recorded as `emoji_create` or `sticker_create`. A batch that brought anything sets `spaces.discord_imported_at`.

The rest, from the planning of names to the handling of the token and the client's batches: [spaces.md](spaces.md), "Importing emoji and stickers from Discord".

## Privacy

The privacy draft (`utils/legalTemplates.ts`, German and English) says in section 4 that emoji and stickers someone adds to a space are available to its members, that who added them is stored and that they count on that person's storage, and that a space's emoji can appear in messages anywhere on the instance, with its picture fetchable at its address by anyone. Section 9 names the requests to Discord: the template's code, or the server's id and the person's own bot token, used for that request only and neither stored nor logged; of the answer only the names, pictures and Discord ids of what came over, not who uploaded them; the pictures fetched by the server, so Discord sees the server and not the person. An operator has to publish the draft again for this to reach anyone ([legal.md](legal.md)).

## Known limits

- **The picture route is public.** A private space's emoji are not secret: anyone who has an id can fetch the picture, and an id is a snowflake, not a secret. The privacy draft says so.
- **Who sends a space's sticker cannot be held on the server.** A sticker token names a content-addressed asset, the same for every collection and space that holds the picture, so the server cannot tell from which set it was picked; it asks only where the file lives (`mayPostSticker`). A member can also take a space's sticker into their own collection and send it from there.
- **`GET /api/emojis/available` grows with membership.** One answer holds every space a person is in on the instance, without pages. That is why it is not in `ready` and is read per instance only when needed.
- **A reaction pill in a direct message is drawn from its first reactor's home.** `emoji:<id>` is the same text whoever reacts, so two people of different homes who react with an id of their own home share one pill and one count, drawn from the first one's home.
- **A sticker's description stays in the space's settings.** A sticker in a message is drawn from its token, which names only the picture: a screen reader hears "Sticker" there, and the sticker's name in the picker.
- **An alias belongs to the offer of its moment.** `:wave~2:` names the second emoji called `wave` in the sets on offer when the text is sent. If a set earlier in the order gains or loses a `wave` between picking and sending, the alias can name the other one, or none (then it stays text).
- **An instance older than 1.34** has no `GET /api/emojis/available`: its emoji are drawn in its channels, but none are offered to pick there.

## Tests

On the server: `routes/spaceExpressions.test.ts` (lists, adds, limits, storage, the picture queue, stickers and their assets, the file sweep), `utils/emojiUse.test.ts` (direct messages, forwards), the "custom emoji of a space" part of `routes/channelsMessages.errorCodes.test.ts` (messages, edits, reactions), `routes/stickers.test.ts` and `utils/userDeletion.scrub.test.ts`. In the client: `EmojiPicker.customEmoji.test.tsx`, `ReactionPill.customEmoji.test.tsx`, `MarkdownRenderer.customEmoji.test.tsx`, `InlineMessageText.test.tsx`, `utils/emojiWire.test.ts` and `EmojiSettingsPanel.test.tsx`.
