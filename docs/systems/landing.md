# Product page

The public page at `/`, shown to a visitor who is not signed in. It says what Tavvit is
and leads to registration and sign-in. Code: `packages/web/src/landing/`.

## Who sees it

`main.tsx` is the page's only script. It imports the stylesheet, `landing/entry.ts` and
`publicPages/entry.ts`, asks `showsLanding()`, and fetches one thing with a dynamic import
(`/status`, `/help`, `/changelog` and `/roadmap` are public pages of their own, operations.md):

| Situation | Result |
|-----------|--------|
| A browser tab at `/` with no `backspace_token` | `landing/boot.tsx`: the product page |
| Any other address (`/login`, `/channels/@me`, `/join/...`, `/imprint`) | `appBoot.tsx`: the app, and its router decides as before |
| A `backspace_token` is stored | The app. An expired token ends at `/login`, as it always did |
| Inside Electron (`window.backspace`) | The app. The desktop shell waits for `rendererReady`, which only the app sends |
| An installed web app (`display-mode` standalone, fullscreen, minimal-ui or window-controls-overlay; `navigator.standalone` on iOS) | The app |

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
visitor gets, gzipped, about 80 KB of script: the entry, `landing/boot`, React and i18next. The
budget is **150 KB**. The hero window is one picture, 91 KB, and what the section on messages shows
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

## How it is built

- **Document, not frame.** `boot.tsx` sets `data-page="landing"` on `<html>`, and that attribute
  alone gives this page normal document scrolling (`globals.css`). `interfaceScale.ts` does not
  run here, so the `desktop:` and `compact:` variants never match. The page has its own stylesheet,
  `landing/landing.css`, loaded only by `boot.tsx`: a person using the app never pays for it.
- **Language.** `landing/i18n.ts` sets up i18next with only the `landing` namespace, because
  `i18n/resources.ts` bundles every English catalog. It reads the same stored language as the
  app, and without one it is in English: the browser is not asked. The catalogs are
  `locales/<lng>/landing.json`. At the start a translated catalog is fetched
  before `init` and handed to it, because i18next works out `resolvedLanguage`, which the picker
  shows, from the bundles it holds at that moment. The footer's picker changes the language in
  place, with the catalog added first: the picker sits at the bottom, and a reload would start
  over at the top. If a fetch fails the page is plainly in English: the text, `lang` and the
  picker all say so.
- **Instance facts.** One plain `fetch('/api/instance/info')`, for `registrationOpen`,
  `sourceCodeUrl`, `version` and `twoFactor`, and one `fetch('/api/status')` for whether the chat
  runs. The page works without an answer, and then claims nothing: the footer's source link, its
  status and its version stay away. Two-factor sign-in is left out where the server answers that
  it has none, so the page does not promise what this server cannot do.
- **Search and previews.** `index.html` carries a static description, Open Graph tags and a
  `<noscript>` line; the server rewrites `og:image` to a whole address
  (`PUBLIC_ORIGIN`, or `https://DOMAIN`; `utils/webDocument.ts`). `public/robots.txt` keeps
  crawlers out of `/api/`, `/uploads/` and the app's own routes. The page sets `document.title`
  and the description in the visitor's language once it runs.

## What is on it

