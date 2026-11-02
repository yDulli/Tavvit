# Webhooks

For a build server, a monitor or a script. You do not need to run anything, or to make a bot. It only goes one way: Tavvit never calls a program of yours.

## Making one

In a channel's settings, under **Webhooks**. It takes the `MANAGE_WEBHOOKS` right in that channel. You get an address:

```text
https://your.instance/api/webhooks/<id>/<token>
```

Shown once. Whoever has it can post, so treat it like a password. If it got out, make a new token there, and the old one stops at once.

## Posting

```bash
curl -X POST https://your.instance/api/webhooks/<id>/<token> \
  -H "Content-Type: application/json" \
  -d '{ "content": "Deploy finished" }'
```

The answer is 201 with `{ "id": "<message id>" }`.

| Field | What it is |
|---|---|
| `content` | The words, or `text` as some senders write it |
| `cards` | [Cards](/developers/docs/cards), without pictures: a webhook has nothing to attach |
| `embeds` | Instead of cards, Discord's form |

Words, cards or both. The body may be up to 32 KB.

## Programs that speak Discord's form

Many programs can already post to a Discord webhook, and nothing else. Give them this address instead:

```json
{
  "content": "New alert",
  "embeds": [{
    "title": "CPU high",
    "description": "Above 90% for 5 minutes",
    "url": "https://monitor.example/1",
    "color": 16711680,
    "fields": [{ "name": "Host", "value": "web-1", "inline": true }],
    "footer": { "text": "Monitor" }
  }]
}
```

Title, description, address, colour, fields and footer become a card. Everything else is left out, above all any picture at an address elsewhere, since every reader would ask that server for it. A `username` or `avatar_url` from the sender is ignored too: the name is the webhook's own.

## What holds

- **It alerts nobody.** `@everyone` and mentions are plain words.
- **It meets the space's automatic rules** like anyone's words. Timeouts and slow mode are about members, and a webhook is none.
- **No link in it is fetched** for a preview.
- **Limits:** 30 posts a minute for one webhook, and 120 requests a minute from one address. Over them you get 429 with `Retry-After`.
- **What it posted stays** when the webhook is deleted.
- **Only text and announcement channels** take one, not voice channels, forums or threads. Up to 10 a channel and 50 a space.
