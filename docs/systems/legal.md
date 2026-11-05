# Legal basics

Source files:
- `packages/shared/src/legal.ts` -- Operator details, documents, reports, notices: types, limits, the values each may take
- `packages/server/src/utils/legal.ts` -- Reading documents (`currentDocument`, `upcomingDocument`, `documentState`), `parseOperator`, `readOperator`
- `packages/server/src/utils/legalTemplates.ts` -- The drafts of the terms and the privacy policy, German and English
- `packages/server/src/utils/reports.ts` -- `createReport`, snapshots, `removeReportedMessage`, `sendNotice`, retention
- `packages/server/src/utils/reportCount.ts` -- `openReportCount`, apart because the socket layer needs it
- `packages/server/src/utils/accountActions.ts` -- `applySuspension`, the one way into a suspension
- `packages/server/src/utils/sourceOffer.ts` -- The AGPL source offer
- `packages/server/src/routes/legal.ts` -- Every route below
- `publish-source.sh` -- Makes the source archive of the running release
- `packages/web/src/components/legal/` -- `LegalPages` (`/terms`, `/privacy`, `/imprint`, `/report`), `LegalLinks`, `ReportForm` and `ReportModal`, `LegalController` (terms dialog, notices)
- `packages/web/src/components/modals/instanceSettingsPanels/LegalPanel.tsx`, `ReportsPanel.tsx` -- The admin area
- `packages/web/src/components/ui/ExternalMedia.tsx`, `stores/externalMediaStore.ts` -- Content from other servers
- `packages/web/src/stores/legalStore.ts` -- What the client knows of all this

Whoever runs an instance is its provider and answers for it. The software gives them the place for their details and a draft to start from. **The drafts are not legal advice:** an operator reads them, fits them to their situation and has them checked before a public release. Nothing is shown to anyone until an admin publishes it.

---

## What the law asks, and where it is met

For a provider in Germany. Checked on 2026-10-30; this table explains the design and is not a legal opinion.

| Rule | What it asks | Where |
|------|--------------|-------|
| § 5 DDG, § 18 MStV | Provider's name, postal address, a fast way to reach them, easy to find from every page | `/imprint`, `LegalLinks` |
| Art. 13 GDPR | Say what is processed, why, how long, who receives it, which rights exist | `/privacy` |
| § 25 TDDDG, Art. 6(1)(a) GDPR | Nothing from other servers before the person agrees | "Content from other servers" below |
| Art. 11, 12 DSA | Point of contact for authorities and users | The imprint, the terms |
| Art. 14 DSA | Moderation rules and procedure in the terms | The draft's sections 5 to 8 |
| Art. 16 DSA | Electronic notice of illegal content, with the listed details; confirm receipt, tell the outcome | `/report`, "Report" in the app |
| Art. 17 DSA | Reasons for a restriction, its ground and how to object | Notices, the sign-in page |
| § 305 ff. BGB | Terms bind once agreed, changes need agreement | "When the terms change" |
| AGPL section 13 | Everyone using a modified version over a network can get its source | "Source offer" |

Art. 19 DSA spares micro and small enterprises the platform duties of its Section 3, such as the internal complaint system of Art. 20. That is why an objection here goes to the operator's address and not through a complaint system in the app. An instance that outgrows that size needs one.

---

## Who runs the instance

`instance_settings.legal_operator` holds a JSON `LegalOperator`, null until an admin fills it in. `PUT /api/admin/legal/operator` validates it with `parseOperator`: a name, a postal address, a valid email and a minimum age between 13 and 18 (16 by default, the age of consent under Art. 8 GDPR in Germany) are required; representative, phone, register, VAT id, editorial contact, hosting provider and data protection officer are optional.

Every other part reads from it: the imprint shows it, the drafts are written with it, the sign-up asks for its minimum age, and the sign-in page and the notices name its address for objections.

---

## Documents

`legal_documents` holds one row per published version of the `terms` or the `privacy` policy, with its texts as JSON (`de`, `en`), `published_at`, `effective_at`, `changes` and `published_by`. **A row is never edited:** an agreement names a version, so that version must keep saying what it said. Publishing writes the next version; the admin area can load the latest one as a starting point.

