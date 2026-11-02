# Tokens

Every request carries the bot's token:

```http
Authorization: Bot <token>
```

On the socket, the first thing you send is the same token:

```json
{ "type": "auth", "token": "Bot <token>" }
```

## Keeping it safe

Whoever has the token acts as your bot, in every space it is in.

- It is shown once, when it is made. Tavvit keeps only a hash of it, so nobody can show it to you again, us included.
- Keep it in an environment variable or a secret store, and out of your code and your repository.
- If it got out, press **New token** in the [portal](/developers/bots). The old one stops at once and a running bot is disconnected.
- Never ask someone else for their account's password or sign-in. A bot has its own account for a reason, and driving a person's account by a program is [not allowed](/developers/docs/conduct).

## What a token opens

[The routes on this list](/developers/docs/rest) and nothing else. Anything else answers:

```json
{ "error": "This is not open to bots", "code": "bot_route_forbidden", "statusCode": 403 }
```

A bot is never an instance administrator, and can never be given the `ADMINISTRATOR` right in a space. It has no direct messages and no friends.

## When it stops working

| Code | Status | What happened |
|---|---|---|
| `bot_token_invalid` | 401 | The token is wrong, was replaced, or the bot was deleted |
| `bots_disabled` | 403 | The instance's operator turned bots off |
| `bot_owner_suspended` | 403 | The account that runs this bot is suspended or gone |
| `account_suspended` | 401 | The bot itself was suspended |

All of these are checked on every request. A connected socket is told and closed with code `4001` within about half a minute. Reconnect with a delay rather than in a tight loop: a token that was refused will be refused again.

## One bot, one owner

A person can run up to five bots. They answer for what those bots do, so a bot stops when its owner is suspended, and goes when its owner's account goes.
