# Limits

## Requests

{{botLimits}}

On top of that, each route has its own limit per address, and writing a message takes at most 5 in 5 seconds. Bots on one host share that address's limit for writing. Socket events have a limit of their own, shared across a bot's sockets; over it you get an `error` event saying `Rate limited`.

## How it is told

Every answer to a bot says where it stands in its minute:

| Header | What it says |
|---|---|
| `X-RateLimit-Limit` | How many requests a minute it has |
| `X-RateLimit-Remaining` | How many are left of this minute |
| `X-RateLimit-Reset` | Seconds until the minute starts over |

Over a limit the answer is 429 `rate_limited`, with `Retry-After` in seconds. **Wait that long.** A bot that keeps asking only stays over it.

## Sizes

{{sizeLimits}}

## Commands and cards

{{commandLimits}}

{{cardLimits}}