- **Current:** the newest version whose `effective_at` has passed.
- **Upcoming:** the newest version whose `effective_at` lies ahead.
- **Language:** `?lang=` picks one, falling back to English and then German. Readers of Portuguese, Russian and Chinese get English, because a machine translation of a legal text is not something to hand people as binding.

**Drafts** (`GET /api/admin/legal/templates/:kind?lang=`) are written by `legalTemplate()` from the operator and from what this instance has on: LiveKit, the GIF key, federation, the directory, how many backups it keeps. A switched-off feature leaves its section out, so the draft states what this instance does. The text is the admin's from the moment it lands in the editor.

**Keep the drafts true.** They state facts about this software. Whoever changes one of these facts changes the draft in the same commit: what is stored, how long, what leaves the server, what the logs hold.

### When the terms change

Changed terms bind a person only once they agree. So:

- Publishing a change requires `changes` (`400 legal_changes_required` from the second version on), which people read before they agree.
- `legal_updated` goes to everyone connected; clients reload `GET /api/legal`.
- `LegalController` compares `User.termsVersion` with the versions, reloading them on every home `ready` and when an announced version's date comes. Behind the current one: a dialog that cannot be dismissed (`Modal dismissible={false}`), with "I agree" and "Log out". Behind an upcoming one only: the same dialog with "Later", until it takes effect.
- `POST /api/legal/terms/accept { version }` takes the current or the upcoming version and never lowers what was recorded (`users.terms_version`, `terms_accepted_at`).

The dialog is the client's. The API does not refuse requests from someone who has not agreed: their earlier agreement goes on applying, and ending their use is the operator's step under the terms. The privacy policy needs no agreement: it informs, and processing rests on the contract and not on consent.

### At sign-up

`POST /api/auth/register` takes `acceptedTermsVersion` and `ageConfirmed`. Once terms are in force, a local account needs both: `400 terms_not_accepted { version }` or `400 age_not_confirmed { age }`. `RegisterPage` reloads the terms when it opens and holds Continue until it knows; refused anyway, it goes back to the checkbox with the current version. A request with `homeInstance` set is not asked: that path has no such step in the client, and the field is unproven, so on an instance with `FEDERATION_ENABLED` anyone can skip the check this way ("Known limits"). The default answers such a request `403 federation_disabled`. Accounts made with `tavvit-admin` are the operator's own doing and are not asked either; they agree at their first sign-in.

---

## Reports

`POST /api/legal/reports` is open to anyone, 5 per 10 minutes per address. Art. 16(2) sets what it asks for:

| Asked | Check |
|-------|-------|
| Why it is illegal | `explanation`, 20 to 4000 characters: `400 report_explanation_invalid` |
| Where it is | A `targetId` of a message, DM message, person or space for someone signed in; a `targetUrl` from the public form: `400 report_target_invalid` |
| Who reports | The account, or `reporterName` and `reporterEmail`: `400 report_contact_required`. Only `child_safety` may stay unsigned (Art. 16(2)(c)) |
| Good faith | `goodFaith: true`: `400 report_good_faith_required` |

`report_duplicate` (409) stops one person reporting the same open target twice. A message the reporter cannot see answers `404 report_target_not_found`, the same as one that does not exist, so a report tells nobody what is in a channel they cannot read. A request without a token is anonymous; a token that no longer holds answers 401 as anywhere else.

`content_reports` keeps a **snapshot** of the target (author, text, attachment names, place, time), because the content may be gone when an admin reads it. The attachments' files are not copied.

**Deciding** (`POST /api/admin/reports/:id/decide { decision, ground, note, durationHours? }`) is behind `requireAdmin`:

| Decision | For | Effect |
|----------|-----|--------|
| `no_action` | anything | Closes it. `ground` not needed |
| `handled` | anything | Closes one that was dealt with elsewhere in the admin area, such as a deleted space. `ground` not needed; the reporter hears that the operator acted |
| `content_removed` | a message or DM message | Removes it like any delete: attachments go, members see it vanish. The relay names the author, because a peer accepts a delete only from them, so a local author's message goes from peers too; a remote author's goes only from this instance. Already gone is fine |
| `account_suspended` | a message's author, a person | `applySuspension`, with the same rules as the admin's route: not oneself, not an admin, a known duration, a reason of at most 500 characters. Not for a space, whose owner may have changed since the report |
| `listing_withdrawn` | a space with a listing or a request (`AdminReport.listingStatus`) | `decideDiscovery(withdraw)`, with its usual announcement |

