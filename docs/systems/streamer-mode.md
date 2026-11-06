# Streamer Mode

While streamer mode is on, Tavvit keeps what is personal off the screen, for
someone who streams it or shares it in a call. It is this device's choice: kept
in this browser, never sent anywhere, and nothing about it changes what anyone
else sees. It came in 1.35.0.

Source files:
- State: `packages/web/src/streamer/streamerModeStore.ts` (`useStreamerModeStore`, `useStreamerMode`, `STREAMER_MASK`)
- What hides a value: `packages/web/src/components/ui/Sensitive.tsx` (`Sensitive`, `SensitiveBlock`, `useSensitiveText`)
- Beyond the page: `packages/web/src/components/StreamerModeController.tsx` (mounted next to `PushController` in both layouts of `AppLayout`)
- Pushes: `packages/web/src/streamer/pushMask.ts`, read by `packages/web/public/sw-push.js`
- Notifications: `maskNotifications` in `packages/web/src/platform/notifications.ts`
- The badge: `packages/web/src/components/layout/StreamerModeBadge.tsx`, in `TopBar`
- Settings: `packages/web/src/components/modals/settingsPanels/StreamerModeSection.tsx`, first section of Settings → Privacy
- Shortcut: action `toggleStreamerMode` (`stores/keybindStore.ts`, `hooks/useKeybinds.ts`, desktop `keybindPolicy.ts`)
- Desktop: `packages/desktop/src/streamingSoftware.ts`, IPC `streaming-watch` / `streaming-programs` (desktop.md, "Streaming Programs")

---

## On and off

| Field (`tavvit-streamer-mode` in `localStorage`) | Meaning |
|---|---|
| `on` | The mode is on. |
| `automatic` | In the desktop app, it may turn on by itself (default: allowed). |
| `bySoftware` | It is on because a streaming program started, so it goes off when that stops. |
| `programsRunning` (not kept) | What the desktop app last said; null before it has said, while nothing is watched, and outside the desktop app. |

- **By hand:** the switch in Settings → Privacy, or the shortcut (any keys the person binds in Keybinds; none by default). A change by hand clears `bySoftware`.
- **By itself** (`reportStreamingPrograms`): when OBS, Streamlabs or XSplit starts and `automatic` allows it, the mode goes on with `bySoftware`; when the program stops, a mode it turned on goes off. Turned off by hand while the program runs, it stays off until the program starts again; turned on by hand, the programs never turn it off.
- **Allowing it** while a program already runs turns it on at once, as a start would. **No longer allowing it** in the middle of a stream leaves it on, now as if set by hand: taking it off then is for the person to do.
- **After a restart**, a mode kept as `bySoftware` goes off at the desktop app's first word if the program closed meanwhile.
- What is kept is read safely: anything that is not as written is the mode off, and allowed to turn on by itself.

The controller asks the desktop app to watch only while `automatic` is on (`watchStreamingPrograms(true)`, and `false` when not), forgetting what it said when watching stops. A desktop app older than 1.35.0 has no such bridge; the settings then say it can turn on by itself in the desktop app, as in a browser. A change the desktop app made is said in a toast; a change made by hand is seen where it was made, except the shortcut, which says which way it went.

## What it hides

| What | Where | How |
|---|---|---|
| The account's email address | Settings → Security (address, pending address, password recovery line), the email banner at the top of the app (`EmailPromptBar`), the confirmation page (`VerifyEmailPage`) | dots |
| Invite links and codes | The invite dialog's link field, Space settings → Invites (each code; the own address with its field), the space audit log (`inviteCode`, `vanityCode`), the admin space detail (`/join/…`), the platform audit log, the Discord move's announcement text | dots, or the block; **Copy still copies the real one** |
| Registration invites | Admin → Registration: a token's end and the full token in its tooltip | dots; Copy still works |
| Connected instances | Settings → Connections, whole | block |
| Two-factor secrets | The QR code and the secret while setting it up; the recovery codes | block; **Copy and Download still work** |
| Where sessions are | Settings → Security (sessions and security activity), the admin view of an account | dots for the address; the device stays |
| Tokens | A bot's token (bot portal), a new webhook's address and its curl example | dots; Copy still works |
| Moderator notes | The admin view of an account: the notes and the field for a new one | block |
| What notifications say | Every notification of the open app (`sendNotification`), and pushes to this device (`sw-push.js`) | "Tavvit" / "You have a new notification." |

The settings list the same eight kinds (`StreamerModeSection`, `HIDES`).

There are no notes about people of one's own in Tavvit: the notes are the moderators'. A message, a name or an avatar is not hidden: the person chose to show the conversation.

### How a value is hidden

- **`<Sensitive>`** puts a row of dots in place of a value in a line of text, read out as "Hidden in streamer mode". The value is not in the page at all, not blurred: blurred text can be read back, and a page's text is what screen readers, extensions and the stream's capture all see.
- **`<SensitiveBlock>`** replaces something whole (a list, a code to scan, a form) with a note and **Turn off streamer mode**, for someone who needs to see it now (setting up two-factor sign-in while OBS runs).
- **`useSensitiveText()`** gives the value or the dots, for a sentence, a field or an attribute. A field shown so is read-only for as long.
- **Copying** reads the value the button was given, never the page, so it still works. The dots are the same length for every value (`STREAMER_MASK`), so not even a value's length shows.

A new screen that shows any of the kinds above wraps it the same way, and the table above gets its row.

### Notifications and pushes

`StreamerModeController` sets the words (`maskNotifications`) for as long as the mode is on: every notification of the open app then says only that there is one; a tap still leads to the conversation, which is not shown until the person goes there. The same words go to IndexedDB (`tavvit-device`, store `flags`, key `streamerMode`; `writePushMask`), which `sw-push.js` reads before it shows a push: the service worker shows pushes when no window of the app is in front (push.md, "Focus"), which is exactly while someone streams another program, and a stream captures the screen, not a window. The words are in the person's language, written by the page. Signing out leaves them: the mode is still on. On a phone, whose pushes are its own, nothing changes.

## The badge

While the mode is on, a violet badge at the right of the top bar says so (an active state of the app's own, design-system.md). A click opens the mode's settings rather than turning it off, so a stray click in the middle of a stream shows nothing it hides. In a compact window only its icon shows.

## What it does not do

- It does not hide anything from the server, other people, or other devices of the account.
- It does not hide what is on screen in a conversation, a member list or a profile.
- A screenshot or recording made before it was on is not touched.
