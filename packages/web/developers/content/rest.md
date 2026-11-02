# REST API

Every request goes to `https://your.instance` with `Authorization: Bot <token>`. Bodies are JSON unless a route says otherwise.

**This is the whole list.** Everything else answers 403 `bot_route_forbidden`. The list is what the server itself enforces: it is made from the same source, and a test holds the two together.

The same checks apply as for any member: the channel's permissions, slow mode, the space's automatic rules, and `MENTION_EVERYONE` for `@everyone`, `@here` and role mentions.

Pages of a channel's history take `?before=<message id>` or `?after=<message id>`, and `?limit=` up to 100. They answer a bare array, oldest first.

An emoji in an address is URL-encoded. Anything from 200 to 299 went well, and anything else is [a refusal](/developers/docs/errors).

{{routes}}
