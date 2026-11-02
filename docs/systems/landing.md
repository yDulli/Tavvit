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
when it is chosen, the phone's code (`qrcode-generator`) when it is nearly in sight, the newest
line of `locales/<lng>/changelog.json` after the first paint. Nothing is fetched from another
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

In order: the hero with the newest line of `/changelog`, the statement, the channel to try,
messages, voice, spaces with who is at your table, the switcher, everything around the conversation
(threads, polls, the welcome and events with their screens, voice messages, saved messages and
alerts as points), friends and profiles, themes, community, moving in, developers, no ads with what
protects an account, desktop and phone, the menu of features, questions, the final call, and the
footer with the status, the version and the closing line.

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
- **The second button of the hero** is the Windows download on Windows, the only desktop app there
  is, and a look around the page everywhere else.
- **The tavern.** The name comes from a tavern and the page starts with "Pull up a chair", so a small
  line above each heading (`eyebrow.*`) names its room of the house, the features are "the menu",
  and the page ends on a joke. Translate these by sense, not by word.

## Design

The composition follows rootapp.com, because the owner asked for that after a louder and then a very
plain version. **What is taken is the arrangement only: a big opening on one body of colour, large
colour cards with a real screen on glass plates, two-line headings whose second line takes the card's
colour, pill buttons.** Root's words, pictures, logo and typeface are not used, and its order of
colours is not either: the first colour here is Tavvit's violet. Keep it that way; a closer copy is a
legal question, and this closeness is on the list for the lawyer. All of it stays inside `#lp` and
the `.lp-*` classes of `landing.css`, which loads with this page alone, and it is the one place where
the design system's small radii and rule against colour do not hold.

- **Cards.** `FeatureCard` is `.lp-card` with a tone (`.lp-tone-violet`, `-blue`, `-coral`, `-teal`):
  dark at the words, the colour rising to the far corner, a fine grain (`--noise`) so the gradient does
  not band. The eyebrow of a two-column card stands on the tag (`.lp-tag`) on its screen; the channel
  to try has no tag, because a tag would cover its input. `.lp-card-center` has no columns or plates.
- **A body of colour.** `.lp-block` is as wide as the cards and starts below a section's heading, and
  its big window runs out at the bottom (`--past`). A glow behind a heading is what to avoid here.
- **Colour** comes in rooms: the opening, a card, a block, the final card. Everything between them,
  the tiles of the features, the menu and the questions, stays dark glass (`--glass`, `--glass-line`).
- **The logo** stands behind the opening and the final card as a hairline (`LogoLines`), white as the
  logo always is.
- **Type.** `.lp-display` for the hero and "No ads", `.lp-h2` with its gradient, `.lp-statement`,
  `.lp-lead`, `.lp-rule` for a card's paragraph. A new section takes these and adds none. Sentence case
  stays, because `capitalize` is wrong in German.
- **Fitting a heading.** `useFitHeadings` keeps a heading inside its column: a long word
  ("Присаживайтесь.") brings its size down through `--fit`. A card's heading breaks where the catalog
  has its `\n`, which `Lines` turns into two block lines; the `\n` itself stays in the text, so the
  heading's name is the catalog's.
- **Pictures** stand in `.lp-frame`. `WindowCrop` shows the part of the big window a section is about,
  at a size that can be read and with no new file. A picture on a slant (the opening, the fan of
  themes) takes no clicks: past the horizon of its perspective the browser's hit test wraps around,
  onto what is far away on the page.
- **The violet** is the disc of the main button, the word "New" and the focus ring. The main button
  is white.
- **Motion.** Nothing moves by itself and nothing moves on scroll: `landing.test.tsx` holds
  `landing.css` to that, and it is why the page needs no switch to stop it (WCAG 2.2.2). A button
  answers the pointer, an answer folds open, a new line of the demo and a group's picture fade in, all
  under `prefers-reduced-motion: no-preference`. Without it the page is the same page standing still.
- **Clicks.** Whatever is laid over the page must not take them, and that looks like nothing at all:
  `release-check-browser.mjs` asks the browser's hit test about each thing that can be used.
- **Size tokens.** No raw `vh` or `vw`: the page uses `--app-vh` and `--app-vw` like the app
  (`platform/viewportTokens.test.ts`). The nav lets what passes under it show through, blurred.
- **Below 1100px** a card stands one above the other with the screen first, without plates, and the
  language picker stays in the footer. **Below 760px** the phone screenshot in the hero, a strip of
  phone screens to swipe for Spaces, pills under each other, and the wide pictures show the part that
  can be read: the conversation of a group's picture, the panel of the thread.

## The pictures

Real screens of the real app with invented people, taken by `scripts/landing-shots/` from a
scratch instance (its README has the commands). It writes `landing/assets/*.webp`,
`landing/imageSizes.ts` (so the page keeps its layout while they load) and
`public/og-image.jpg`. **Retake them when the app's look changes**, or the page shows an app that
no longer exists. The screens are in English; the alt texts are translated.

Its community also holds a thread, a poll, an event, a welcome with rules and a bot. A space's
welcome opens over everything until it is answered, so it sits in Bookshelf, which is answered before
its picture is taken. The poll and the bot have channels of their own, so the big window stays calm.
The other spaces hold conversations of their own for the tabs under "Who's at your table?".

The voice room is `packages/web/dev-voice-room.html`: the real `VoiceGrid` and `VoiceControlBar`
with seeded stores, because a call needs a LiveKit server and other people.

## What it may say

Every feature named on the page exists in the app; keep it that way when something is removed.
It does not promise federation (off by default), native phone apps, end-to-end encryption or any
number of users. It says nothing about what Tavvit costs, because that has not been decided. Discord
is named only for what the template import reads, as plain words with no logo. Five statements depend
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
