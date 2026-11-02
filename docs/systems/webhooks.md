# Webhooks

An address that lets another program post into one text or announcement channel: a build server, a monitor, a script. Incoming only: the server calls nothing, so a webhook adds no way to make it fetch an address (no SSRF), and it has no outgoing side.

**Files:** `packages/shared/src/webhooks.ts`, `packages/server/src/routes/webhooks.ts`, `packages/server/src/utils/webhookAccounts.ts`, `packages/server/src/utils/neutralMentions.ts`, `packages/web/src/components/modals/WebhooksTab.tsx`.

## Accounts that are not people

`messages.user_id` must name an account, so each webhook has one: `users.account_kind = 'webhook'`, created with the webhook. `person` is the default, and the column is the base for bots later (`bot`). A channel that follows another has such an account too, of kind `follow` ([forums.md](forums.md), "Following"), under the same rules.

Such an account:

- **Cannot sign in.** Its password hash is `!`, which `verifyPassword` refuses; the login's `accountNamed` looks only among people; and `verifyAccessToken` refuses a token that names one, should one ever be signed.
- **Is in no list of people:** the user search, friend requests by name or id, the federation lookup, the admin user list and search, the dashboard's and overview's counts and active people, the accounts CSV, the startup summary, the first-admin choice in `ensureDefaults`, `tavvit-admin` by name. Its messages do count as messages.
- **Cannot be acted on as a person:** the admin's role, password and delete routes answer 404.
- **Takes nothing:** `dm_policy` and `friend_request_policy` are `nobody`, and its status is `offline`. It has no `space_members` row, so no member list, role or permission applies to it.
- **Has a username no person can hold:** `webhook-<id>`, since a person's name is `[a-z0-9_]`. So making one can never collide with an account.

`routes/webhooks.test.ts` tests all of this. **A new query that lists people has to say `account_kind = 'person'`.**

The client's mark "Webhook" at the message comes from `User.accountKind`, which `sanitizeUser` sets from the column and which only appears for an account that is not a person. The client offers no profile card or author menu for such an author.

## The address

`POST /api/webhooks/:id/:token`. The token is 32 random bytes in base64url. It is shown once, in the answer that made it (`WebhookWithToken`), and only its SHA-256 is kept in `webhooks.token_hash`. A random token of this size needs no slow hash. The comparison is constant-time, and a wrong token and an unknown id answer the same 404.

It is in the path because that is what other programs can be given, so it stays out of the logs: Fastify's `req` serializer logs `pathForLog(url)`, which turns it into `/api/webhooks/<id>/[token]`. An address that got out gets a new token with `POST /api/webhooks/:id/rotate`, and the old one stops at once.

## A post

Body: JSON, `{ "content": "…" }`, or `{ "text": "…" }` as some senders write it, with `cards` ([bots.md](bots.md), "Cards") or instead of them Discord's `embeds`, which many programs can already send: `cardsFromDiscordEmbeds` keeps the title, description, address, colour, fields and footer and drops every picture. Words, cards or both. At most `MAX_MESSAGE_LENGTH` characters and a 32 KB body. No attachments, so no pictures in a card, no reply, no name or avatar from the sender (no foreign image address is stored or shown), and no link in it is fetched for a preview.

1. **Limits:** 120 requests a minute per IP address (`@fastify/rate-limit`, before the token is known), and `POSTS_PER_MINUTE` (30) per webhook after the token proved good, so nobody without it can use up its limit. Over it: 429 `rate_limited`, `Retry-After: 60`.
2. **It pings nobody:** `withoutMentions` turns people, roles and `@everyone`/`@here` into plain words with a zero-width space after the `@`. The same function serves forwarded messages.
3. **Automod:** `automodRefusal` applies the space's word and link rules, refusing with the usual `automod_*` code. Timeouts, ages and slow mode are about members; a webhook has no member row.
4. **The message** is an ordinary row in `messages`, sent through `connectionManager.sendToChannel`: unread counts, thread followers, sounds and push see it like any other.

The answer is 201 with `{ id }`.

## Who may do what

Bit 19 `MANAGE_WEBHOOKS`, resolved in the channel with its overrides, together with `VIEW_CHANNEL`. It is not in the default for @everyone. Someone timed out, or still owing an answer to required rules, can neither make a webhook nor give one a new token, so a webhook is no way around being held back. Making, renaming, a new token and deleting are in the space's audit log (`webhook_create`, `webhook_update`, `webhook_delete`).

Limits: `PER_CHANNEL_MAX` (10) and `PER_SPACE_MAX` (50). Only a text or announcement channel takes one (`webhook_not_allowed`), so not a voice channel, a forum or a thread.

| Route | Rule |
|-------|------|
| `GET /api/channels/:id/webhooks` | The channel's webhooks, never a token or hash. |
| `POST /api/channels/:id/webhooks` | `{ name }`, at most 32 characters. The answer holds the token. |
| `PATCH /api/webhooks/:id` | `{ name }`. Its earlier messages carry the new name too: it is the account's display name. |
| `POST /api/webhooks/:id/rotate` | A new token. |
| `DELETE /api/webhooks/:id` | The address stops. What it posted stays. |
| `POST /api/webhooks/:id/:token` | Public: the post above. |

## When things go away

- **A webhook deleted:** its account goes too, unless messages still name it (`removeUnusedWebhookAccounts`).
- **A channel or space deleted:** the webhook goes by foreign key, and the account at the next deleted webhook or restart, which run the same sweep.
- **The person who made it deletes their account:** `tombstoneUser` clears `created_by`, and the webhook keeps working: it belongs to the channel.

## Federation

Channels live on their space's home instance, so a webhook does as well. The client takes the address's host from the channel's origin (`getChannelOrigin`). Nothing about a webhook crosses to a peer.

## Privacy

The draft says that whoever knows the address can post, and what is stored: name, who made it, when it was last used, a hash of the secret. A person's export lists the webhooks they made (`webhooks-made.jsonl`).
