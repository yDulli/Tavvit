# Socket events

The socket is how a bot hears what happens. A bot that only posts does not need it.

## Connecting

Open a WebSocket to `wss://your.instance/ws` and send, within ten seconds:

```json
{ "type": "auth", "token": "Bot <token>" }
```

The answer is `ready`, with `user` and the `spaces` the bot is in, then events as they happen. Anything else as the first message, or nothing within the ten seconds, gets an `error` event and the socket is closed.

## Keeping it alive

The instance pings every socket every 30 seconds, as the WebSocket protocol has it, and every library answers that by itself. A socket that does not answer is closed.

To notice a dead connection on your own side, send `{ "type": "ping" }` every 30 seconds or so. The answer is `{ "type": "pong" }`. If none comes, connect again.

## What it hears

Everything for the spaces it is in and the channels it can see. **Skip what you do not know**: new kinds of event come along, and they are not breaking changes.

| Event | Fields | When |
|---|---|---|
| `message_created` | `message` | Someone wrote, the bot included |
| `message_updated` | `message` | A message was edited |
| `message_deleted` | `messageId`, `channelId` | A message was deleted |
| `typing` | `channelId`, `userId`, `username` | Someone is typing |
| `reaction_added` | `messageId`, `reaction` | A reaction was added |
| `reaction_removed` | `messageId`, `userId`, `emoji` | A reaction was taken back |
| `member_joined` | `spaceId`, `member` | Someone joined |
| `member_updated` | `spaceId`, `member` | A member changed, their roles for one |
| `member_left` | `spaceId`, `userId` | Someone left or was removed |
| `channel_created`, `channel_updated` | `channel`, `spaceId` | A channel came or changed |
| `channel_deleted` | `channelId`, `spaceId` | A channel went |
| `space_updated` | `space` | The space changed |
| `command_invoked` | `name`, `args`, `options`, `interactionId`, `channelId`, `spaceId`, `user` | Someone asked it something; see [commands](/developers/docs/commands) |

**A bot sees its own messages come back too.** Check `message.userId` before answering, or it will talk to itself.

## What it can say

Besides the ping, only these. Anything else is answered with an `error` event coded `bot_route_forbidden`. To write, delete or moderate, use the [REST API](/developers/docs/rest).

{{socketSends}}

## Staying connected

When its token changes, its owner is suspended or the operator turns bots off, the socket is told why and closed with code `4001`:

```json
{ "type": "error", "message": "This bot is suspended", "code": "account_suspended" }
```

Any other close is worth trying again. Reconnect with a delay, not in a tight loop, and send the auth again: each socket starts over. Nothing that happened while it was away is sent later, so read the [history](/developers/docs/rest) if you need it.
