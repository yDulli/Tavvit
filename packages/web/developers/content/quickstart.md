# Quickstart

## 1. Make the bot

Open the [developer portal](/developers/bots), give your bot a name and press **Create**. Copy the token. It is shown only this once, and whoever has it acts as your bot, so keep it like a password and out of your code and your repository.

## 2. Bring it into a space

The bot's page shows an address, and lets you tick what the bot asks for. Open that address yourself, or give it to whoever runs the space: it takes the `MANAGE_SPACE` right. They pick the space, see what the bot asks for, and add it.

## 3. Find a channel

Put the token in your shell, so the commands below can be copied as they are:

```bash
export TAVVIT_TOKEN='<your token>'
```

Ask which spaces the bot is in:

```bash
curl https://your.instance/api/bots/@me \
  -H "Authorization: Bot $TAVVIT_TOKEN"
```

Take a space's `id` from the answer, and ask for its channels:

```bash
curl https://your.instance/api/spaces/<space id>/channels \
  -H "Authorization: Bot $TAVVIT_TOKEN"
```

## 4. Say something

```bash
curl -X POST https://your.instance/api/channels/<channel id>/messages \
  -H "Authorization: Bot $TAVVIT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "content": "Hello from my bot" }'
```

There it is, marked as a bot. That mark cannot be turned off.

The same in JavaScript, with nothing to install:

```js
const response = await fetch('https://your.instance/api/channels/<channel id>/messages', {
  method: 'POST',
  headers: { Authorization: `Bot ${process.env.TAVVIT_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ content: 'Hello from my bot' }),
});
console.log(response.status, await response.json());
```

And in Python, with nothing to install:

```python
import json, os, urllib.request

request = urllib.request.Request(
    "https://your.instance/api/channels/<channel id>/messages",
    data=json.dumps({"content": "Hello from my bot"}).encode(),
    headers={"Authorization": "Bot " + os.environ["TAVVIT_TOKEN"], "Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(request) as response:
    print(response.status, json.load(response))
```

## 5. Listen

To answer people it has to hear them, which takes the socket:

```js
const socket = new WebSocket('wss://your.instance/ws');

socket.addEventListener('open', () => {
  socket.send(JSON.stringify({ type: 'auth', token: `Bot ${process.env.TAVVIT_TOKEN}` }));
  setInterval(() => socket.send(JSON.stringify({ type: 'ping' })), 30_000);
});

socket.addEventListener('message', (incoming) => {
  const event = JSON.parse(incoming.data);
  if (event.type === 'message_created') console.log(event.message.content);
});
```

A bot sees its own messages come back too, so check `message.userId` before answering, or it will talk to itself.

## Where next

- The whole [example bot](/developers/assets/example-bot.mjs): `TAVVIT_URL=https://your.instance TAVVIT_TOKEN=<token> node example-bot.mjs`. It needs Node 22 or later.
- [Commands](/developers/docs/commands), so people can ask it things.
- [Cards](/developers/docs/cards), to show more than text.
- [Rules for bots](/developers/docs/conduct), before you bring it to other people's spaces.
