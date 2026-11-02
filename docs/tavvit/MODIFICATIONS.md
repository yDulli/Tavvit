# What Tavvit changes from Backspace

Tavvit is Backspace 1.11.0 (upstream commit `2885a7d3`, "fix(web): author menu and
sticker picker follow-ups (#466)") with the changes below, made in **October 2026**.
This file is the notice the AGPL asks for (§ 5(a)): which files were changed and what
the changes are. Everything not listed here is Backspace's code, unchanged. Where a
change was made to an existing file, that file's own history is in git
(`git log --follow <file>` against the base commit).

The license of every change is the same as the code it changes: AGPL-3.0-only. See
[LICENSING.md](LICENSING.md).

## 1. Private by default

| Area | Change | Main files |
| --- | --- | --- |
| Registration | Closed by default (`REGISTRATION_OPEN=false`). A fresh database is created with registration off. **No "first visitor becomes administrator" window.** | `packages/server/src/config.ts`, `db/migrate.ts` (`ensureDefaults`), `routes/auth.ts` |
| First administrator | Created on the server with the new `tavvit-admin` tool (`create`, `reset-password`, `list`, `status`); passwords only from a hidden prompt, stdin or a generated value, never an argument | `packages/server/src/scripts/tavvit-admin.ts`, `utils/adminAccounts.ts`, `tavvit-admin.sh` |
| Sign-in | Per-account throttle (10 failures / 15 min) and a constant-time dummy hash for unknown usernames | `utils/loginThrottle.ts`, `routes/auth.ts` |
| Federation | Off unless `FEDERATION_ENABLED=true`: routes not registered, workers not started (only the storage janitor), outbound calls refused, browser policy narrowed | `config.ts`, `index.ts`, `utils/federationFetch.ts`, `federationPeering.ts`, `federationWorker.ts`, `utils/csp.ts`, `routes/auth.ts`, `social.ts`, `users.ts`; UI entries hidden: `hooks/useFederationEnabled.ts` |
| Telemetry, public directory, update lookup | Off unless an operator sets an endpoint / repository; the update lookup no longer targets upstream's releases (`ORBIT_UPDATE_REPOSITORY`) | `config.ts`, `utils/releaseCheck.ts`, `routes/adminUpdates.ts`, `telemetry/reporter.ts`, `routes/adminTelemetry.ts` |
| Instance info | New fields so clients can tell what is going on: `federationEnabled`, `telemetryAvailable`, `setupRequired`, `sourceCodeConfigured`, `accentColor` | `routes/instance.ts`, `packages/shared/src/types.ts` |
| AGPL § 13 | The server offers the source archive of the running release itself (`publish-source.sh`), or `TAVVIT_SOURCE_URL`; a visible "incomplete" state otherwise | `publish-source.sh`, `utils/sourceOffer.ts`, `utils/startupSummary.ts`, About page |
| Name | The product is called Tavvit (Orbit until 1.12) | throughout; `docs/tavvit/PLAN.md` lists what keeps the old spelling |
| Legal basics | Operator details and imprint, versioned terms and privacy policy, agreeing at sign-up, reports with decisions and notices (DSA Art. 16, 17), click-to-load for content from other servers, no addresses or query strings in logs | `docs/systems/legal.md` |

## 2. Identity and look

| Area | Change |
| --- | --- |
| Name and logo | "Tavvit" and the owner-supplied logo replace Backspace's name, logo and icons everywhere a user can see them (`assets/brand/`, `packages/web/public/icons/`, `scripts/gen-icons.mjs`, `index.html`, PWA manifest, locale strings in all five languages). |
| Instance name and accent | The administrator chooses the instance name and an accent colour (Admin console → General). The server answers `/`, `/index.html` and `/manifest.webmanifest` with the instance's name; the client applies the accent from the public instance info. Migration `0032_orbit_instance_accent`. (`utils/webDocument.ts`, `components/ui/InstanceBranding.tsx`, `utils/instanceBranding.ts`, `AccentColorField.tsx`) |
| Visual design | New graphite palette with one violet signal colour, 3 to 8 px corner radii, flat bordered panels instead of blur, Geist and Geist Mono as the typefaces, rounded-square avatars and space tiles, calmer motion. (`tailwind.config.js`, `styles/globals.css`, `utils/gradients.ts`, `Avatar.tsx`) |
| Illustration | The mascot character is removed; an empty list is an outlined icon and a line of text (`.empty-state`). |
| Product page | A public page at `/` for visitors who are not signed in, with its own small bundle (`packages/web/src/landing/`, `docs/systems/landing.md`). `main.tsx` chooses between it and the app. |
| Markdown | Fixed a bug that added blank lines around list items and quotes in messages (`MarkdownRenderer.tsx`). |

## 3. Navigation and the friend-group experience

- **Home** page (`components/home/HomePage.tsx`): a greeting, friends currently on
  voice (with a *Join* button), unread conversations, pending friend requests and your
  spaces, all from data the client already holds. New accounts see how to start.
- **Activity panel**: friends on voice show the space they are in
  (`components/layout/ActivityPanel.tsx`, `utils/homeSummary.ts`).
- **Pages**: `/friends` (the friends list moved off the Home route), `/about`
  (replaces `/backspace`, which redirects). Sidebar: Home, Friends, Explore, About.
- **About** page (`components/about/AboutPage.tsx`): server name and address, version, the
  legal links with the source offer.
- **Sign-in page**: shows the server's name, explains "invite only", and when no
  account exists yet, the one command that creates the first administrator.
- **Mobile**: tapping a friend opens (or creates) the conversation with them; friends
  on voice are ringed.

## 4. Removed

| What | Why |
| --- | --- |
| The project page (`/backspace`): Ko-fi/support card, community, insights, report links, "what's new" and its update dot | Promotes upstream's project, not this server. Replaced by About. |
| The "say hi to Jannis" telemetry ask, its settings tab and animations | Written in the upstream author's voice and for his receiver. |
| The browser page offering upstream's desktop installers (Settings → Desktop) | Tavvit has no installers. The Desktop tab remains inside the desktop app. |
| The mascot and its animation code | Replaced by `OrbitArt`. |
| `deploy.sh` | Upstream maintainer's rsync script for his own machines. Replaced by `scripts/package-release.mjs` and `update.sh --from`. |
| The DM Sans font files | Tavvit uses Inter only. |
| Support-card switch in Instance settings | The card is gone. |

(Tests of removed features were removed with them.)

## 5. Deployment tooling

`install.sh` (private defaults, builds from the checkout, creates the administrator,
restores executable bits), `update.sh` (`--from <archive>`, `--check`, rollback logic
by image id, runs without the executable bit), `backup.sh`, `restore.sh` (sudo
fallback), new `doctor.sh` and `tavvit-admin.sh`, `scripts/package-release.mjs`,
`docker-compose.yml` (builds `tavvit:local`, never pulls), `Dockerfile` (CRLF-proof
entrypoint), `.env.example`, `Caddyfile` comments, `.gitattributes` (LF endings).

## 6. Documentation

`README.md` (rewritten), `docs/tavvit/*` (new), `NOTICE` (Tavvit preface and brand
section), `assets/brand/README.md`.

## 6a. Added since

Sign-in and account security: Argon2id, sessions, the sign-in delay (`docs/systems/auth.md`); mail, addresses and password reset, with `nodemailer` as a new dependency (`docs/systems/email.md`). Two-factor authentication and security activity, with `qrcode-generator` as a new dependency of the web client (`docs/systems/auth.md`).

Roles and badges: clickable badges, and a library of role icons from Phosphor (MIT) in place of emoji (`packages/web/src/badges/`, `packages/web/src/roles/`, `docs/systems/badges.md`). The look: a deeper ground, ambient light in the colour of the place, motion tokens, large type, a mark that slides between places (`docs/systems/design-system.md`). The administration: a console of its own at `/admin` in place of the settings tab, with a dashboard, announcements, sign-up rules, starter spaces, a system page, a search across the instance, CSV exports, and per account its sessions, security activity, notes and warnings (`packages/web/src/components/admin/`, `packages/server/src/routes/adminConsole.ts`, `docs/systems/admin.md`).

Message tools (1.23.0): pinned messages, spoilers for text and files, deleting several messages, forwarding, polls, a task in the browser before an account is created, and push to a closed app (`docs/systems/push.md`).

Community (1.24.0): threads, events in a space with reminders and a calendar file, a welcome page with rules that can be required before taking part, and incoming webhooks with accounts that cannot sign in (`users.account_kind`). English is now the default language everywhere: the browser's and the system's languages are no longer asked, and another language comes only from a person's own choice.

The extras (1.25.0): voice messages recorded in the browser with a waveform and a speed control, saved messages with reminders, keyword alerts through the shared alert rule, and a soundboard whose clips each listener plays on their own device.

Bots and API (1.26.0): accounts run from a program, deny by default on every route and socket event, a token shown once, a switch for the operator (off by default), a developer page, an invite page, slash commands, and a guide with an example bot in `docs/bots/`. Also: writing in a channel now takes VIEW_CHANNEL as well as SEND_MESSAGES.

Security fixes (1.32.7), after a second public report and a sweep of the whole code in eight areas:
- **Address leaks:** pictures, invite icons, Outer Space cards, invites to other servers and files from peers wait for a yes in the client, `Avatar` included (`docs/systems/legal.md`).
- **Requests from strangers:** a body past 64 KiB is read only from someone who has shown who they are (`utils/bodyGuard.ts`). A socket frame is at most 64 KiB, and an account keeps at most 10 sockets (`docs/systems/websocket.md`).
- **Storage:** every writer keeps to the account's storage and the disk's reserve: forwards, follow copies, picture fields, profile pictures, stickers, exports, files from peers and uploads under way (`docs/systems/uploads.md`).
- **Outbound requests:** `safeFetch` connects only to the addresses it checked, which closes DNS rebinding (`docs/systems/embeds.md`), and ffmpeg opens only the file.
- **Rights:** moves and type changes that alter a channel's overrides need `MANAGE_ROLES`, and channel edits need sight of the channel (`docs/systems/permissions.md`). Removed members can no longer edit their messages, are out of the space's events and voice, LiveKit included, and lose their pictures for it.
- **Federation:** calls, identities, attachment types and home ids (`docs/systems/federation.md`, section 18).
- **Limits:** mail per account and per client, search, reactions per message and presence repeats.

A fix for starting (1.32.6): 1.32.5 did not start where mail goes through Resend. The webhook's plugin scope added a JSON parser of its own under the root's custom one, which Fastify 5 refuses at startup; `registerRawJsonBodyParser` (`utils/jsonBody.ts`) removes the inherited parser in that scope first. `scripts/release-check.mjs` gained the step `boot`, which starts the server as the Docker image does with every optional part configured (`docs/systems/deployment.md`, "Checking a release").

More security work (1.32.5): the server runs on Fastify 5, whose client address now also requires the connecting proxy to be on a private network (`docs/systems/web-security.md`, "The client address"); `DISABLE_RATE_LIMITS` is ignored in production; a `Permissions-Policy` header; files of messages from before 1.32.4 get names nobody can guess, a batch an hour (`docs/systems/uploads.md`); the desktop app no longer lets the page register global shortcuts that would hear typing in other programs (`docs/systems/desktop-security.md`, "Global shortcuts"); a detached account's pictures are no longer trusted on the domain it used to live on.

Security fixes (1.32.4), after a user's report that stickers from other servers loaded by themselves in DMs: a sticker, a profile picture, a banner, a space's icon or a group's icon can no longer name a file on a server of the sender's choosing, which every reader's client fetched before anyone clicked, telling that server their address and when they read; a sticker from a server the reader's client does not talk to waits for a yes like any picture from elsewhere (`docs/systems/legal.md`). A member can no longer join a voice channel hidden from them by its id, or learn who is in it; voice moderation and deleting others' messages take sight of the channel (`docs/systems/permissions.md`). Uploaded files get names that cannot be counted through (`docs/systems/uploads.md`).

Channel icons (1.32.3): whoever may manage a channel can give it one of the icons roles have or one emoji, shown in place of its type's icon wherever the channel is listed: the sidebar, the header, the phone, the quick switcher, the inbox and Home (`docs/systems/spaces.md`, "Channel icons"). Without one, the type's icon stays.

Changing a username and a roadmap (1.32.2): a person can change their username, with their password, once in 30 days, and the old name stays reserved for that long (`docs/systems/auth.md`); replicas on other instances follow the new name. `/roadmap` is a public page of what comes next (`docs/systems/operations.md`). LibreTranslate can run beside the app as a service with the profile `translate` (`docs/systems/translation.md`).

Translating messages (1.32.1): right-click a message and choose Translate. The browser's own translator comes first, then a provider the operator set up (`TRANSLATION_PROVIDER`), then a link to Google Translate; code, links, mentions and the marks of a spoiler stay as written, and nothing is stored (`docs/systems/translation.md`).

Community channels (1.32.0): forum channels whose posts are threads with tags and a list by latest activity; announcement channels that other spaces of the instance can follow, a copy of each post arriving under an account of kind `follow` and without mentions; a space's own invite address, which an administrator can take away (`docs/systems/forums.md`, `docs/systems/spaces.md`). Also: the client's store kept neither a space's badges nor its address after loading, so a verified space showed no mark until something updated it live; one function now carries a space's fields and the compiler refuses one left out. The invite rule of a space knew only the old hex codes and now knows those `generateInviteCode` makes.

A fuller product page (1.31.1): threads, polls, events and the welcome shown in real screens, a section for developers with code that runs, what protects an account, a longer table of features, questions and answers, and every picture retaken from today's app.

A product page with more to it and less on it (1.31.2): a channel to try in the browser, tabs for the groups it is for, moving in three steps, the status and version from the server, a code for the phone and a language picker at the top, in a composition after rootapp.com at the owner's wish, with Tavvit's own words, pictures, logo, typeface and first colour: an opening on one body of colour, large colour cards with real screens on glass plates, pill buttons, and nothing that moves by itself.

Ready for many (1.31.0): a load test (`scripts/loadtest/`) and what it found: a message no longer reads the database for each person online, frames are combined for clients that say they can read them, and a crowd reconnecting no longer stops the server. Warnings to the operator, backups with uploads, a public status page, help and what is new. Closed: suspending or signing out now ends a LiveKit call at once, tokens from before sessions open nothing, `homeInstance` at registration needs the home's word, and nobody becomes an administrator by registering (`docs/systems/operations.md`).

Developer docs (1.30.0): public pages at `/developers`, made while the client is built and partly from the code itself, with the reference, a quickstart in curl, Node and Python, a stability promise, rules for bots, `/.well-known/security.txt`, and a paragraph on programs in the terms (`docs/systems/developers.md`).

Bot API (1.29.0): cards for bots and webhooks, files, reactions by request, moderation, commands that ask for things and answers for one person alone, and a developer portal at `/developers/bots` (`docs/systems/bots.md`).

Limits per account (1.28.0): what one account may keep in files and how many spaces it may own, set in the admin console, and no uploads when the disk is nearly full (`docs/systems/uploads.md`, "Limits per account").

Game detection (1.27.0): the desktop app asks Steam which game runs and reads what Epic Games and GOG have installed, so a game no longer has to be on a list; the list keeps only games, under names that say which game it is, and now reaches installed apps with every release; the picker of all running programs is gone (`docs/systems/desktop.md`, "Activity Detection").

## 7. Deliberately not changed

- Internal identifiers: `@backspace/*` packages, the `backspace` Docker service and
  container, `backspace.db`, `window.backspace`, a few `backspace-*` storage keys.
- Upstream's CI configuration in `.github/`.
- Upstream's developer documentation in `docs/systems/` and `CLAUDE.md`, which
  describes the code accurately but keeps the Backspace name in places.
- The database's existing tables, apart from what migrations `0032` and later add to them.
