# Permissions

A bot joins a space with a role of its own, holding the rights the address asked for, on top of what every member has through `@everyone`.

Whoever adds it can only give rights they hold themselves, and never `ADMINISTRATOR`. The space can change that role, or kick or ban the bot, like any member.

## The address

```text
https://your.instance/bots/<bot id>/add?permissions=<number>
```

`permissions` is the sum of the rights you want, as a decimal number. The [portal](/developers/bots) builds this address for you when you tick them, and the calculator below does the same.

Ask for what you need and no more. People read that list before they say yes.

## How a right is decided

The same way as for a person:

1. The space's owner can do everything. A bot is never the owner.
2. `ADMINISTRATOR` can do everything. A bot never holds it.
3. Otherwise the bot's rights are those of `@everyone` and of its role together.
4. In a channel, the overrides of its category and of the channel itself come on top.

A refusal says which right was missing:

```json
{ "error": "Missing SEND_MESSAGES permission", "code": "missing_permission", "statusCode": 403, "details": { "permission": "SEND_MESSAGES" } }
```

## The order of roles

A bot can only moderate people, and hand out roles, below its own role. Its role starts at the bottom, so it acts on nobody until whoever runs the space moves it up. Nobody can act on the owner.

## Every right

{{permissions}}