Each writes `report_decide` to the platform audit log with the reason, and `report_queue_count` tells the admins' clients. A report outside these decisions (a space that should be deleted, say) is closed as `handled` after acting in the admin area.

**No mail about reports.** Mail is about accounts (email.md), so someone who reported without an account gets their confirmation on the page (Art. 16(4)) and the outcome from the operator's own mailbox; the admin area says so beside their address.

**What the app's "Report" sits on:** the message menu (`buildMessageMenuItems`), the author menu (`useAuthorMenu`), the member and user menus (`reportUserMenuItem`), the space menu (`useSpaceContextMenu`). A report goes to the instance that holds the thing (`getApiForOrigin`), whose operator decides.

---

## Notices

`user_notices` tells a person what was decided, `user_notice` delivers it live, and `GET /api/legal/notices` on the next start.

| Kind | To | Says |
|------|----|------|
| `content_removed` | the author | What, the reason, the ground, how to object (Art. 17) |
| `account_suspended` | the account | The same, and until when |
| `warning` | the account | An admin's warning from the console: the reason, the ground, the way to object. It changes nothing about the account |
| `listing_withdrawn` | the owner | The same |
| `address_withdrawn` | the owner | An administrator took the space's own invite address away, with the reason ([admin.md](admin.md), "Own invite addresses") |
| `report_decided` | the reporter | The outcome only, not the reason meant for the person affected (Art. 16(5)) |

`NoticeDialog` shows unread ones one at a time, and About lists them. A suspended account cannot sign in to read one, so the sign-in page shows the reason, the end, how to object and the operator's address. A suspension made on the account's page in the admin area is told this way too.

---

## Retention

`startLegalRecordSweeper` runs at boot and daily (`purgeOldLegalRecords`): decided reports and read notices go after a year, the platform audit log after two. The privacy draft states these numbers. Deleting an account removes its notices and keeps reports it made, unsigned.

**Mail.** Where the instance sends mail (email.md), the privacy draft says so, from `LegalTemplateFacts.mail`: that an address is voluntary or required, what is stored and for how long, and who sends. With Resend it names Plus Five Five, Inc. and the transfer to the USA (Art. 45, with the standard contractual clauses behind it); it does not say the mail is sent from Ireland, whatever the sending region, because the processor's own operations are in the USA. With SMTP the draft leaves a marked place for the provider's name, for the admin to fill in. Turning mail on changes what has to be said: insert and publish the draft again. The operator's part: Resend's DPA, Plus Five Five on the DPF list, the record of processing.

**Security activity.** Each account has a list of what happened to its security, with device and address cut short, for 90 days; new devices are told by a hash of a random id the browser keeps, gone after 180 days unseen (auth.md, "Security activity"). 2FA secrets are encrypted and recovery codes are hashes. The privacy draft says all of this in section 7, and section 8 names the id. Whether that id is covered by § 25(2) TDDDG is the draft's reading, not settled law: have it checked with the rest.

**Sessions.** Each signed-in device has a row with its browser and system, its address cut short and when it was last active, so a person can recognise and end it in Settings → Security (auth.md, "Tokens and sessions"). The row goes with the session, after 30 days at the latest. The address never goes in whole, and no location is derived from it. The privacy draft states this.

**Logs.** The request log holds method and path only: `serializers.req` in `index.ts` leaves out the address and the query string, which carries search terms. Compose bounds the app's log to 3 files of 10 MB. The privacy draft says that addresses are used in memory and not written down, so a change here changes the draft.

---

## Content from other servers

