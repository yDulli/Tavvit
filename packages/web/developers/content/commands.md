# Commands

People type `/` in the composer and get what the bots in that channel answer to. A bot has to be connected to [the socket](/developers/docs/socket) to hear them.

## Telling Tavvit what it answers to

Each time it starts, all of them at once:

```http
PUT /api/bots/@me/commands
```

```json
{
  "commands": [{
    "name": "roll",
    "description": "Roll dice",
    "options": [
      { "name": "dice", "description": "Such as 2d6", "type": "text", "required": true },
      { "name": "private", "description": "Show it to me alone", "type": "boolean" }
    ]
  }]
}
```

{{commandLimits}}

Names are lowercase letters, digits, `_` and `-`. People see a command in a channel where the bot can see and write.

## Options

A command with options opens a form for whoever picks it, and the instance checks what they put there before you hear of it. You can rely on what reaches you.

| `type` | Asks for | You get |
|---|---|---|
| `text` | Words, or one of `choices` if you give up to 25 of them | A string |
| `number` | A number | A number |
| `boolean` | A switch | `true` or `false` |
| `person` | A member of this space | Their id |
| `channel` | A channel of this space the person can see | Its id |
| `role` | A role of this space | Its id |

An option left empty is not there at all.

## Being asked

```json
{
  "type": "command_invoked",
  "name": "roll",
  "args": "",
  "options": { "dice": "2d6" },
  "interactionId": "375271229083086848",
  "channelId": "…",
  "spaceId": "…",
  "user": { "id": "…", "username": "noor", "displayName": "Noor" }
}
```

A command without options gets whatever followed its name as `args`: `/roll 2d6` gives `"2d6"`.

A person asking while the bot is not connected is told it is not running, with `bot_offline`.

## Answering

```http
POST /api/interactions/<interactionId>/reply
```

```json
{ "content": "You rolled 4", "ephemeral": true }
```

Within 15 minutes of being asked, up to five times, and only while the bot may still write in that channel. Only the bot that was asked can answer. A restart of the instance ends what was open, and the answer is then `interaction_not_found`.

- **In the channel:** without `ephemeral` it is an ordinary message of the bot, with everything a message has to pass. You get 201 and the message.
- **For the person alone:** with `"ephemeral": true` it reaches the person who asked and nobody else, and it alerts nobody. It is stored nowhere and is gone when they reload, and they are told so. You get 200 and `{ "ephemeral": true }`.

An answer takes `content`, [`cards`](/developers/docs/cards) or both. It takes no files, so no picture in a card either.

Nothing is ever posted in the person's name. Writing in the channel the usual way works as well.
