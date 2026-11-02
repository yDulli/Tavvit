# Cards

Besides `content`, a message from a bot or a webhook can show cards.

```json
{
  "content": "The nightly build is done.",
  "cards": [{
    "title": "Build passed",
    "url": "https://ci.example/runs/42",
    "text": "All **12** tests are green.",
    "color": "#34c77b",
    "fields": [
      { "name": "Branch", "value": "main", "inline": true },
      { "name": "Took", "value": "4 min", "inline": true }
    ],
    "footer": "CI"
  }]
}
```

## What a card holds

| Field | What it is |
|---|---|
| `title` | Shown in bold |
| `url` | Where the title leads, `http` or `https` |
| `text` | Markdown |
| `color` | The card's edge, as `#rrggbb` |
| `fields` | A list of `{ name, value, inline? }`. Inline fields stand beside each other |
| `footer` | Small, at the end |
| `imageAttachmentId` | A picture: the id of one of the message's own attachments. See [files](/developers/docs/files) |

A card needs a title, text, fields or a picture. A field it does not know is dropped.

{{cardLimits}}

## Nothing is fetched

A picture must be one of the message's own uploads, and a link is only a link. So a card cannot track who reads it, and cannot make the instance or anyone's browser call an address. There is no field for a picture elsewhere.

## Nothing alerts

Nobody is alerted by what a card says, whatever it says: `@everyone` and mentions in it are plain words. To alert someone, mention them in `content`, with the right to do so.

Everything in a card meets the space's automatic rules, as if it were written in the message.

## Where only words fit

A message with cards and no `content` keeps the first card's title, text or first field's name as its content. So a notification, the inbox and search show that, and you need do nothing for it.

## Changing them

```http
PATCH /api/messages/<id>
```

```json
{ "cards": [{ "title": "Build failed", "color": "#e5484d" }] }
```

`"cards": null` takes them away. Words the bot wrote itself stay until it changes them.

A person cannot send cards, so a card can never pass for someone speaking for the instance. Answers to [commands](/developers/docs/commands) and [webhooks](/developers/docs/webhooks) take them too, without a picture: they have nothing to attach.

A card that will not do is refused as a whole with 400 `cards_invalid`, and `details.field` says where, such as `cards[0].color`.