Every picture a server names goes through the same gate in the client (`useGatedPicture` and `GatedPicture` in `components/ui/ExternalMedia.tsx`, 1.32.8): an account's picture and banner (`ProfileBanner`), a group's icon, a space's icon in the sidebar, on the phone's space lists, in Explore and among mutual spaces, the colour the place's light is taken from (`AmbientLight`, which reads the picture), a banner in the admin's listing preview, a space's banner at the head of its channel column and on its card on Home (`useSpaceBanner`), and a custom emoji in text or in a reaction (`CustomEmojiImage`, 1.34), which reads `:name:` while it waits. A banner goes into CSS only through `utils/cssUrl.ts`, quoted and escaped, so an address cannot open a second `url()`. Role colours are drawn only as `#rrggbb` (`utils/roleStyle.ts`), so a colour from another instance adds no layer that loads an address.

A server that delivers a file sees the address of whoever fetches it. Link previews, video thumbnails, GIFs, embedded players and Markdown images therefore load only after a yes, on the same rule the Google Fonts ruling (LG München, 2022) made familiar here.

- `ExternalImage` and `ExternalGate` (`ui/ExternalMedia.tsx`) show a placeholder for anything on another origin until allowed. This server's own files pass straight through.
- "Load" allows that host until the app closes. "Always allow" is the person's consent, kept on this device (`tavvit-external-media`) and withdrawn with the switch in Settings → Privacy.
- Used by `GenericEmbed`, `ImageEmbed`, `RichEmbed`, `VideoEmbed`, the audio embed, a GIF-only message, `MarkdownRenderer`, `GifPicker`, a sticker message (`StickerMessage`), a sticker reaction (`ReactionPill`, which shows a plain picture mark until then) and the player of watching together (`WatchPlayerHost` through `useBlockedHost`: the title and the two buttons until then, [watch-together.md](watch-together.md)). Whoever renders something from another origin uses them too. A sticker on a server this client already talks to (this page's, or an instance the person is signed into: `useConnectedOrigins`) needs no yes, since that server sees the address anyway.
- **What another person can make a client fetch is limited at the server too** (`utils/remoteMedia.ts`), since everything above is fetched without a click: a sticker in a message or a reaction comes from this instance or from the instance its author lives on (`sticker_elsewhere` otherwise, also for what a peer relays); a profile picture, a banner, a space's icon or banner and a group's icon name a file here, or by its address an upload on the account's home (or the group member's): never another site. An address stored before this rule held is not handed out at all (`shownPicture` in `publicUserOf`, `spaceToWire`, `toDmChannelWire`, the invite preview, Explore); the stored value stays as it was.
- **Not covered:** federated instances' files load from their origin, on the rule above: a peer's own uploads, never a third site.

---

Since 1.32.7 the client holds this rule wherever a picture is drawn, not only where the server already filters: `Avatar` shows the initials for a picture on a server the client does not talk to (`useConnectedOrigins`, kept by `stores/connectedOriginsStore.ts`) until the host is allowed; Outer Space cards wait for a yes for their icon and banner, and work out no colour before it; `/join/CODE@host` asks before fetching the invite from that host (`auth:join.elsewhere`); attachments of a peer not yet copied here, their spoiler preview included, wait as well. A space invite naming another instance is refused while federation is off. The privacy draft's sentence on content from other servers states what now holds everywhere.

## Source offer

AGPL section 13 is met without any setup on an install from a release archive. `publish-source.sh` packs what the release shipped (its `MANIFEST`) into `data/downloads/source/<release name>.tar.gz`, served at `/downloads/source/`. `update.sh` and `install.sh` run it. It keeps the two newest archives, because until an update has proved itself the version before it may be the one running. It leaves out `.env` and `data/` whatever the manifest says, and takes `sudo` when `data/` belongs to the container's user.

`sourceOffer()` answers `GET /api/instance/info` and the boot log, per call: `TAVVIT_SOURCE_URL` (or the older `ORBIT_SOURCE_URL`, `BACKSPACE_SOURCE_URL`) if set; else the archive whose name ends in this build's id, so a leftover is never offered as the running version's source; else upstream with `sourceCodeConfigured: false`, which the admin UI and `doctor.sh` report as incomplete.

