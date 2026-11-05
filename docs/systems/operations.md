# Running an instance for many people

How to find out what a server can take, what the operator is warned about, and what people can read when something is wrong: the load test, the fan-out that came out of it, the bounds on picture work and what stays out of `ready`, warnings, backups with uploads, and the public pages for status, help and what is new.

**Files:** `scripts/loadtest/run.mjs`, `packages/server/src/routes/loadtest.ts`, `utils/runtimeStats.ts`, `utils/thumbnail.ts` (`runMediaJob`), `routes/spaceExpressions.ts` (`GET /api/emojis/available`), `utils/operatorAlerts.ts`, `routes/publicStatus.ts`, `backup.sh`, `packages/web/src/publicPages/`, `locales/*/{help,changelog,status}.json`, `components/home/WhatsNewNote.tsx`.

## Load test

`scripts/loadtest/run.mjs` needs nothing installed. It connects sockets, has some of them write, and says how long everything took and how late the server got.

```bash
# On a test instance with a database of its own:
LOADTEST_ALLOWED=1 DISABLE_RATE_LIMITS=1 npx tsx src/index.ts

node scripts/loadtest/run.mjs --url http://localhost:3006 --token <an admin's token> \
  --sockets 1000 --rate 20 --seconds 20 --ramp 50 --storm 25 --history 5000
```

**It cannot hit real people by mistake.** `routes/loadtest.ts` exists only with `LOADTEST_ALLOWED=1`: without it the routes are not there at all, and the script's first question gets a 404, on which it stops. With it they are for administrators alone. The script leaves a space and accounts behind, so it is for an instance you can throw away. Its accounts have no password and are ordinary people to everything else.

Set `DISABLE_RATE_LIMITS=1` too: all the traffic comes from one address, and otherwise the limits per address would be all it measures.

| Option | What it does |
|--------|--------------|
| `--sockets` | How many stay connected |
| `--members` | How many are in the space, if more than are connected |
| `--rate`, `--seconds` | Messages a second, and for how long |
| `--ramp` | Sockets connecting each second |
| `--channels`, `--roles`, `--history` | Channels, roles per person, messages from before the test |
| `--storm` | Per cent of the sockets dropped and reconnected at once, as after a restart |
| `--json` | Writes the numbers to a file |

**What it measures:** how long `ready` takes and how much it weighs, how long writing a message takes, how long until others have it, the event loop's delay and the memory (from `GET /api/admin/system`), and anything refused.

**Read it as a comparison between runs.** It runs on the same machine as whatever else is there, and is itself busy reading what arrives: at 500 reconnecting at once on one PC, 145 sockets closed with 1006 while the server's own delay stayed under 60 ms, so that was very probably this script running out of time. No number here says how many people a server can take.

### What it found

Measured on a Windows desktop PC with the script on the same machine, with one space where everyone is a member, five channels and one role each.

| | Before 1.31.0 | Since |
|---|---|---|
| 200 connected, 5 messages a second: writing one | p50 2309 ms, p95 4907 ms | p50 28 ms, p95 31 ms |
| Same: until others have it | p50 2085 ms, p95 4682 ms | p50 24 ms, p95 26 ms |
| Same: the event loop's worst delay | 3979 ms | 18 ms at p99 |
| 1000 connected, 20 messages a second: until others have it | not usable | p50 28 ms, p95 36 ms |
| Same: the event loop | | 42 ms at p99, 73 ms at worst |
| `ready` in a space of 1000, on the wire | 847 KB | about 22 KB |
| 1000 connecting at 100 a second | 542 refused | all through |

### The three things it found

**A message read the database for everyone online.** `sendToChannel` called `computePermissions` for each of them, and then read their cursor and counted their unread messages, so that one message cost some ten queries a person: 55 % and 12 % of all the server's time in the profile. Now `computeChannelPermissionsFor` reads what a channel needs once for all of them, and `channelUnreadCountsFor` reads the channel's newest messages once and answers everyone from that. Neither keeps anything between calls, so a change of rights takes effect at the next message as it always did. They share the rules with the functions they replace: `permissions.test.ts` and `channelUnreadCounts.test.ts` compare the answers.

