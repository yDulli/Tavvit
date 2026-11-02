# Errors

Every refusal is JSON of the same shape:

```json
{
  "error": "Missing SEND_MESSAGES permission",
  "code": "missing_permission",
  "statusCode": 403,
  "details": { "permission": "SEND_MESSAGES" }
}
```

**Go by `code`.** It is stable. `error` is English for a person reading a log and may change, and `details` holds what fills it in.

## The ones you will meet

| Code | Status | What to do |
|---|---|---|
| `bot_route_forbidden` | 403 | This route is not [open to bots](/developers/docs/rest), and will not become so by asking again |
| `missing_permission` | 403 | The bot lacks the right in `details.permission`. Ask whoever runs the space |
| `rate_limited` | 429 | Wait as long as `Retry-After` says. See [limits](/developers/docs/limits) |
| `bot_token_invalid` | 401 | The token is wrong or was replaced. See [tokens](/developers/docs/authentication) |
| `bots_disabled` | 403 | The instance's operator turned bots off |
| `cards_invalid` | 400 | `details.field` says which part of a [card](/developers/docs/cards) is wrong |
| `interaction_not_found` | 404 | The [command](/developers/docs/commands) cannot be answered any more |
| `storage_limit_reached` | 413 | Your [files](/developers/docs/files) take up all the room you have |

Messages can also meet a space's moderation: `slowmode_active` with how long to wait, or an `automod_*` code when its automatic rules refused the words.

## Every code

What the instance can answer with, across all of Tavvit. Most are about things a bot cannot do.

{{errorCodes}}