Where a person meets it: one plain word beside the other legal links, on every surface that has them (`components/legal/LegalLinks.tsx`: sign-in, an invite, the settings, About, the legal pages, an unknown address), in the Legal column of the product page, and in the footer of the developer docs, where the page's script asks the server for it (`packages/web/developers/assets/docs.js`). It names neither the licence nor a version; About shows the running version as a line of its own. An instance can make the word as quiet as this, not take it away: section 13 asks for the offer, and only a signed licence from the upstream author would lift it (`LICENSE-COMMERCIAL.md`).

The archive is the whole source of what is offered, the desktop app's code included (`packages/desktop`, which a server does not run but whose installers it serves). The installers carry the licence text and the notices beside the app's resources (`extraResources` in `electron-builder.yml`).

## Data export

Art. 15 and 20 GDPR, self-service: Settings → Account → "A copy of your data" (`utils/dataExport.ts`, `routes/dataExport.ts`).

- **Asking takes the password,** once a day per account (a failed try does not count). The file is built in the background, one at a time, and stays for a week. A sweep removes what ran out, what a restart cut off, what belongs to a deleted account, and any file with no row.
- **Served to its owner alone,** with their token, from `config.exportDir` (`EXPORT_DIR`, default `data/exports`), which is not under what the server serves publicly.
- **What is in it:** the `users` row without the password hash; friends, requests and blocks; spaces, bans and join requests; notification settings, folders, connected servers; reports the person made and notices sent to them; every message, DM and reaction of theirs; their avatar, banner, attachments, stickers and emoji, and the emoji and stickers they added to spaces. A README says what is what.
- **What is not:** what others wrote to them (Art. 15(4)), and any credential.
- **The format** is a plain ZIP, stored and not compressed, written by the server itself with `node:zlib`'s checksum, so no dependency. It stops short of 3.5 GB; files that do not fit are named in the README, for the operator to hand over.
- **Only this instance.** Someone with accounts on several instances asks each of them.

**The privacy draft states this.** Whoever changes the lifetime changes section 14 of `legalTemplates.ts`.

---

## Known limits

- **Federated sign-ups** do not ask for the terms, and anyone can use that path on a federating instance to skip the age check (see "At sign-up"). It needs a step in the Connections flow, or proof of the home instance.
- **Notices from other instances** do not reach the person: the client reads and shows only the home instance's. A report to another instance tells the reporter to expect no answer in the app.
- **Image metadata** stays in uploaded originals; the privacy draft warns about it.
- **Uploaded files** are reachable by anyone with the address, which is hard to guess; the privacy draft says so.

## The product page

The public page at `/` tells visitors "no ads, no trackers" and that pictures from other websites load only after a click. Those are statements about this code; whoever adds an advert, an analytics script or content that loads by itself changes the page as well as the privacy draft ([landing.md](landing.md)). The page itself loads nothing from another server and stores nothing except the language a visitor picks in its footer. Since 1.34.1 it is rendered to HTML when the web package is built (Astro, with its usage reporting switched off, so the build sends nothing either); what a visitor's browser gets and stores is the same as before. Its head carries the usual tags for link previews and search engines, which make no request of their own, and its first script reads only what the app already keeps (`backspace_token`, to send someone signed in to the app) and the user agent (to show the Windows download), and writes nothing.

## Changing a username

The draft's paragraph on the account says that the old name stays reserved for 30 days and that it is stored for this. So publish it again. The personal export lists it.

## Translating messages

The draft's section on content from third parties says that a person's browser translates where it can, that the text goes to the provider on request where one is set up (`LegalTemplateFacts.translation`, named), and what the link to Google does. **Setting or changing `TRANSLATION_PROVIDER` changes the draft, so publish it again.** See [translation.md](translation.md), "Privacy", on which provider fits a server for other people.

## What the admin console stores

The privacy draft (`utils/legalTemplates.ts`, section "Reports and moderation") says that administrators can keep short notes about an account, that they are part of that account's data export and that they are deleted with it. It also says that administrators can see an account's sessions and security list and find an account by its whole confirmed address, that a new account can start in spaces the operator chose, how long backups made by hand are kept, and that a deleted account's messages in spaces go with it while direct messages stay under "Deleted User". An operator who published the policy before 1.22.0 has to insert the draft again, compare and publish, because a published text does not change by itself. Announcements hold no personal data beyond the admin's id; the sign-up rules hold a domain or a name somebody may want, not anyone's account; the CSV of accounts holds no addresses.

