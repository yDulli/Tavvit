# Developer docs

The public pages at `/developers` and `/developers/docs/<page>`: what someone writing a bot or a webhook reads. They say how to use the API. How it works and what must stay true is in [bots.md](bots.md) and [webhooks.md](webhooks.md). The portal at `/developers/bots` is part of the app and is described in bots.md.

**Files:** `packages/web/developers/` (`pages.mjs`, `content/*.md`, `reference.mjs`, `build.mjs`, `plugin.mjs`, `assets/docs.css`, `assets/docs.js`, `assets/grain.svg`, `example-bot.mjs`, `build.test.ts`), `packages/server/src/utils/developerDocs.ts`, `packages/web/vite.config.ts`.

## What they are

Plain HTML, made while the web client is built. No app bundle, so a page is small, needs no script to read, and a search engine sees all of it. One script adds what only a browser can do: the search, the copy buttons, this instance's address in the examples, the calculator on the permissions page, and the source offer in the footer, since only the running server knows where that leads ([legal.md](legal.md), "Source offer"). Without it the pages lose those and nothing else: the search box and the calculator stay hidden, and the examples say `your.instance`.

**In English only,** as developer docs usually are, and as the default language is. The portal in the app is in the five languages.

## How they look

The look of the app and the product page (design-system.md, "Schwarzlicht"), in a stylesheet of their own (`assets/docs.css`), because these pages load no app: pure black with film grain, Outfit and JetBrains Mono from `/fonts`, pills, frames lit from their corner, mono labels behind a turning spark.

- **The start page** opens with the name in chrome (`chromeWord` in `build.mjs`: each letter stands in the page once, and the stylesheet paints the metal face from `data-letter`) over a hollow "Developers", the headline rising out of a clip, the lead and the two ways on. Then the four parts as frames that catch the pointer's light, a band of words that runs across the page (there twice, so it has no seam, and hidden from assistive technology), the example in a window frame and what one can count on as numbered rows.
- **A docs page** opens with its section as the eyebrow, its title rising out of a clip and the line about it, over a quiet band of light; code and tables stand in frames, the page before and the page after are two cards.
- **What moves is decoration**, and `docs.js` adds it last, each part on its own, so a browser that cannot draw one still has the search and everything else: the light threads behind a page's opening (a canvas in each `data-light` host, as the app's `ui/LightField.tsx`), a ring of light that trails a mouse and tells a frame marked `data-glare` where the pointer is, and what is below the first screen rising into view (`data-reveal`; what is already in sight is left alone, and without the script it is simply there). None of it runs under `prefers-reduced-motion`, where the stylesheet also stops every animation; forced colours turn the chrome and the hollow words into plain text.
- **The policy holds.** Nothing is inline: the letters' angles and the glints' places are rules of the stylesheet (`:nth-child`), the grain is a file beside it (`assets/grain.svg`, since `img-src 'self'` takes no `data:` picture), and the script moves things through the style object of an element (`element.style.setProperty`), which the policy allows, never by writing a `style` attribute.

Every instance serves its own copy, so they describe the version it runs and name its address.

## How they are made

`build.mjs` turns each `content/<page>.md` into `dist/developers/docs/<page>.html`, and adds `home.html`, `assets/search-index.json` and the assets. It uses what the client already depends on (`react-markdown`, `remark-gfm`, `prism-react-renderer`, `react-dom/server`), so it adds no dependency. While developing, `/developers` is answered by the API server from the last build's `dist/developers` (`vite.config.ts` proxies it), so after a change run `node packages/web/developers/build.mjs packages/web/dist/developers`; a new file among the assets needs the server restarted once, because the static handler lists its files when it starts.

`vite.config.ts` runs it through the plugin in `plugin.mjs`, once the bundle is written, in a process of its own: Node reads the shared package's TypeScript as it is, which Vite's bundling of its config would not. This folder is outside the client's `tsconfig`, which has no Node types to rely on in the Docker build. So `vite build`, `pnpm build`, the release check and the Docker image all make the docs, and a page that cannot be made fails the build. To look at them alone: `node packages/web/developers/build.mjs <folder>`.

The sources live in `packages/web` and not in `docs/` because the Docker stage that builds the client copies only `packages/web` and `packages/shared`. `.dockerignore` keeps their Markdown in.