**Frames, one for each thing for each person.** A message was followed by its count as a second frame, and everyone heard of everyone's presence in a frame each: a thousand people coming back after a restart were a million frames, and each one a system call. A client that says `batch: true` at `auth` now gets several events in one frame, `{ type: 'batch', events: [...] }` (websocket.md). A message and its count are one frame, encoded once for everyone with the same count. From 100 people connected, presence waits half a second and goes out together, with only the newest of each person (`broadcastPresence`). Below that nothing changes. A client from before this, and a bot, gets everything one by one as it did. `onlineProfileTargets` asks who is connected rather than reading everyone in someone's spaces at each connect.

**Everyone connecting at once.** `ready` in a space of 1000 took long enough that the sockets behind it ran out their ten seconds to authenticate before they were even read, and then all knocked again in step. Now:
- `ready` is built one to a turn of the event loop (`inTurnForReady`), so that everything else still gets its turn. Whoever has sent `auth` has done their part, however long the queue.
- A quadratic walk over the member roles went, each person's rights come from one read per space (`computeSpacePermissionsFor`), and it reads only the columns people may see of an account (`PUBLIC_USER_COLUMNS`), so not a password hash for each member.
- A large frame goes compressed (`perMessageDeflate` from 32 KB, in `index.ts`). `ready` is mostly the same words over and over, and nothing small pays for this.
- The client waits a random part of its back-off before it knocks again.

### What is still the limit

`ready` holds every member of every space, so it grows with the spaces and a client's memory with it. In a space of 1000 it takes about 15 ms to build here, so a thousand people reconnecting need about a quarter of a minute, and everything else keeps running meanwhile. Far larger spaces need the member list loaded when it is looked at, which touches much of the client (`.members` is used in some 70 files) and has not been done.

## Emoji, stickers and picture work (1.34.0)

### Picture work

Decoding and encoding a picture holds a thread for seconds. Since 1.32.7 media work runs at most two at a time (`utils/thumbnail.ts`) and the rest waits, so uploads finishing side by side cannot take the machine. The pictures people send for emoji and stickers ran outside that queue until 1.34.0, as many at once as arrived. Now they take their turn through `runMediaJob` (the library's emoji, personal stickers, a space's emoji and stickers, and with them the Discord import), with two bounds that keep the queue short for everyone else's uploads:

- An account has at most one such job queued or running. A second is refused at once rather than waiting with its picture in memory.
- While 24 jobs of any kind wait, new picture work is refused, so many accounts together cannot grow the queue, and the memory it holds, without end.

