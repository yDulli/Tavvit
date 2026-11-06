# Push to a closed app

A browser hands out an address at a push service. The server sends there what only that browser can read, and the service wakes the browser's service worker, which shows a notification. This is what reaches a phone whose app is closed. There are no native apps; on an iPhone or iPad it takes the app on the Home Screen, from iOS 16.4.

**Files:** `packages/shared/src/push.ts` (the list of services, limits, wire types), `packages/shared/src/notificationRules.ts` (the alert rule), `packages/server/src/utils/webPush.ts` (encryption and signing), `packages/server/src/utils/pushDelivery.ts` (who gets what, the queue), `packages/server/src/routes/push.ts`, `packages/web/public/sw-push.js`, `packages/web/src/utils/pushSubscription.ts`, `packages/web/src/components/PushController.tsx`, `packages/web/src/components/modals/settingsPanels/PushSection.tsx`.

## Who gets a push

The same rule as the sound and notification of an open client: `isMessageAlert` lives in `shared/src/notificationRules.ts` and both read it, so they cannot come to different answers. On the server, for one message:

1. Only accounts with a device (`push_subscriptions`). For a space, those in the space.
2. Not the author, nor a system line (a poke, a pin).
3. Not while a window of that account is in front of someone (`client_focus`, below).
4. Not an account that is deleted, of another instance, suspended, or on Do Not Disturb.
5. Not someone who blocked the author.
6. In a space: only with VIEW_CHANNEL, and `isMessageAlert` with `notification_settings` and the space's default (`resolveChannelNotificationPolicy`), the member's roles and the stamped mass mentions.
7. In a conversation: not a device that turned direct messages off (`direct_messages`).
8. No second push for the same person in the same place within 3 seconds.

A DM call that starts ringing sends one push saying who calls, with a short lifetime (`pushDmCall`).

**Where it starts.** Every new channel message passes `connectionManager.sendToChannel` with `message_created`, whichever route made it, so polls and forwards need nothing of their own. Conversations: `broadcastDmMessage` and the relay's `processCreateEvent` (only `live`, not a catch-up pull). The work runs in `setImmediate` and a failure there is logged and goes no further: it never touches the path of the message.

**Focus.** The client sends `client_focus` when its window comes to the front or leaves it, and at `ready`. `connectionManager.isUserFocused` holds this per socket. Someone at the desk gets no push on their phone; a desktop app in the background counts as not looking. A socket that never said counts as not looking.

### Threads and reminders

A message in a thread pushes only to those who follow it, by their level for it (`followedThreadLevel`), and leads to it through its channel (`?thread=`). An event someone is going to pushes once shortly before it starts ([events.md](events.md)), under the same conditions as a message: not suspended, not on Do Not Disturb, no window of the account in front.

### Keywords and saved messages

A word a person watches alerts like a mention, through the shared rule ([saved.md](saved.md)). A reminder for a saved message pushes once when it is due, if they can still see the message, leading to it. A voice message says so instead of "Sent a file".

## What a notification says

`pushBodyOf` makes one short line in the device's language: names instead of ids, no Markdown marks, a mask for a spoiler, a fixed word for a sticker or a file. A device with "show message text" off gets a fixed word only. These words are in `pushDelivery.ts`, not the catalogs: the server has no i18n.

The payload (`PushPayload`) is `{ title, body, tag, url }`. The same `tag` replaces the notification before it. `url` is a path in this app.

`public/sw-push.js` shows whatever arrives, because a browser takes a push that shows nothing as a reason to stop delivering them. A tap focuses an open window and tells it where to go (`tavvit-open`, handled by `PushController`) or opens one. It only ever goes to a path in this app.

While streamer mode is on on this device (streamer-mode.md), the page leaves fixed words in IndexedDB (`tavvit-device`, store `flags`, key `streamerMode`: `{ title, body }` in the person's language), and `sw-push.js` shows those instead of the push's own: a push arrives exactly while someone streams another program, and a stream captures the screen. Anything unreadable there counts as not set. The tap still leads where the push said.

## Security

- **SSRF.** The address comes from the client and the server posts to it. `isPushServiceAddress` takes only `https`, no port, no credentials, and a host on a fixed list: `fcm.googleapis.com`, `updates.push.services.mozilla.com`, `web.push.apple.com`, `*.push.apple.com`, `*.notify.windows.com`. The list is checked when a device registers, and `sendWebPush` uses `redirect: 'error'` so a service cannot point it elsewhere. A new browser's push service is not reachable until it is added here.
- **Encryption.** RFC 8291 (aes128gcm) with fresh keys and salt per message, checked in `webPush.test.ts` against the worked example of the RFC, byte for byte. A push service sees the size, the time and the device's address, never the words.
- **Signing.** RFC 8292 (VAPID), ES256, good for 12 hours, with the instance's origin as subject. The key pair is in `push_keys`, a table of its own so no settings route can hand it out. It is made when first needed; `.env` holds nothing. Losing it only asks each device to register again.
- **Ending.** `push_subscriptions.session_id` cascades: ending a session (sign out, password change, suspension) removes its device. A device registered with a token from before sessions has none, and goes when the browser unsubscribes on sign-out. `tombstoneUser` removes an account's devices.
- **One browser, one person.** The address is unique: whoever signed in on a browser last is who it is for. Whether push is on is kept in `localStorage` per account (`tavvit-push:<id>`), and a subscription another account left behind is dropped at the next start, not inherited.

## Delivery

An in-memory queue, 8 at once. `201` is success; `404` and `410` remove the device; anything else counts a failure, and 20 in a row remove it. Nothing is retried: a push service keeps the message itself for the lifetime it was given (a day for a message, 30 seconds for a call). A restart loses what is queued.

## Limits

- **Other instances:** a device registers at its account's home (`requireLocalUser`), and a browser holds one subscription per service worker. Messages in a space on another instance bring no push. A conversation comes through the relay, so it does.
- **A browser's own limit:** a user who has never opened the app again after an update keeps the old worker until the update applies.
- **Not testable here:** the way through a real push service. An automated Chrome cannot subscribe (`permission denied`, or a crash with a real profile). Tested here: the encryption against the RFC, the signature, the rule, the routes, what the worker shows and where a tap goes. Needs a real device: everything from subscribing to the notification appearing.