## What is made from the code

A page holds `{{name}}` where a generated part goes, and `reference.mjs` fills it in. A name it does not know fails the build.

| Part | From |
|------|------|
| `routes` | `BOT_ROUTES` in `shared/src/bots.ts`, the list the server's test compares with the routes |
| `permissions`, and the calculator | `PermissionBits`, `DEFAULT_EVERYONE_PERMISSIONS`, the names in `locales/en/spaces.json` |
| `socketSends` | `BOT_SOCKET_EVENTS` |
| `cardLimits` | `CARD_LIMITS` |
| `commandLimits`, `botLimits` | `BOT_LIMITS` |
| `sizeLimits` | `MAX_MESSAGE_LENGTH`, `ACCOUNT_LIMITS` |
| `errorCodes` | `ERROR_CODES`, the texts in `locales/en/errors.json` |

So adding a route, a right, a limit or an error code needs no change here. **The rest is written by hand and has to be kept true by hand:** what a route takes and answers, the socket events a bot hears, the option types. When a bot's or webhook's behaviour changes, change these pages with it, and add it to `changelog.md`.

`build.test.ts` holds what can be held: every entry of `BOT_ROUTES` and `BOT_SOCKET_EVENTS` is on its page, every right and error code is listed, the calculator never offers `ADMINISTRATOR`, no page names an error code the server does not have, every link leads somewhere (a page, a heading on it, or `APP_LINKS` in `pages.mjs`), and no page has an inline script, a style attribute or anything from another server.

## How they are served

`registerDeveloperDocs` (`server/src/utils/developerDocs.ts`) answers `/developers`, `/developers/docs` (a redirect to the first page) and `/developers/docs/:slug`, ahead of the static handler. The same addresses with a slash at the end redirect to these: Fastify treats them as other addresses, and they would otherwise fall through to the app, which shows someone signed in that there is nothing here. A slug is `[a-z0-9-]` and nothing else, so no request can reach outside the folder. Everything else under `/developers`, above all `/developers/bots`, falls through to the app's page.

The output names no file `index.html`, because `@fastify/static` would make a route of it. `/developers/assets/*` are ordinary static files, revalidated rather than cached for long, since their names do not change with their content, and they count as static for the rate limit (`isStaticAssetPath`).

**The policy** is the pages' own, tighter than the app's ([web-security.md](web-security.md), section 4): `default-src 'none'`, and `'self'` for scripts, styles, pictures, fonts and the search index. So there is no inline script or style anywhere, and code is coloured by class: `build.mjs` takes the `style` off what `prism-react-renderer` gives.

**The service worker** must not answer these addresses with the app, so `vite.config.ts` keeps them out of `navigateFallback` and out of the precache (`globIgnores`). A link from the app to the docs is a plain `<a target="_blank">`: they are not the app's pages, leaving the app would end a call, and the desktop app hands such a link to the browser.

`robots.txt` allows them and disallows `/developers/bots`.

## The promise

Documented routes change only by adding to them: a new field, a new optional field, a new kind of socket event. Taking something away or changing what it means gets a new path, `/api/v2`, with the old one kept for a good while. `changelog.md` says this to developers, so **a breaking change to anything in `BOT_ROUTES` is a decision to be made here first**, not a detail of a release.

## Reporting a vulnerability

`/.well-known/security.txt` (RFC 9116, `routes/legal.ts`) names the operator's address from the legal details, and answers 404 until there is one. It leads to `/developers/docs/security`, which says how to report and what is asked of someone looking. An instance that has not filled in its legal details has no address to give.

## The example bot

`example-bot.mjs` is one file with no dependencies, served at `/developers/assets/example-bot.mjs`. It is a real bot: the release check for a version that changes the bot API runs it against a demo instance as a process of its own. Keep it working and short.

## Adding a page

Add it to `SECTIONS` in `pages.mjs` and write `content/<slug>.md`. The title and the description come from `pages.mjs`, and a `#` heading in the file is not shown. A link to something outside the docs has to be in `APP_LINKS`.

## Known limits

- The search looks through each page's first 4000 characters and its headings, and the error page's table is left out of it. It is a small index over small pages, not a search engine.
- The docs of an instance describe that instance's version. There is no page showing another version's API.