In order: the opening with the newest line of `/changelog`, the headline and its lead side by side,
and the real window with four keys on it and the legend that answers them; the statement, six figures
of the app's own (no ads, no trackers, the languages, the themes, the people of a group message,
the characters of a message; `figures.ts` holds the three limits, and the test holds them to their
sources, so the page does not pay for the modules that define them) and the contents of the page (where "Features" and "Explore
features" lead); then thirteen
chapters, each with its number and name in the margin: the channel to try, spaces with who is at your
table, conversations (the readable crop beside four marks, the switcher among them), everything around
the conversation (threads, polls, the welcome and events as a mosaic, with voice messages, saved
messages and alerts as points), voice, people (friends with a profile over them), your way (the seven
looks to pick), community (Explore, its points and the three steps of moving in), developers, no ads
with what protects an account, desktop and phone, the menu of features, questions; the closing call;
and the footer with the status, the version and the closing line. Beside all of it, on a window at
least 1280px wide, stands the rail of chapters, and Ctrl K opens the page's switcher (Design, "The page
as a space").

- **The channel to try** is `landing/DemoChat.tsx`: a channel drawn on this page, since the page may
  not import the app, so a change of the app's look has to be followed there by hand. It runs in
  that component alone: the people are invented, nothing is sent or stored, and what someone types
  is shown as words, with no link made of it. The page says so, and `landing.test.tsx` holds it to
  that (no request, nothing stored, no markup). Each line is said once; after that people only react.
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
  members cannot come, so people are invited with a link. The community chapter's point
  (`community.points.template`) and the menu (`features.items.template`) name the template alone.
- **The second button of the hero** is the Windows download on Windows, the only desktop app there
  is, and a look around the page everywhere else.
- **The voice.** The headline says what the product is ("Where your group talks."), and the chapter
  names in the margin (`chapters.*`) are plain. The tavern the page came from stays in the lines that
  earned it: the demo's welcome, the third step of moving in, the features as "the menu", the closing
  ("There's a seat free.") and the footer's last line. Translate those by sense, not by word.

## Design

The page is built from the app's own material, Graphite (design-system.md), and from nothing else:
it is what the app looks like, at the size of a document. It no longer takes anything from
rootapp.com; the colour cards, glass plates and pill buttons of the earlier page are gone, and with
them the question of that closeness. All of it stays inside `#lp` and the `.lp-*` classes of
`landing.css`, which loads with this page alone. The tokens are the app's, from `globals.css`
(`--bg-*`, `--border-*`, `--text-*`, `--accent-*`, `--grain`, the fonts, the easings), whose base
layer also resets margins, lists and buttons for the page: `landing.css` adds no reset of its own,
because an `#lp` selector would outrank every class.

- **A document of chapters.** After the opening and the statement come thirteen chapters. Each is a
  hairline across the page with its number and name in the margin (`Chapter`, `.lp-chapter-head`:
  the Geist Mono index, the heading and its lead side by side, stacked below 1100px) and a
  composition of its own under them: a window; tabs and a window; a split of marks and a crop; a
  mosaic; a window and three cells; two frames lying over each other; swatches and a window; a
  picture, six cells and three steps; code and a card; one line of display type on the axis; a
  window with a phone over it; a table; a list of questions. Sections alternate between the frame
  tone (`--bg-base`) and the sidebar tone (`.lp-band`, `--bg-channel`), told apart by a step and a
  hairline, as the app's panels are.
- **The page as a space.** What sets the page apart is that it reads as Tavvit does. On a window
  1280px or wider the chapters stand in a rail beside the page (`Rail`, `.lp-rail`, sticky under the
  nav), drawn with the app's own `.nav-item`: a mark for each, as a channel has its icon, the open
  chapter selected with the violet edge, one not yet read bright with its dot, and the category's
  count of what is left. `useReading` keeps that as the app keeps a channel's state: a chapter is
  read once it has been the open one (its section's top past a third of the window), so one skipped by
  a jump stays unread; nothing is stored. The brand stands over the rail as the app's stands over its
  sidebar, the statement's contents list gives way to the rail, and a chapter's index stands over its
  heading. At the rail's foot the status and the version are said in words; the footer links them, and
  the tests find each link once. "Jump to…" at the rail's top, and Ctrl K (Command K on an Apple
  device) anywhere, open the page's switcher (`Jump`): the app's `QuickSwitcher` written again in the
  page's own code, with `.modal-scrim`, `.glass-modal` and `.input-embedded`, the chapters (unread ones
  with their dot) and the pages, the arrows, Enter and Escape. A chapter is scrolled to and its heading
  takes the focus; a page is opened. Below 1280px a pill at the foot of the screen (`JumpPill`,
  `.glass-bubble`) names the open chapter and opens the same switcher. It is rendered only between the
  opening and the footer, so it never stands on the page's last links, and the release check's hit
  test never meets it hidden.
- **The window answers.** Pointing at a part of the opening's window with a mouse, or at its line in
  the legend, lights that part (`.lp-spot`: a violet hairline, the rest of the window dimmed) and marks
  its key and its legend line in the violet of what is chosen. The parts are `WINDOW_KEYS[].part`,
  shares of `window.webp` like the keys, and are looked at again when it is retaken. A touch scrolls as
  it always did, and the legend says the same in words.
- **Surfaces.** No card is a rounded tinted box. Points, facts, steps and the menu are cells of a
  hairline grid (`.lp-grid`: 1px of `--border-hard` between cells of the section's own tone; the
  mosaic of "Around the conversation" is the same with named areas). A real screen stands in
  `.lp-frame` (8px, a hairline, a lit top edge); the big windows are `.lp-window` (10px, the one
  deep shadow on the page, because a window floats); a phone is `.lp-device`, a graphite rim at
  30px, the one large radius, since it is a device and not a control. Controls keep the app's
  corners: 6px buttons, 5px nav links, 4px marks and swatches, 3px keycaps.
- **Light.** `.lp-light` is the app's own construction: grain and a bloom behind the content, never
  on text, in `--lp-place`, a registered property that fades over `--dur-slower` as `--place-color`
  does in the app, with the rings of the app's openings behind the hero (`.lp-light-rings`). It
  falls in four places: the opening and the closing in the accent; the spaces chapter in the colour
  of the chosen space (`PLACES`, the accent family, as the app lights a space); the looks chapter in
  the chosen theme's accent (`LOOKS[].accent`). Nowhere else; off under higher contrast, forced
  colours and `data-light='off'`.
- **The violet** is the signal only: the open chapter in the rail, the lit part of the window and its
  key, the chosen tab's edge and the chosen swatch's border, the
  demo's open channel bar, own avatar, pressed reaction and send button, the focus ring, and the glow
  under the white button. Never a heading, never a label (the "New" mark is neutral), never the fill
  of a surface.
