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

The opening is the product itself, to try ("The stage"); after it come numbered sheets, as a drawing
set numbers its sheets (`SHEETS` in `LandingPage.tsx`):

1. **The stage.** The newest line of `/changelog`, the headline ("Make room for your people."), the
   lead and the buttons; under them a window of the app in which Night Shift can be walked through
   and used; under it what the server says of itself (whether the chat runs, the version, no ads, no
   trackers).
2. **Inside:** the real window with four keys on it and the legend that answers them; a phone shows
   the same space's channel list instead.
3. **Developers:** the one piece of code, what a bot looks like, three points.
4. **House rules:** "No ads. No trackers." as large as the opening, then a datasheet: six figures of
   the app's own (no ads, no trackers, the languages, the themes, the people of a group message, the
   characters of a message; `figures.ts` holds the three limits and the test holds them to their
   sources, so the page does not pay for the modules that define them) beside what protects an account.
5. **Where it runs:** desktop and phone, with a code that opens this server on a phone.
6. **Moving in:** the app's Explore page, and opening a place of your own in three steps.
7. **Index** (`#features`, where the nav's "Features" leads): everything in the app, the menu of features.
8. **Questions**; then the closing call, and the footer with the status, the version and the closing line.

### The stage

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
- **The second button of the opening** is the Windows download on Windows, the only desktop app
  there is, and the way back in (Log in) everywhere else.
- **The voice.** The headline says what Tavvit gives a group, a place of its own ("Make room for your
  people."), and the stage lets it be walked into. The sheets' names (`chapters.*`) are plain. The
  tavern the page came from stays in the lines that earned it: the demo's welcome, the third step of
  moving in, the closing ("There's a seat free.") and the footer's last line. Translate those by
  sense, not by word.

## Design

The page is built from the app's own material, Graphite (design-system.md), and from nothing else:
it is what the app looks like, at the size of a document. All of it stays inside `#lp` and the
`.lp-*` classes of `landing.css`, which loads with this page alone. The tokens are the app's, from
`globals.css` (`--bg-*`, `--border-*`, `--text-*`, `--accent-*`, `--grain`, the fonts, the easings),
whose base layer also resets margins, lists and buttons for the page: `landing.css` adds no reset of
its own, because an `#lp` selector would outrank every class.

- **The stage's window** (`.lp-app`) is the app's: the frame tone for its bar, the sidebar tone under
  the plan (`.lp-app-map`), the content tone for the room (`.lp-app-room`), one deep shadow because a
  window floats. Its body is as tall as the screen leaves it, within bounds, so the whole stage stands
  in the first screen of a laptop and a long conversation scrolls inside it. The rooms are drawn with
  the demo channel's own pieces (`.lp-demo-bar`, `.lp-demo-line`, `.lp-demo-reaction`) and a few of
  their own (`.lp-room-*`, `.lp-thread-chip`, `.lp-clip`, `.lp-poll`, `.lp-watch`, `.lp-event`,
  `.lp-member`).
- **A set of drawings.** Every part after the stage is a sheet (`SheetHead`, `.lp-sheet-head`): a
  hairline across the page with its corners ticked, as a drawing's edge is, the sheet's number and
  name in Geist Mono, and the heading with its lead, side by side where there is room
  (`.lp-sheet-head-split`) and stacked below 1100px. Under it, a composition of its own: a window with
  a legend; code beside a card over three cells; display type over a datasheet; words beside a phone;
  a picture over three steps on a dimension line; an index; words beside a list of questions. Sections
  alternate between the frame tone (`--bg-base`) and the sidebar tone (`.lp-band`, `--bg-channel`),
  told apart by a step and a hairline, as the app's panels are.
- **The plan's drawing.** Floors in the content tone (`--bg-chat`); walls are the grid's 1px gaps in
  a lighter tone, the outer wall 2px; a door is an opening in the wall in the floor's tone with the
  leaf standing open and the arc it swings along (borders and one rounded corner), a pair of them in
  the outer wall at the way in; light falls into a lit room from above in its colour (`--room`, the
  accent family), with the lit top edge of the app's surfaces, and a little of it answers the pointer;
  a room the visitor may not enter is hatched. The wings are measured over the plan as a drawing
  measures: a line between ticks with the name on it. The people are the app's avatars without a picture.
- **The window answers.** Pointing at a part of the inside window with a mouse, or at its line in
  the legend, lights that part (`.lp-spot`: a violet hairline, the rest of the window dimmed) and marks
  its key and its legend line in the violet of what is chosen. The parts are `WINDOW_KEYS[].part`,
  shares of `window.webp` like the keys, and are looked at again when it is retaken. A touch scrolls as
  it always did, and the legend says the same in words.
- **Surfaces.** No card is a rounded tinted box. Points are cells of a hairline grid (`.lp-grid`: 1px
  of `--border-hard` between cells of the section's own tone), and so are the house rules' figures
  and points (`.lp-spec`); the index is rows on hairlines (`.lp-index`); the three steps stand on a
  dimension line (`.lp-steps`), which stands up beside them on a phone. A real screen stands in
  `.lp-frame` (8px, a hairline, a lit top edge); the big windows are `.lp-window` and `.lp-app` (10 to
  12px, the one deep shadow, because a window floats); a phone is `.lp-device`, a graphite rim at 30px,
  the one large radius, since it is a device and not a control. Controls keep the app's corners: 6px
  buttons and chips, 5px nav links, 4px marks and swatches.
- **Light.** `.lp-light` is the app's own construction: grain and a bloom behind the content, never
  on text. It falls in three places, in the accent: the stage (with the rings of the app's openings,
  `.lp-light-rings`), the house rules and the closing. The plan's rooms carry their own. Off under
  higher contrast, forced colours and `data-light='off'`; under higher contrast a lit room is outlined
  instead.
- **The violet** is the signal only: the visitor's point on the plan, the ring of someone looked for
  and the edge of the member chosen, the chosen look's border, the main action of a room (agreeing,
  walking in, joining, watching along) and the pressed state of a control, the lit part of the inside
  window and its key, the demo's own avatar, pressed reaction and send button, the focus ring, and the
  glow under the white button. On the plan it is otherwise only the light of #general, whose colour is
  the accent. Never a heading, never a label (the "New" mark is neutral), never the fill of a surface.
- **Type.** `.lp-stage-title` (680, up to 80px) for the headline; `.lp-display` (680, up to 96px) for
  the house rules and the closing; `.lp-h2` (640, up to 52px) for the sheets; all painted with
  `.lp-ink`, the app's `.ink`. Then `.lp-lead`, `.lp-body`, the cells' `.lp-cell-title` and
  `.lp-cell-body`, and `.lp-label`, which is `.label-mono`'s recipe; the plan speaks in 13px names and
  10px Mono, the rooms in the app's own sizes. Weights 400, 500 and 600, with 640 and 680 for display.
  Sentence case; no colour in a heading. `useFitHeadings` brings a heading with one long word down to
  its column, and a heading breaks where the catalog has its `\n` (`Lines`).
- **Buttons.** `.lp-btn-hero` is the app's `.btn-hero`, white with the accent's glow, one per
  screen: the stage's and the closing's. The nav's "Get started", "Keep your seat" and the links to
  the docs and the help are `.lp-btn-quiet` outlines; a room's own controls are the app's
  (`.lp-room-primary`, `.lp-voice-button`). No pills, no arrow discs.
- **The keys.** Four marks (`WINDOW_KEYS`, `.lp-mark`) stand on empty patches of the inside window
  (the tabs, the open channel's row, beside a message, the members' first group) and the legend under
  the window answers them (`hero.keys.*`). They are percentages of `window.webp`; when the pictures
  are retaken, look at them again. Their layer takes no clicks.
- **Pictures** stand straight, never on a slant: the inside window, the phone's channel list and its
  conversation, the bot's card and the app's Explore page. Below 760px a wide picture shows the part
  that can be read.
- **Motion.** Nothing moves by itself and nothing loops: `landing.test.tsx` holds `landing.css` to
  no `infinite`. What moves, moves because the visitor did something: the visitor walks to a room
  they chose (`useWalk.ts`, a CSS transition per stretch), a room's light fades in, a room opens with a
  fade, a reaction at movie night rises over the picture once and goes. For a reader under
  `prefers-reduced-motion` the visitor stands in the room at once, and a reaction only shows and goes
  where it was given. Each part of a sheet arrives once, when it first comes into view: `useArrivals`
  sets `data-arrivals` on the page and `data-in` on a `[data-arrive]` element the first time it
  intersects, watches what the page mounts later too (a change of language mounts what it
  translates anew), and the stylesheet keeps such an element at the first frame of a paused animation
  until then. It is an animation and not a hidden state, so a page whose animations are stopped (the
  release check's pictures), a browser without `IntersectionObserver` and a reader under
  `prefers-reduced-motion` all see everything in place. The prerendered page is on screen before the
  script comes, so when it is taken over (`prerendered`) what is already in sight, or scrolled past,
  is marked `data-in="shown"` and stays where it is; only the parts further down arrive. A hover
  answers (the white button rises, a hairline steps up, a nav link brightens), an answer folds open.
  No parallax, no scroll-linked transform, no autoplay, and so nothing WCAG 2.2.2 would ask to be
  stoppable.
- **Clicks.** Whatever is laid over the page (the key layer, the light, the window's spot, a room's
  light, the visitor's point) takes none, and what stands in a room (its people, its nook, its door) is
  part of its button: `release-check-browser.mjs` asks the browser's hit test about each thing that can
  be used.
- **Size tokens.** No raw `vh` or `vw`: the page uses `--app-vh` and `--app-vw` like the app
  (`platform/viewportTokens.test.ts`). The nav lets what passes under it show through, blurred, and
  draws its hairline once the page has moved (`useScrolled`). A heading a link aims at, and
  `#features`, keep `scroll-margin-top`, because an arrival still holds them a little lower when the
  scroll is measured.
- **Below 1100px** the stage's head stacks and its window stands the plan over the room, a sheet's head
  stacks, the legend has two columns, the datasheet stacks, and the language picker stays in the footer.
  **Below 760px** a phone shows the space's channel list where the inside window was, buttons stand
  under each other, every grid is one column, and the wide pictures show the part that can be read.

## The pictures

Real screens of the real app with invented people, taken by `scripts/landing-shots/` from a
scratch instance (its README has the commands). It writes `landing/assets/*.webp`,
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
