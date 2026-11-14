# Product page

The public page at `/`, shown to a visitor who is not signed in. It says what Tavvit is
and leads to registration and sign-in. Code: `packages/web/src/landing/`, rendered to HTML
when the web package is built by the public website in `packages/web/site/` (Astro, see
"The website" below).

## Who sees it

The server answers `/` with the page the website's build rendered (`dist/.site/index.html`,
utils/webDocument.ts). Its first script, `public/landing-gate.js`, runs in the `<head>` before
anything is drawn and decides as `showsLanding()` in `landing/entry.ts` does
(`landing/gate.test.ts` holds the two to the same rules):

| Situation | Result |
|-----------|--------|
| A browser tab at `/` with no `backspace_token` | The product page, already in the HTML; `site/client/landing.tsx` takes it over |
| Any other address (`/login`, `/channels/@me`, `/join/...`, `/imprint`) | The app's page (`index.html`): `appBoot.tsx`, and its router decides as before |
| A `backspace_token` is stored | `landing-gate.js` replaces the address with `/channels/@me`, where `/` has always led: the app. An expired token ends at `/login`, as it always did |
| Inside Electron (`window.backspace`) | The same: the app. The desktop shell, which opens `https://tavvit.com/`, waits for `rendererReady`, which only the app sends |
| An installed web app (`display-mode` standalone, fullscreen, minimal-ui or window-controls-overlay; `navigator.standalone` on iOS) | The same: the app |

`main.tsx` still makes the same decision when the app's own page is opened at `/`: when the
service worker answers a navigation with the app's shell, and on a build without the website
(Vite's alone, as `pnpm dev` serves). There it imports the stylesheet, `landing/entry.ts` and
`publicPages/entry.ts` and `overlay/entry.ts`, asks `showsLanding()`, and fetches one thing with a dynamic import:
`landing/boot.tsx` draws the same page without HTML to take over. `/status`, `/help`,
`/changelog`, `/roadmap` and `/creators` are public pages of their own (operations.md), prerendered the same
way and taken over by `site/client/public.tsx`.

`App.tsx` and its routes do not know the page exists: `/` still redirects inside the router.
So anything inside the app that leads a visitor to the front door is a full page load, not
`navigate('/')` or `<Link to="/">`: the logo on the sign-in pages, on an invite and on `/download`
and the page for an unknown address are plain links, and the Back button of the legal pages uses
`window.location.assign('/')` when `hasStoredSession()` is false. A visitor's way into the app is the same in reverse: every call
to action on the page is a plain `<a href>`.

Every instance shows this page, there is no switch. Someone who hosts their own Tavvit shows
the Tavvit product page too. When registration is closed (`registrationOpen: false` from
`/api/instance/info`) "Get started" disappears, the main button becomes "Log in" and the final
section says so.

## What a visitor downloads

The point of the split: `App.tsx` imports the whole app statically (about 2.9 MB of script). A
visitor gets the whole page as HTML (about 48 KB, before compression) and, gzipped, about 81 KB
of script: `landing-gate.js`, the take-over (`site/client/landing.tsx`), React and i18next. The
budget is **150 KB**, held twice: `site/build.mjs` fails the build when the product page's
scripts and everything they import at once pass it, and `release-check-browser.mjs` adds up what
a visitor's browser actually fetched. The hero window is one picture, 91 KB, and what the section on messages shows
is that same picture, so it costs nothing; every picture is lazy-loaded, and all of them together
are about 1 MB, of which a visitor who reads to the end gets about 800 KB. A group's picture comes
when it is chosen (or about to be), a look's picture too, the phone's code (`qrcode-generator`) when
it is nearly in sight, the newest line of `locales/<lng>/changelog.json` after the first paint. Nothing is fetched from another
server: no fonts, no analytics, no pictures.

`landing/landing.test.tsx` guards this: no file in `landing/` may import a store, `api/`, a
component, a hook, `App`, `appBoot` or the app's i18n setup, and `main.tsx` may only import the
stylesheet and `landing/entry` statically.

The chunks the app needs for its first render (emoji-mart's data set, Discord's shortcode
table) are requested by `main.tsx` together with `appBoot`, only on the app's path. They used to
be `modulepreload` links in `index.html`, which every visitor would have paid for.

A failed chunk (no network, a build replaced mid-load) shows a one-line message with a reload
button, written in `main.tsx` without any catalog, because none could load.

## The website: prerendered with Astro

The product page and the four public pages are rendered to HTML while the web package is built,
so a link preview, a search engine and a reader without a script get the page itself and not an
empty shell. Astro is a build tool here and nothing else: the pages are the same React components
the app's bundle carries, and the app does not change.

- **The build.** `pnpm --filter @backspace/web build` runs Vite, then `site/build.mjs`, which runs
  Astro (`astro.config.mjs`, sources in `site/`) with its usage reporting switched off, so building
  sends nothing anywhere. It moves the pages into `dist/.site/` (a dot folder the static handler
  does not serve) and their files into `dist/_astro/` (named by content, cached for a year like
  `assets/`), and fails the build when a page holds a script written into it (the server's policy
  allows script files from this origin only), names a file the build lacks, or passes the budget.
  `pnpm --filter @backspace/web site:dev` runs Astro's own dev server on :4321 against a server on
  :3005.
- **Rendering.** `site/pages/index.astro` and `site/pages/[page].astro` call `site/render.ts`,
  which renders `LandingPage` (with `prerendered`) and `PublicPage` with `renderToString` in English,
  each with an i18next instance of its own, and puts the result into `<div id="root">`. There is no
  Astro island and no inline script: the page's own module (`site/client/*.tsx`, one file from
  `/_astro/`) sets up English at once and calls `hydrateRoot` with the same tree, so the first render
  says exactly what the HTML says. `site/render.test.ts` renders every page in Node, where there is no
  window, as the build does.
