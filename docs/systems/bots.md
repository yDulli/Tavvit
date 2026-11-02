# Bots

An account a person runs from a program, under what a space lets it do. For someone writing one, the guide is the public docs at `/developers` ([developers.md](developers.md)); this page is how it works and what must stay true.

**Files:** `packages/shared/src/bots.ts`, `packages/shared/src/cards.ts`, `packages/server/src/utils/botAccess.ts`, `packages/server/src/utils/botInteractions.ts`, `packages/server/src/routes/bots.ts`, `packages/server/src/routes/botFiles.ts`, `packages/server/src/utils/auth.ts` (`authenticateBot`), `packages/server/src/ws/handler.ts`, `packages/web/src/components/developers/BotPortalPage.tsx`, `packages/web/src/components/bots/BotInvitePage.tsx`, `packages/web/src/components/admin/BotsSection.tsx`, `packages/web/src/components/chat/CommandPopover.tsx`, `CommandOptionsForm.tsx`, `CommandReplies.tsx`, `MessageCards.tsx`.

## The security core

**Deny by default, in one place.** `Authorization: Bot <token>` is read only in `authenticate`. A route takes one only with `config: { botAllowed: true }`; every other route answers 403 `bot_route_forbidden`, whatever it does, so a route added tomorrow is closed to bots until someone decides otherwise. Routes that read `Bearer` themselves (the upload hook, the report form) simply do not recognize one.

**The list is a test.** `BOT_ROUTES` in `shared/src/bots.ts` holds every route open to a token, with what it does. `routes/bots.test.ts` registers the route modules, collects every route with `onRoute`, and compares those with `botAllowed` against that list. Adding a route to it is a decision, made in that list and in this page. The docs' reference is made from the list, so it cannot fall behind, and what they say about a route beyond that is written by hand in `packages/web/developers/content/`. It must never hold anything about accounts, mail, sign-in, two factors, admin, direct messages or friends; the test says so too.

The same holds on the socket. `{ type: 'auth', token: 'Bot <token>' }` opens one, and after that a bot may send only `BOT_SOCKET_EVENTS` (and the ping). What it hears is what any member hears: it has a `space_members` row and is told what its roles let it see.

**Checked each time, read fresh** (`checkBotAccess`): the instance's switch, the bot's own account (deleted, suspended), and its owner (deleted, suspended). So suspending a person stops their bots at the next request. An open socket is checked by `revalidateSockets` with the others, every 30 seconds.

**The token** is `<bot id>.<32 random bytes>`, shown once, kept only as a SHA-256 in `bots.token_hash`. A random token of this size needs no slow hash. The comparison is constant-time, and a wrong secret and an unknown bot answer the same 401. `verifyAccessToken` refuses any JWT that names an account that is not a person, so nothing else opens a bot's account, and a bot's token opens nothing a person's does.

**Never more than a person could give.** A bot joins a space through `POST /api/bots/:id/spaces/:spaceId`, by someone with MANAGE_SPACE. Its role can hold only bits that person holds (`roleBitsChangeRefusal`, the held-bits rule), and never ADMINISTRATOR (`bot_admin_forbidden`).

## The account

`users.account_kind = 'bot'`, with the same exclusions as a webhook's ([webhooks.md](webhooks.md), "Accounts that are not people"): it signs in with its token only, is in no list of people, is never an admin, and takes no messages or friend requests. The username is `bot-<id>`, which no person's name can be. Its name, shown as its name and as its role's in each space, follows the rule nicknames follow (`cleanName` in `routes/bots.ts`, with `isVisibleSingleLine`: at most 32, no control character or bidirectional override, something visible); one stored before loses those characters where it is shown (`nameOf`).

The mark comes only from the column: `User.accountKind`, the "Bot" tag at its messages, and the derived `bot` badge in its profile ([badges.md](badges.md)). Nothing a client sends can set or clear it.

Unlike a webhook it **is** a member: it has a `space_members` row, shows in the member list, and can be kicked or banned like anyone. Kicking keeps its role (`roles.bot_id`), so bringing it back gives it the same one, updated to what is asked for then.

It can moderate as well, under the routes in `BOT_ROUTES`: removing a member, bans and timeouts, with the same rights and the same order of roles as a person. Its role starts at the bottom, so a bot acts on nobody until whoever runs the space places it. The audit log names the bot.

A reaction goes by the socket or by `PUT` and `DELETE /api/messages/:id/reactions/:emoji`, which run the one set of rules in `utils/reactions.ts`: seeing the channel, `ADD_REACTIONS`, not being timed out.

A bot was let in on purpose, so the rules and ages a space sets for people arriving by themselves do not hold it back: `rules_accepted_at` is set when it joins, and `spaceMessageRefusal` skips the ages for it. Slow mode, automatic rules and channel permissions apply as for anyone.

## Who may do what

| Route | Rule |
|-------|------|
| `GET`, `POST /api/bots` | The owner: at most 5 (`bot_limit_reached`), and only if the instance allows bots. |
| `PATCH`, `DELETE /api/bots/:id`, `POST /api/bots/:id/token` | The owner. Someone else's bot answers 404. A new token sends a connected bot away. |
| `GET /api/bots/:id/public` | Anyone signed in: name, description, who runs it, and which spaces the person asking may bring it into. |
| `POST /api/bots/:id/spaces/:spaceId` | MANAGE_SPACE, as above. In the audit log (`bot_add`). |
| `GET /api/admin/bots`, `PUT /api/admin/bots/enabled`, `DELETE /api/admin/bots/:id` | Instance admins. Off by default. The last two are in the platform audit log. |