A refusal is `MediaBusyError`, answered `429 rate_limited` at once; the Discord import ends its batch there and tries the picture again on its next request. Encoding one such picture is given up after 30 seconds (`PICTURE_ENCODE_SECONDS`, all of an emoji's quality passes together), and a sticker of more than 300 frames is refused before it is encoded, since a tiny picture with a huge number of frames passes the pixel limit. An upload's thumbnail and probe, a picture field's resize and a clip's probe still wait for the same two places and are never refused. See [uploads.md](uploads.md#the-picture-work-queue).

### What `ready` leaves out

`ready` is the path everyone takes at once after a restart, and it already holds every member of every space (above). A space's emoji and stickers, up to 200 and 60 of them, are not in it. The pickers read them with a request of their own, `GET /api/emojis/available`: the library, and each space the person is in on that instance. A client asks for it when a composer or a picker first needs it, and after a reconnect only for an instance it had read before, once its own `ready` has arrived, so after a restart these requests come as spread out as the `ready`s.

A change tells the space with `space_emojis_changed` or `space_stickers_changed`, which carry only the space's id. A client that has read that instance's offer then reads the space's two lists again (`GET /api/spaces/:id/emojis` and `/stickers`), so in a space where many are online, each change brings two requests from each of those clients. The Discord import tells the space once per request of at most 8 pictures, not once per picture. The library's `emoji_upserted` and `emoji_removed` still go to everyone connected and carry the change itself, so they bring no requests.

Checking who may use an emoji (`utils/emojiUse.ts`) runs once per message or reaction, for whoever wrote or gave it, never for its readers; a message that brings no custom emoji token it did not already carry reads nothing for it.

## Warnings

`utils/operatorAlerts.ts` looks every five minutes, and at each start.

| Cause | When | Clears |
|-------|------|--------|
| `disk_high` | The data's disk is `OPERATOR_ALERT_DISK_PERCENT` (85) full or more | Below that |
| `backup_failed` | A scheduled snapshot could not be written | At the next one that works |
| `backup_old` | The newest snapshot is more than two intervals old, on an instance older than that | When there is one |
| `offsite_failed` | `BACKUP_OFFSITE_CMD` failed, or `backup.sh --to` did, or its last good copy is 3 days old | At the next one that works |
| `restart_loop` | Four starts within 15 minutes | When they stop |

Each active cause shows on the System page of the admin console and counts on the dashboard (`alerts` in `GET /api/admin/system`, `open.alerts` in the dashboard). The administrators with a confirmed address get a mail, at most one a day for each cause: the row in `operator_alerts` stays after it clears, so that something flapping tells once. Without mail it is only in the console. A mail that was held back by its budget does not count, and is tried again at the next look.

Nothing here can stop what noticed it: if the database is the problem, the failure is logged and that is all. A crash loop too quick to reach the first look tells nobody until it stays up, which is why a monitor outside the machine is still worth having.

`GET /api/admin/system` also says how late the event loop is, over its last ten seconds, and how many sockets are open (`utils/runtimeStats.ts`).

## Backups with uploads

`bash backup.sh --with-uploads --to <place>` copies the snapshots and `data/uploads` off the machine, with rsync, or `cp` to a local folder where there is no rsync, or rclone for `rclone:remote:path`. `--copy-only` takes no new snapshot, since the server makes its own. Nothing is deleted at the other end. How it went goes to `data/backups/offsite-status.json`, without the address, for the warnings to read, because the script runs outside the server. See docs/tavvit/BACKUP-AND-RESTORE.md for the cron line and the way back.

## Status page

`/status`, for anyone, from `GET /api/status`: whether messages and accounts, uploads, voice and mail run, and nothing about how. No counts, versions or addresses. Mail held back reads as down, with no reason given. The answer is remembered for 30 seconds, and those asking at once wait for the same one, so that asking cannot make the server call LiveKit over and over.

**Notes** are announcements with "Also on the public status page" ticked. An announcement goes to everyone signed in, so this is not a second way of saying things. What ended stays on the page for a week. Who wrote it is not shown.

**Its limit:** it lives on the server it reports on. If the whole server is gone, so is this page, and it says so. For that you need a monitor elsewhere.

## Help and what is new

`/help` and `/changelog` are text in the five languages, in `locales/<lng>/help.json` and `changelog.json`. **Add a version to `changelog.json` at the top with what people notice, and leave out what they do not.** Its order is the order on the page.

`/roadmap` is what comes next, in `locales/<lng>/roadmap.json`, in three sections: next, after that, later. **When a version ships something from it, take it off in all five languages**; the page names the newest versions from the changelog by itself. It has no dates and promises nothing under "later", and it is held to what the product page is held to: no promise of federation, native apps, end-to-end encryption or any price ([landing.md](landing.md)).

The home page shows one quiet line for the version that runs, once, if that version is in the changelog (`WhatsNewNote`). Someone new has nothing to catch up on, so a first visit only remembers where they started.

## How the public pages load

`main.tsx` asks `showsPublicPage()` (`publicPages/entry.ts`) and fetches `publicPages/boot`, as it does the product page, so a visitor is not sent the app. `PublicPages.test.tsx` fails if a file there imports a store, `api/`, a component, a hook or the app's i18n setup. They have their own small i18n setup. Dates come from `i18n/createFormatters.ts`, which is the part of the formatters that needs nothing of the app. Anything in the app that links to them is a plain `<a target="_blank">`.