- **What differs by visitor** comes after that, or is already in the HTML for the stylesheet to choose:
  the stored language (`applyStoredLandingLanguage`, after the take-over), the instance's facts (as
  before), the device (below), and this server's address (the origin token, below).
- **The device.** The opening's second button, the Windows download or the way back in, is
  in the HTML both ways (`.lp-for-windows`/`.lp-not-windows`); `landing-gate.js` (or `boot.tsx` on
  the app's path) sets `data-lp-os` from `landingPlatform()` (windows, apple or other) before the
  first paint and `landing.css` hides the one that does not fit. Without it, as for a reader with no
  script, the general one shows.
- **The origin.** The build cannot know the address a server answers at. Wherever a page needs it
  (its canonical address and `og:url`, the whole address of its preview picture, the example a bot
  would send, `<html data-origin>`) it writes `SITE_ORIGIN_TOKEN` (`shared/src/site.ts`), and the
  server writes its own origin (`PUBLIC_ORIGIN`, or `https://DOMAIN`) over it once at its start
  (`renderSiteHtml`). The example's first render reads `data-origin`, so it agrees with its HTML.
- **Serving.** `registerWebDocumentRoutes` answers `/`, `/status`, `/help`, `/changelog`,
  `/roadmap` and `/creators` (a trailing slash too) with these pages, as documents to revalidate. `/index.html` stays
  the app's page, because the service worker keeps it as the shell of every other address. A build
  without `dist/.site` (Vite's alone) answers as before: `/` with the app's page and the public pages
  through the app.

## How it is built

- **Document, not frame.** The website's pages and `boot.tsx` set `data-page="landing"` on
  `<html>`, and that attribute alone gives this page normal document scrolling (`globals.css`). `interfaceScale.ts` does not
  run here, so the `desktop:` and `compact:` variants never match. The page has its own stylesheet,
  `landing/landing.css`, linked by the prerendered page and loaded by `boot.tsx` on the app's
  path: a person using the app never pays for it.
- **Language.** `landing/i18n.ts` sets up i18next with only the `landing` namespace, because
  `i18n/resources.ts` bundles every English catalog. It reads the same stored language as the
  app, and without one it is in English: the browser is not asked. The catalogs are
  `locales/<lng>/landing.json`. The prerendered page is English in its HTML and in its first
  render (`initLandingI18nEnglish`); a stored language follows right after the take-over
  (`applyStoredLandingLanguage`), with its catalog added first. On the app's path a translated
  catalog is fetched before `init` and handed to it, because i18next works out `resolvedLanguage`,
  which the picker shows, from the bundles it holds at that moment. The footer's picker changes the language in
  place, with the catalog added first: the picker sits at the bottom, and a reload would start
  over at the top. If a fetch fails the page is plainly in English: the text, `lang` and the
  picker all say so.
- **Instance facts.** One plain `fetch('/api/instance/info')`, for `registrationOpen`,
  `sourceCodeUrl`, `version` and `twoFactor`, and one `fetch('/api/status')` for whether the chat
  runs. The page works without an answer, and then claims nothing: the footer's source link, its
  status and its version stay away. Two-factor sign-in is left out where the server answers that
  it has none, so the page does not promise what this server cannot do.
- **Search and previews.** What a chat app shows for a shared link, and what a search engine
  reads, is in the HTML before any script runs:
  - The website's pages share one head, `site/layouts/SiteDocument.astro`, filled from the English
    catalogs by `site/seo.ts`: the title and description (`landing.json` `meta`, each public page's
    `title · Tavvit` and `lead`), the canonical address, `og:*` with `og:url`, `og:locale` and the
    picture's type, size and alt text, the same for X (`twitter:*`, `summary_large_image`), the
    icons, the manifest, and on `/` schema.org `WebSite` data (the site's name for search results;
    no price, rating or offer).
  - The picture is `public/social-card.jpg`, 1200x630, under 300 KB (WhatsApp shows none above
    that): the logo, the headline, the lead and the real window, drawn by
    `scripts/landing-shots/card.mjs` from `social-card.html` ("The pictures"). It names no address,
    because every server sends it. `shared/src/site.ts` (`SOCIAL_CARD`) holds its path, size and alt.
  - `index.html`, the app's page for every other address, carries the same picture and tags, which
    an invite link rewrites for its space (its icon in both `og:image` and `twitter:image`, the
    picture's size left out). The server gives both pictures a whole address.
  - The icons: `/favicon.ico` (16, 32 and 48 px, the smallest size Google's results take) and
    `/icons/favicon.svg`, both from `scripts/gen-icons.mjs`, besides the apple-touch icon.
  - `public/robots.txt` keeps crawlers out of `/api/`, `/uploads/` and the app's own routes.
  - The page sets `document.title` and the description in the visitor's language once it runs.

## What is on it

Since 1.42 the page shows no picture of the app. It draws the things a group has in Tavvit (a space,
its tag, a voice room, a poll, an event, a role, a profile, a bot's card) as objects one can try
(`landing/visuals.tsx`), under the name in chrome. Top to bottom (`LandingPage.tsx`):

- **The strip** (`Strip`): what Tavvit is in a few facts of its own (tags from two letters, the
  permissions of a role, the languages, no ads and no trackers; the counts are `figures.ts` and
  `availableLanguages`) and the version, which leads to `/changelog`.
- **The nav**: the brand, Features (`#features`), Download, Developers, Help, the language, Log in and
  "Get started".
- **The opening** (`Hero`): whether the chat runs and the newest line of `/changelog`; the name in
  chrome over the field of light threads (`ChromeWord`, `LightField` in `landing/light.tsx`); the
  headline ("Your community. Your space. Your rules."), the lead and the actions; around it the scene
  of Night Shift as floating cards (`HeroScene`).
- **The band** (`Marquee`): what is inside, passing by, from the index of features.
1. **Your space** (`Tags`): a space's tag, its invite address and its look, with a tag to make
   (`TagMaker`) and the address written out (`AddressCard`).
2. **Inside** (`#features`, `Inside`): the parts of the app as four tabs (Talk, Voice, Plan, Keep
   order), each with its lines of the index and a drawing that can be used (`TalkVisual`,
   `VoiceVisual`, `PlanVisual`, `OrderVisual`): a reaction toggles, a vote counts, "Going" counts the
   visitor in, a role's switches follow the role chosen.
3. **Moving in** (`Moving`): a Discord server template brought across, and what comes with a bot.
4. **Profiles** (`Identity`): banner, bio, pronouns, frames, effects, nameplates and name styles, with
   a profile to try them on (`ProfileShowcase`).
5. **For every group** (`Scenes`): gaming crews, creators (leads to `/creators`), developers (leads to
   `/developers`), clubs and classes.
6. **Developers**: the one piece of code and what a bot's message looks like (`BotMessage`).
7. **House rules** (`Rules`): "No ads. No trackers." and what protects an account; two-factor sign-in
   is named only where the server has it.
8. **Where it runs** (`Anywhere`): the Windows app and the phone, with a code that opens this server
   on a phone.
9. **Questions**, as plain `details`; then the closing call with the address of a space of one's own,
   and the footer with the language, the product's and the legal links, the status, the version and
   the switch that stops the page's motion.

The numbers are the sections' own (`Head index`), in mono before each kicker.

### The stage

**Not on the page since 1.42.** `Stage.tsx` and what it is built from (`Plan.tsx`, `planData.ts`,
`useWalk.ts`, `rooms.tsx`, `channels.tsx`, `gatherings.tsx`, `members.tsx`, `DemoChat.tsx`) are kept as
they were, and `Stage.test.tsx` holds them to what follows by rendering the stage by itself. Nothing
imports them, so the page's script does not carry them.

`landing/Stage.tsx`: a window of the app in which the list of channels is drawn as a floor plan of
Night Shift, the demo space of the pictures ("The plan"), and the room chosen stands where the app has
its conversation. The window's bar names the space and holds two buttons: its members (the member list,
`members.tsx`) and its looks.

- **Arrival.** The visitor starts outside the door, a point in the accent with "You" beside it, and the
  invite stands beside the plan, as the app's join page shows one. Every room but the way in is
  hatched: someone who is not a member sees none of them.
- **Walking.** Choosing a room on the plan (a click, a tap, or Enter on its button) walks the visitor
  there (`useWalk.ts`: out through a door, along the hall, in through a door, at a walking pace), lights
  the room in its colour and opens it. Choosing any room from outside walks in through the door first.
  On a narrow window, where the room stands under the plan, it is brought into view.
- **The rules.** The way in shows the welcome with its rules and where to start. Until the visitor
  agrees, the text rooms are read only and writing, voting and joining a call give way to the rules, as
  the app holds back a member who has not agreed to required rules (`rules_not_accepted`, spaces.md);
  agreeing opens them.
- **The rooms**, each with what it is for, drawn as the app draws it (`rooms.tsx`, `channels.tsx`,
  `gatherings.tsx`): #general to write in (`DemoChat.tsx`, kept once opened, so the conversation is
  still there on coming back); raid-planning with its thread, which opens over the channel and can be
  followed; clips with an upload behind a spoiler; patch-notes with a poll whose results stay hidden
  until one has voted; the lounge to join, mute and turn a camera on in; movie night to watch along, pause
  for everyone and react, a reaction rising over the picture; and the events, to go to, to be reminded
  of, and to walk on from to the lounge.
- **What the rooms say** follows the visitor (`roomsSay`): the text room they stand in counts them, the
  lounge counts them while they are in the call and movie night while they watch, and clips is no longer
  new once looked into.
- **The member list** has everyone under their role, in the role's colour with its icon, the owner's
  crown and the seed's statuses; choosing someone lights the room they are in and rings their mark.
- **The looks** lay a theme on the window: its surface in the app's steps of tone and its accent
  (`lookStyle`, from `LOOKS`), the first being the page's own.
- **Nothing leaves the page.** The people are invented and the page says so; nothing is sent, stored,
  recorded or played: the voice room uses no microphone and no camera, movie night loads no video, and
  both say so.

### The plan

`landing/Plan.tsx`, with `landing/planData.ts` as its data, draws Night Shift as a floor plan: the page's
own picture of what Tavvit is, a place of its own for a group. Its rooms are the space's channels in
the wings of their categories (Hangout, Games); its hall is the way in, with the invite address and the
rules, and every room opens onto it; its events are a room of their own; the people in it are initials
on their colours in the rooms they are in, whoever speaks in a voice room ringed; a room says what is
going on in it (here, talking, watching, new, upcoming), and the thread of raid-planning is a nook
partitioned off in its corner.

- **It stays true.** The channels, categories, roles, people, statuses, thread and poll are those of
  `scripts/landing-shots/seed.mjs`, so the plan, the rooms and the pictures show the same place: when
  the seed changes, `planData.ts` (`PLAN_ROOMS`, `MEMBERS`, `ROLES`) follows. Every kind of room is a
  part of a space the app has.
- **Its rooms are buttons**, named by their name, their kind and what goes on in them; the room the
  visitor is in is `aria-current="location"`, and a line only a screen reader reads says where they are.
- **It fits its own width** (a container, `container-type: inline-size`): twelve columns in three rows
  with the hall across the middle, in smaller type from 600px down, and two columns from 440px down (a
  phone), where the rooms that do not touch the hall open onto the room beside them and their doors are
  not drawn.

### The rest

- **The one piece of code** is `landing/example.ts`: how a bot says something, as the quickstart has
  it, with the address of the server the visitor is on. `landing.test.tsx` holds its route to
  `BOT_ROUTES`, so it cannot name a route a bot does not have.
- **The questions** are plain `details`, so they open without a script and with the keyboard. The
  first stands open, which shows how the rest work.
- **Moving from Discord.** The first of the three steps of moving in (`moving.one`) offers a new
  space, or the Discord server brought along: its roles, categories and channels from a template,
  and since 1.34.0 its emoji and stickers with a bot of the person's own (spaces.md, "Importing
  emoji and stickers from Discord"). The question "Can I bring my Discord server along?"
  (`questions.items.moving`) answers the same: its structure and its emoji, yes; messages and
  members cannot come, so people are invited with a link. The index (`features.items.template`)
  names the template alone.
- **The second link of the opening** is the Windows download on Windows, the only desktop app
  there is, and "See what's inside" (`#features`) everywhere else. Both stand in the HTML and the
  stylesheet shows one (`data-lp-os`).
- **The voice.** The headline says whose it is ("Your community. Your space. Your rules."), and the
  closing what Tavvit gives a group, a place of its own ("Make room for your people."). The sections'
  names are plain. The tavern the page came from stays in the lines that earned it: the closing call
  and the footer's last line. Translate those by sense, not by word.
- **The texts** of everything new since 1.42 are under `home.*` in `locales/<lng>/landing.json`, in all
  five languages. A count has its plural forms. The invented people and places of the scenes (Night
  Shift, its lounge, Yuki, Lena, Noor, the Build Bot) are names, the same in every language: they stand
  once, in `DEMO` (`visuals.tsx`), and a time of day is written by the shared formatters
  (`i18n/createFormatters.ts`) the way the page's language writes it.

## Design

The page wears the look of the app (design-system.md), "Schwarzlicht", at the size of a page: pure
black and white ink, the name in polished chrome over a field of light threads, headlines that rise
out of a clip, mono labels behind a turning spark, pills whose fill rises, frames with a faint light
from their corner, a ring of light that trails the pointer. All of it stays inside `#lp` and the
`.lp-*` classes of `landing.css`, which loads with this page alone; its tokens are the page's own
(`--lp-*` on `#lp`: black, the greys, Outfit and JetBrains Mono, `--lp-expo`), because the page's
bundle carries none of the app's components. The base layer of `globals.css` resets margins, lists
and buttons for it and lays the film grain over the window: `landing.css` adds no reset of its own,
because an `#lp` selector would outrank every class.

- **Light** (`landing/light.tsx`). `LightField` is a canvas of fine light threads behind the opening,
  thirty frames a second, resting while off screen or in a hidden tab; a canvas with no size (a
  document that lays nothing out) asks for no pen. `ChromeWord` sets the name in extruded chrome, each
  letter with a dark body, a moving metal face painted from the letter itself (`data-letter`, so the
  word stands in the page's text once), its own angle, and a few edges that catch the light.
  `PointerAura` is a ring that trails a mouse and opens over what can be pressed, and leans the frames
  marked `data-tilt` towards the pointer (at most six degrees) with a glare that follows. `.lp-ambient`
  is one wide glow far behind the page. All of it is decoration, hidden from assistive technology, and
  takes no clicks.
- **Frames.** A card is `.lp-glass`: a hairline, a 24px corner, the faint light from its top left
  corner; `.lp-spotlight` adds the pointer's light where the pointer is (`useSpotlight`).
- **Buttons.** `.lp-btn` is a pill whose fill rises from its foot; the main one (`.lp-btn-primary`,
  `.lp-btn-lg` at 56px) is white with its arrow in a round black chip that turns up under the pointer.
  A second way is a drawn link (`.lp-arrow-link`, `.lp-link`): its line draws itself. One white
  button per screen.
- **Type.** Outfit at 600 and −0.045em with a line height near 1: `.lp-hero-title` for the headline,
  whose lines rise out of a clip one after the other and whose last line is quieter
  (`.lp-hero-accent`); `.lp-h2` (up to 5rem) for a section; `.lp-display` for the house rules and the
  closing, the closing's in metal. Labels are JetBrains Mono capitals at 0.14em; a section's kicker
  (`.lp-kicker`) stands behind the turning spark with its number. `useFitHeadings` brings a heading
  with one long word down to its column, and a heading breaks where the catalog has its `\n` (`Lines`).
  Chinese has no glyphs in the display face and takes the platform's own bold face.
- **The band.** Large words pass by, every second one hollow (a line of light around black), drawn
  sparks between; the row is there twice so it runs on without a seam, the copy hidden from assistive
  technology. It stops under the pointer.
- **The parts of the app** are one pill of tabs with the chosen one white (`role="tablist"`, arrow
  keys move between them); the questions are rows on hairlines with a plus in a chip.
- **Motion.** The page moves, and everything that moves by itself can be stopped (WCAG 2.2.2): what
  loops runs on `--lp-play`, which the footer's switch ("Pause motion", kept in this browser under
  `tavvit.landing.motion`, `#lp[data-motion='off']`) and `prefers-reduced-motion` turn to `paused`;
  `MotionContext` tells the canvas and the ring the same, so the light field then shows one still frame
  and the ring is not there. `landing.test.tsx` holds every looping rule of `landing.css` to
  `--lp-play` and the switch to what it says. Each part arrives once, when it first comes into view:
  `useArrivals` sets `data-arrivals` on the page and `data-in` on a `[data-arrive]` element the first
  time it intersects, watches what the page mounts later too (a change of language mounts what it
  translates anew), and the stylesheet keeps such an element at the first frame of a paused animation
  until then. It is an animation and not a hidden state, so a page whose animations are stopped (the
  release check's pictures), a browser without `IntersectionObserver` and a reader under
  `prefers-reduced-motion` all see everything in place. The prerendered page is on screen before the
  script comes, so when it is taken over (`prerendered`) what is already in sight, or scrolled past,
  is marked `data-in="shown"` and stays where it is; only the parts further down arrive.
- **Clicks.** Whatever is laid over the page (the light, the ring, the scene's decoration, a card's
  glare) takes none: the scene's rings once lay over the opening's buttons, so `.lp-hero-in` stands
  above the scene and its decoration has `pointer-events: none`. `release-check-browser.mjs` asks the
  browser's hit test about each thing that can be used.
- **Forced colours and higher contrast.** Metal is paint: where the reader sets the colours the chrome
  word, the metal headline and the hollow words are plain text, and the light, the ring and the glow
  are gone.
- **Size tokens.** No raw `vh` or `vw`: the page uses `--app-vh` and `--app-vw` like the app
  (`platform/viewportTokens.test.ts`). The nav lets what passes under it show through, blurred, draws
  its hairline once the page has moved and shows how far it has been read (`useScrolled`). A heading
  a link aims at, and `#features`, keep `scroll-margin-top`.
- **Below 1100px** the opening's row stacks and the nav's links close up. **Below 760px** buttons
  stand under each other, every grid is one column and the scene's cards stand in the page's flow.

## The pictures

The page itself shows none since 1.42 ("What is on it"); the pictures are kept for the stage and for
the link preview. Real screens of the real app with invented people, taken by `scripts/landing-shots/`
from a scratch instance (its README has the commands). It writes `landing/assets/*.webp`,
`landing/imageSizes.ts` (so the page keeps its layout while they load) and, with `card.mjs`,
`public/social-card.jpg`: the link preview, the window just taken beside the logo, the headline and
the lead, drawn in Chrome from `social-card.html` with the page's own material (the frame tone, the
light from above with its grain, the logo's rings, the display type with its ink, the window's frame).
`card.mjs` also runs alone, redrawing the card from the window there is. **Retake them when the app's
look changes**, or the page shows an app that no longer exists. The screens are in English; the alt
texts are translated.

There are five: the inside window (`window`), the phone's conversation (`phone`) and channel list
(`phone-channels`), the bot's card (`bot-card`) and the app's Explore page (`community`). Night Shift
has a banner (painted by `seed.mjs` itself, so no picture of it lives in the repository), which heads
its channel column in the window. The four keys and the parts they light (`WINDOW_KEYS`) were measured
on that window. The bot has a channel of its own, so the big window stays calm. Night Shift is also
the space the stage draws and lets be walked through (`planData.ts`): its rooms, people, roles,
statuses, thread, poll and event are the seed's, so when the seed changes the stage follows. The
other spaces hold conversations of their own, which the window's tabs name.

## What it may say

Every feature named on the page exists in the app; keep it that way when something is removed.
It does not promise federation (off by default), native phone apps, end-to-end encryption or any
number of users. It says nothing about what Tavvit costs, because that has not been decided. Discord
is named only for what can be brought over from it, as plain words with no logo: a server template's
roles, categories, channels and permissions, and the server's emoji and stickers through a bot of the
person's own. Five statements depend
on how the instance is run: voice needs LiveKit (`COMPOSE_PROFILES=voice`), Explore needs Discovery
turned on (Admin console → General), the Windows download needs a published desktop release, bots
need turning on (Admin console → Bots) and two-factor sign-in needs `TOTP_ENCRYPTION_KEY`.
"No ads, no trackers" and "pictures from
other websites load only after you click" describe the code as it is (`docs/systems/legal.md`):
whoever changes that changes this page too.

The stage uses each feature as the app has it, the rules' hold on a member included, and says plainly what it leaves out on this page: its people are invented, nothing is sent or stored, the voice room touches no microphone or camera, and movie night loads no video, showing instead the consent the real feature asks before a video from another website loads.

It shows no number of users, no testimonials and no logos of customers, because there are none to
show, and it compares itself with no other app by name. What shows the product is alive comes from
the server: the status, the version, the newest line of what changed.

A shared link and the page do not describe Tavvit as self-hosted and do not advertise open source:
not `index.html` (description, Open Graph, `<noscript>`), not the website's head (`site/seo.ts`),
not the social card, not the manifest in `vite.config.ts`, not `locales/<lng>/landing.json`. There
is one exception, for a legal reason (AGPL section 13): the footer's Legal column keeps one plain
link, `footer.source`, to `sourceCodeUrl` ("Source code", no licence named). It stays.
`landing.test.tsx` holds all of this; `site/render.test.ts` holds the website's head, its structured
data and the social card to the same rules (no price, not self-hosted, not open source, no other app).