- **Type.** `.lp-display` (680, up to 96px) for the headline, "No ads" and the closing; `.lp-h2`
  (640, up to 52px) for chapters; both painted with `.lp-ink`, the app's `.ink`. Then `.lp-lead`,
  `.lp-body`, `.lp-h3`, the cells' `.lp-cell-title` and `.lp-cell-body`, and `.lp-label`, which is
  `.label-mono`'s recipe. Weights 400, 500 and 600, with 640 and 680 for display. Sentence case; no
  colour in a heading. `useFitHeadings` brings a heading with one long word down to its column, and
  a card's heading breaks where the catalog has its `\n` (`Lines`).
- **Buttons.** `.lp-btn-hero` is the app's `.btn-hero`, white with the accent's glow, one per
  screen: the hero's and the closing's. The nav's "Get started", "Keep your seat" and the links to
  the docs and the help are `.lp-btn-quiet` outlines. No pills, no arrow discs.
- **The keys.** Four marks (`WINDOW_KEYS`, `.lp-mark`) stand on empty patches of the hero's window
  (the tabs, the open channel's row, beside a message, the members' first group) and the legend under
  the window answers them (`hero.keys.*`): this is what says what Tavvit is in one look. They are
  percentages of `window.webp`; when the pictures are retaken, look at them again. Their layer takes
  no clicks.
- **Pictures** stand straight, never on a slant. `WindowCrop` shows the readable part of the big
  window, and below 760px every wide picture shows the part that can be read: the conversation
  column of a window, the panel of the thread, the middle of the voice room and of a look.
- **Motion.** Nothing moves by itself and nothing loops: `landing.test.tsx` holds `landing.css` to
  no `infinite`. Each part of a chapter arrives once, when it first comes into view: `useArrivals`
  sets `data-arrivals` on the page and `data-in` on a `[data-arrive]` element the first time it
  intersects, watches what the page mounts later too (a change of language mounts what it
  translates anew), and the stylesheet keeps such an element at the first frame of a paused animation until
  then. It is an animation and not a hidden state, so a page whose animations are stopped (the
  release check's pictures), a browser without `IntersectionObserver` and a reader under
  `prefers-reduced-motion` all see everything in place. A hover answers (the white button rises, a
  hairline steps up, a nav link brightens), an answer folds open, a chosen picture cross-fades, the
  light fades to the chosen colour. No parallax, no scroll-linked transform, no autoplay, and so
  nothing WCAG 2.2.2 would ask to be stoppable.
- **Clicks.** Whatever is laid over the page (the key layer, the light, the window's spot) takes none:
  `release-check-browser.mjs` asks the browser's hit test about each thing that can be used.
- **Size tokens.** No raw `vh` or `vw`: the page uses `--app-vh` and `--app-vw` like the app
  (`platform/viewportTokens.test.ts`). The nav lets what passes under it show through, blurred, and
  draws its hairline once the page has moved (`useScrolled`). A heading the contents aim at keeps `scroll-margin-top`,
  because its arrival still holds it a little lower when the scroll is measured.
- **Below 1280px** the rail gives way to the pill and the statement's contents list, and the
  Explore picture takes the width with its points in a row under it. **Below
  1100px** a chapter's head stacks, a split stands one above the other, the demo loses its member
  list, the legend has two columns, and the language picker stays in the footer. **Below 760px** the
  phone screenshot in a device frame stands in the hero, a strip of phone screens to swipe opens
  Spaces, buttons stand under each other, every grid is one column, the tabs scroll sideways, and
  the wide pictures show the part that can be read.

## The pictures

Real screens of the real app with invented people, taken by `scripts/landing-shots/` from a
scratch instance (its README has the commands). It writes `landing/assets/*.webp`,
`landing/imageSizes.ts` (so the page keeps its layout while they load) and
`public/og-image.jpg`. **Retake them when the app's look changes**, or the page shows an app that
no longer exists. The screens are in English; the alt texts are translated.

Its community also holds a thread, a poll, an event, a welcome with rules and a bot, and Night Shift has a banner (painted by `seed.mjs` itself, so no picture of it lives in the repository), which heads its channel column in the window. The four keys and the parts they light (`WINDOW_KEYS`) were measured on that window. A space's
welcome opens over everything until it is answered, so it sits in Bookshelf, which is answered before
its picture is taken. The poll and the bot have channels of their own, so the big window stays calm.
The other spaces hold conversations of their own for the tabs under "Who's at your table?".

The voice room is `packages/web/dev-voice-room.html`: the real `VoiceGrid` and `VoiceControlBar`
with seeded stores, because a call needs a LiveKit server and other people.

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

It shows no number of users, no testimonials and no logos of customers, because there are none to
show, and it compares itself with no other app by name. What shows the product is alive comes from
the server: the status, the version, the newest line of what changed.

A shared link and the page do not describe Tavvit as self-hosted and do not advertise open source:
not `index.html` (description, Open Graph, `<noscript>`), not the manifest in `vite.config.ts`, not
`locales/<lng>/landing.json`. There is one exception, for a legal reason (AGPL section 13): the
footer's Legal column keeps one plain link, `footer.source`, to `sourceCodeUrl` ("Source code", no
licence named). It stays. `landing.test.tsx` holds all of this.
