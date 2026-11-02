# Saved messages and keywords

Two things that are only ever about one person: the messages they want to find again, with a reminder if they want one, and the words that alert them.

**Files:** `packages/shared/src/saved.ts`, `packages/shared/src/notificationRules.ts`, `packages/server/src/routes/saved.ts`, `packages/server/src/routes/keywords.ts`, `packages/server/src/utils/savedReminders.ts`, `packages/web/src/stores/savedStore.ts`, `packages/web/src/stores/keywordStore.ts`, `packages/web/src/components/inbox/SavedList.tsx`, `packages/web/src/components/inbox/KeywordMatches.tsx`, `packages/web/src/components/modals/settingsPanels/KeywordsSection.tsx`, `packages/web/src/utils/reminderTimes.ts`.

## Saved messages

`saved_messages` holds one row per person and message, with `message_id` or `dm_message_id`. Both cascade, so a deleted message leaves the list. At most `SAVED_LIMITS.PER_ACCOUNT` (500) per account (`saved_limit_reached`).

| Route | Rule |
|-------|------|
| `GET /api/saved?before=` | A page of those the person can still see, the latest saved first. |
| `GET /api/saved/ids` | All of them, for the message menu to say "Remove from Saved". |
| `PUT /api/saved/messages/:id`, `/api/saved/dm-messages/:id` | Save it. What the person cannot see answers the same 404 as what does not exist. `{ remindAt }` sets a reminder within a year, `null` clears it, and leaving it out keeps what was there. |
| `DELETE` the same | Take it off the list. |

**Sight is asked each time, not at saving:** `savedItemOf` checks `VIEW_CHANNEL` and `READ_MESSAGE_HISTORY` for a channel, membership for a conversation. Someone who left keeps the row but sees nothing of it, and it comes back if they do. A page reads on past rows like that, for a few rounds, and says where to go on from when it stops early.

`saved_changed` tells the person's other devices over the socket.

### Reminders

The menu's "Remind Me" offers four times (`utils/reminderTimes.ts`: an hour, three hours, tomorrow at nine, a week on at nine, on the person's own clock). `utils/savedReminders.ts` looks once a minute for what is due, marks it first so it comes once, and asks again whether the person can see the message: someone who left the space hears nothing of it. Otherwise: `saved_reminder` over the socket, with a preview made by `pushBodyOf` (so no ids, no spoiler), which becomes a toast and in an unfocused window a notification; and a push (`pushSavedReminder`, [push.md](push.md)), whose words follow the device's own "hide the text" setting. Setting a reminder again after it came works.

A server that was down at the moment says it once it is back: unlike an event, a reminder does not lose its point.

## Keywords

`notification_keywords` holds up to `KEYWORD_LIMITS.MAX` (25) words per account, cleaned by `cleanKeyword`: trimmed, spaces folded, lowercase, 2 to 50 characters. `GET` and `PUT /api/users/@me/keywords`, the whole list each time, in the person's order.

**One rule.** `matchesKeyword` in `shared/src/notificationRules.ts` is read by `isMessageAlert`, so sound, notification and push cannot disagree. A hit counts as a mention: it alerts in a channel set to mentions, and never where the person chose `nothing` or muted. It matches whole words in any case, in any alphabet, outside code: "raid" finds "Raid?" and not "afraid". In a script written without spaces (Han, Kana, Thai) there are no whole words to go by, so there the word is found anywhere.

The message is highlighted like a mention (`data-mentioned`).

`GET /api/users/@me/keyword-matches` lists the hits in the inbox through the same scan as the mentions (`readerMessagesPage` in `routes/inbox.ts`): only spaces the person is in, only channels they may read, never their own. A `LIKE` prefilter narrows it down as the channel search does, then the shared rule decides. So history with a word in a different case of a non-Latin alphabet may be missed there; the alert itself is not affected.

## Federation

Saved messages live on the instance that holds the message, so the client asks each connected origin (`savedKey` includes the origin), and nothing crosses to a peer.

Keywords are kept on the person's home instance. The client reads them from there and applies them to messages from every instance for sound, notification and highlight. A push and the inbox list come from the instance holding the message, which knows only its own account's words, so a space on another instance gets neither. This is the same limit push has anyway ([push.md](push.md), "Limits").

## Privacy

Nobody else sees any of this. Deleting an account removes both tables' rows (`tombstoneUser`), and the personal export lists them (`saved-messages.jsonl`, `notification-keywords.jsonl`).