The privacy draft also says that a device with push on stores the address its browser names and two keys, that notifications go through that browser's push service, encrypted against it (Google, Mozilla, Apple or Microsoft), that a forwarded message is a copy under the forwarder's name that stays when the original goes, and that everyone in a channel can see who chose what in a poll.

## What 1.24 added to what is stored

The draft's paragraph on messages names these, so republish it: which threads someone follows, which events they said they are going to (the space's members can see it, and a reminder is sent), when they agreed to a space's rules, a webhook's name, maker and last use, with only a hash of its secret, and that what is posted in an announcement channel goes as a copy to the channels following it, where a later edit or deletion does not reach it ([forums.md](forums.md)). The address of a webhook is kept out of the logs (`pathForLog`). The personal export lists the threads followed, events announced and answered, and webhooks made.

## What 1.25 added to what is stored

The draft's paragraph on messages names these, so republish it: the messages someone saved, their reminders and the words that alert them, which only they see; and clips added to a soundboard, which all members of the space can hear. A voice message is an attachment like any other, and its waveform is stored with it. The personal export lists saved messages and keywords and holds the clips a person added.

## Developers and vulnerabilities (1.30)

The terms draft has a paragraph at the end of its Rules, in German and English: programs run only on a bot's own account, never on a person's; whoever runs one answers for it and keeps its token safe; the provider may remove what breaks the terms. It links to the rules for bots in the developer docs ([developers.md](developers.md)). Republish the terms for it to take effect. The numbering of the sections is unchanged, so references to them stay right.

`/.well-known/security.txt` (`routes/legal.ts`, RFC 9116) gives the operator's address from the legal details and nothing else of theirs, and answers 404 until there is one. `Expires` is a year ahead of each request. The docs store nothing and set no cookie, and they load nothing from another server, so the privacy draft does not change.

## What 1.26 added to what is stored

The draft says plainly that a bot is a program run by a third party, not by the operator, and that it can see and pass on what is in the channels it may read, so republish it. It also says what is stored for someone who runs one: that it is theirs, when it was last used, and a hash of its key. The invite page says the same before anyone adds a bot. The personal export lists the bots a person runs.

## What 1.33 added to what is held and sent

Watching together keeps nothing: the link, title and queue of a call's video are held in the server's memory while the call lasts ([watch-together.md](watch-together.md)). The draft's section on voice and video says so, says that whoever can see the voice channel sees the title of what plays and that those in the call see the links, the queue and who started the session, that the server asks YouTube or Vimeo for that title with only the video's link, and that the video itself loads on a device only after consent, as any embed does. Republish it. The feature names nobody it need not: who added a video and who reacted are not sent, and a video without a title from its provider is named by the provider, never by its link, in the channel list. Nothing goes into the personal export.

## What 1.34 added to what is held and sent

**Held.** A space's emoji and stickers (`space_emojis`, `space_stickers`) keep a name, the picture, a sticker's description for screen readers, the Discord id of one that was brought over, and the account that added it (`created_by`). Their size counts on that account's storage, and the lists the space's members get name that account, as the soundboard's do. A space's emoji can be used by its members anywhere on the instance, so it can appear where nobody is a member of its space, and its picture is served at `/api/emojis/<id>.webp` without sign-in, like the instance's own. The space's audit log names who added, renamed or removed one, and an import from Discord with its counts (`discord_expressions_import`). `spaces.discord_imported_at` says only that a space brought something from Discord; the invite preview turns it into `movedFromDiscord`.

- **Export:** `files/space-emoji/<spaceId>-<name>.webp` and `files/space-stickers/<spaceId>-<id>-<name>.webp` hold what a person added to spaces, by hand or by the import, and the README says so.
- **Deleting an account:** `tombstoneUser` clears `created_by` in `space_emojis`, `space_stickers` and `custom_emojis`. The emoji and stickers stay with their space and name nobody. The instance's own emoji went on naming a deleted account before 1.34: a tombstone keeps the `users` row, so the column's `ON DELETE SET NULL` never fired.
- **Deleting a space** removes its emoji files. A sticker's picture is shared by its content and stays while a message, a reaction or a collection names it. The janitor removes emoji files that no row names, at start and then hourly after an hour's grace, and sticker pictures that nothing names.