Retiring a bot (`retireBot`) deletes its row and its role and tombstones its account, keeping what it wrote. When the owner's account goes, `tombstoneUser` does the same for their bots: a program must not outlive the person who answers for it.

A bot can read and start a forum's posts (`GET`, `POST /api/channels/:id/posts`), under the rights a person needs. Tags and follows are left to people, for now: they arrange a space rather than speak in it. A bot in an announcement channel writes only where the channel's overrides let it, as anyone.

Translating a message is not open to bots either (`POST /api/messages/:id/translate`, [translation.md](translation.md)): it spends the operator's allowance at a provider, and a program can use its own.

## Commands

`bot_commands` holds what a bot answers to (`PUT /api/bots/@me/commands`, the whole list). A person's composer asks `GET /api/channels/:id/commands` once they type `/`, which lists the commands of bots in the space that can see and write in this channel, and `CommandPopover` offers them.

**Options.** A command can ask for up to 10 things (`BotCommandOption`): text, with or without fixed `choices`, a number, a switch, a person, a channel or a role. Picking such a command opens `CommandOptionsForm`, where the person chooses from the space's members, channels and roles. The server checks all of it before the bot hears of it (`cleanCommandInput`, then whether that person is a member, that channel is in this space and visible to whoever asked, that role is in this space), so a bot need not trust what reaches it. `command_option_invalid` names the option.

`POST /api/channels/:id/commands/:botId/:name` takes someone who may see and write there and is not held back, 10 in 10 seconds, and a bot that is there and connected (`bot_offline`). It sends `command_invoked` to the bot, with the person as `sanitizeUser` shows them to anyone, what they filled in, and an `interactionId`. What the composer holds is a message unless a bot here answers to it, so a slash means nothing special elsewhere.

**Answering.** `POST /api/interactions/:id/reply` (`utils/botInteractions.ts`) takes the bot that was asked and nobody else, for 15 minutes and up to 5 times, and only while it may still write in that channel. The ids live in memory, so a restart ends them. An answer takes words and cards, and no files.
- Without `ephemeral` it is an ordinary message of the bot (`postChannelMessage`), with every check a message has.
- With `ephemeral: true` it is `command_reply` to the sockets of the person who asked. Nothing stores it and nobody else hears of it; `CommandReplies` shows it above the composer and says so, and a reload ends it. The automatic rules still apply, and it names nobody: the words pass `withoutMentions`.

Nothing is ever posted in the person's name, and writing in the channel the usual way works as well.

## Limits

300 requests a minute per bot, across everything open to it (`botRequestLimit`), on top of each route's limit per address. Bots on one host share that address's limit for writing.

Every answer to a bot's request carries `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` (seconds) for that budget, and a refusal `Retry-After`. A route's own limit per address answers 429 the same way.

## Cards

What a bot or a webhook can show besides text (`shared/src/cards.ts`, `web/.../chat/MessageCards.tsx`): at most 5 to a message, in `messages.cards` as JSON. `cleanCards` is the one check, and `cardsFromBot` in `routes/messages.ts` adds that **only a bot's account may send them**: a person's words stay words, so a card can never pass for the instance speaking.

- **Nothing is fetched.** A picture is `imageAttachmentId`, one of the message's own attachments, so it needs no address elsewhere, cannot track anyone, and goes when the message goes. A title's `url` is a plain link, http or https. A field a sender adds beyond these is dropped.
- **Nothing alerts.** `withoutMentions` runs over every word in a card.
- **Everything passes the space's automatic rules**, as one text with the content.
- **The content stands for them.** A message with cards and no text keeps `cardsSummary` (the first title, text or field name) as its `content`. So search, the inbox, a push, a reply's quote and a client from before cards all work without knowing about them. `Message.tsx` shows the cards alone when the content equals that summary. An edit keeps words the bot wrote itself and replaces what only stood for its cards.

## Files

`POST /api/bots/@me/files` (`routes/botFiles.ts`) takes `multipart/form-data`, because a program can simply send again where a person's upload has to survive a dropped connection, and every HTTP library can send that. Past this point it is the pipeline of any upload (`utils/uploadFinalize.ts`). The instance's size for one file holds. Its storage is its owner's (`storageAccountOf`, [uploads.md](uploads.md), "Limits per account"): five bots do not make five times the room. A file no message names goes after the hour, like any upload nobody sent.

## The portal

`/developers/bots` and `/developers/bots/:id` (`web/.../developers/BotPortalPage.tsx`), behind the sign-in: making a bot, its picture and description, a new token, the invite address with rights to tick, what it registered, and where it is. `GET /api/bots/:id` answers its owner alone. A new token comes along in the history state of the page it leads to, which takes it out at once, so a reload cannot show it again. A picture is the owner's own upload, handled as a person's is (`profilePictureOf`), and never an address elsewhere: every member reading the bot would ask that server for it. Settings → Developers only leads here.

## Federation

A bot belongs to the instance it was made on and can only join spaces there. The invite page offers what that instance says, so only its own spaces, and nothing about a bot crosses to a peer. A member homed elsewhere sees its messages like any other, through that instance.

## Privacy

The draft says plainly that a bot is run by a third party and can see and pass on what is in the channels it may read, and the invite page says it before anyone adds one. A person's export lists the bots they run (`bots.jsonl`). Bot commands are not personal data: they belong to the bot, and go with it.