**Sent, on the request of the person importing.** Three kinds of request leave the server for Discord. Each goes to an address built here from a checked code or id, never one a client names, with `redirect: 'error'`, and each comes from the server, so Discord sees the server's address, not the person's.

| Request | Where | What goes there | What is kept |
|---------|-------|-----------------|--------------|
| A template | `GET https://discord.com/api/v10/guilds/templates/<code>` (`utils/discordTemplateFetch.ts`) | The template's code. No token, no cookie, nothing of the person's | The channels and roles made from it. The answer stays in memory for 5 minutes, so the preview and the import read it once |
| A server's emoji and stickers | `GET https://discord.com/api/v10/guilds/<id>/emojis`, then `/stickers` (`utils/discordApi.ts`) | The server's id, and the person's own bot token in `Authorization` | Ids, names, whether an emoji is animated, managed or limited to roles, a sticker's format: in memory only, for an open import until 30 minutes after its last use and for an ended one 5 minutes more; a restart forgets them. Who uploaded each, the role lists, tags and descriptions are dropped as the answer is read |
| The pictures | `https://cdn.discordapp.com` and `https://media.discordapp.net` only | The picture's address. No token | The picture, re-encoded, with the name and Discord id of what came over |

In the import's preview the person's own device loads the pictures from Discord's content servers, without a referrer, and only after "Show pictures": the click rule of "Content from other servers". The announcement box sends nothing anywhere; it builds a text for the person to copy.

**The bot token** is someone's credential and is handled as one. Its shape is checked before anything is sent (`parseBotToken`), it goes only into the header of the two list requests, and it lives only as a local of that one request (`POST /api/import/discord/expressions/preview`). Nothing stores or logs it, echoes it in an error or puts it in an event; the session type has no field for it, and the request log holds no bodies. `describe('the bot token')` in `routes/discordExpressionImport.test.ts` runs every path with a sentinel token and looks for it in the answers, the log lines, every column of every table, the socket events and the console. In the browser it lives in the form's state and is cleared once Discord has answered, whatever the answer. The field is a text field masked with CSS (`-webkit-text-security`), so browsers do not offer to save it as a password, with ignore markers for 1Password, LastPass, Bitwarden and Proton Pass; where that masking is not supported (Firefox) it stays a password field, so the token is masked everywhere, on a shared screen too.

**The privacy draft** changed in two places, German and English, so publish it again:
- Section 4, messages and files: emoji and stickers added to a space are there for its members, who added them is stored, and they count on that person's storage; a space's emoji can appear in messages anywhere on the instance, and anyone can fetch its picture at its address.
- Section 9, content from third parties: the server asks Discord Inc., San Francisco, USA, on the person's request (Art. 6(1)(b) GDPR); what goes there is the template's code, or the server's id and the person's own bot token, nothing else of theirs; the token is used for that request only and neither stored nor logged; of the answer only names, pictures and Discord ids of what came over are kept, not who uploaded them; the server fetches the pictures, so Discord sees the server, not the person. The template import's request was not in the draft before.

Whoever changes what goes to Discord or what is kept of its answer changes section 9 in the same commit.

**`?from=discord`** on an invite link (`/join/<code>?from=discord`, the link in the announcement) is read by the invite page alone, which shows a welcome when the preview confirms that the space came from Discord. No API request carries it, and the request log leaves out query strings, so nothing stores or counts it.

**Emoji from another instance.** A token names an emoji of the instance the text belongs to: in a space's channel its host, for text and reactions alike; in a direct message the writer's home, and for a reaction there the reactor's home (the pill is drawn from its first reactor's). The client fetches the picture from there; this server fetches nothing for it. So a direct message from someone whose home is another instance shows pictures from that instance, and while the client is not connected to it they wait for the reader's yes and read `:name:` (`CustomEmojiImage` through `GatedPicture`). A space's channel on another instance needs no yes, since the client talks to that instance anyway. The draft's section 9 already covers pictures from other servers, so this needs no sentence of its own.
