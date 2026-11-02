# Licensing, attribution and what you must do

Tavvit is a **modified version of Backspace** (© 2026 Jannis Braun,
<https://github.com/TheZwiss/backspace>). It started from Backspace 1.11.0, upstream
commit `2885a7d3`. Backspace is licensed under the **GNU Affero General Public
License, version 3** (`AGPL-3.0-only`, the `LICENSE` file), and so is Tavvit. This page
explains what that means for you, the person who runs it, in plain words. It is not
legal advice.

## What you may do

- Run Tavvit for yourself and your friends, as long as you like, at no cost.
- Change it however you want.
- Give copies to other people, modified or not.

## What you must do

**1. Offer the source code to the people who use your server (AGPL § 13).**
This is the one that is specific to running a server. Because Tavvit is modified and
people use it over a network, **everyone who uses your server has the right to get
the source code of the exact version you are running**.

If you install from a release archive, this happens by itself: `update.sh` and
`install.sh` run `publish-source.sh`, which packs what the release shipped into
`data/downloads/source/`, and the *Source code* link points at it. An install that an
older `update.sh` brought to this version runs `bash publish-source.sh` once by hand.

If you run from a git checkout, or prefer a public repository:

1. Put your copy of the repository somewhere public (a GitHub fork is the simplest).
2. Set it in `.env` and restart:
   ```
   TAVVIT_SOURCE_URL=https://github.com/<you>/tavvit
   ```
3. Check: *Source code* in the legal links (the login page, the settings, **About**) now
   leads to it.

Until you do, Tavvit shows the link pointing at upstream (so it is never dead) but
says, in **About**, in `bash doctor.sh` and in the boot log, that the offer is
incomplete. Upstream's repository is *not* the source of what you run, because yours
differs from it.

Keep it true: when you deploy a new version, publish that version's source too. The
build id shown next to the version is a git commit if you build from a checkout, or
the id in the archive's name if you deploy a release archive.

**2. Keep the notices.** Do not remove the `LICENSE` file, `NOTICE`, or the copyright
statements in the source. Tavvit keeps them all.

**3. Say that you changed it (AGPL § 5(a)).** Tavvit's changes are described in
[MODIFICATIONS.md](MODIFICATIONS.md) with the upstream version they start from, and
the git history records the rest. If you change Tavvit further and pass it on, add your
own entries.

**4. License what you pass on under the AGPL.** If you give the code to someone (or
publish it), it is under the same license, in whole.

## Things that are easy to get wrong

**The name and logo.** "Backspace", the Backspace logo and its app icons are
**trademarks of Jannis Braun**. The AGPL does not give you any right to use them, and
Tavvit does not use them as its identity: it has its own name, logo and colours. It
*does* say, truthfully, that it is based on Backspace (README, `NOTICE`, the **About**
page); that is attribution, not endorsement. Do not name your server or domain
"Backspace", and do not present Tavvit as the Backspace project's work or as endorsed
by its author.

**The Tavvit logo.** The mark in `assets/brand/` and `packages/web/public/icons/` was
supplied by the owner of this Tavvit instance. Whoever gives a logo to a project must
have the right to; make sure you do. `NOTICE` distributes it on the same terms as
Tavvit's other changes unless its owner says otherwise.

**The name Tavvit.** The name and logo are reserved by the project's owner (`NOTICE`;
AGPL section 7(e)). You may run Tavvit and say that you do. A modified version that
you pass on to others needs a name of its own.

**The commercial license.** Backspace's author also offers a *separate commercial
license* for the upstream code (`LICENSE-COMMERCIAL.md`) for people who cannot accept
the AGPL. You do **not** need it to run Tavvit as described here: the AGPL already
covers you. It also says nothing about Tavvit's own changes. Similarly,
`CLA.md` is the agreement people sign to *contribute to upstream* (it gives the
maintainer an exclusive license to dual-license their contribution). It does not apply
to a private fork like this. If you ever want to send a change upstream, read it first.

**Internal names that still say "backspace".** The workspace packages are
`@backspace/*`, the Docker service and container are `backspace`, the database file is
`backspace.db`, and a few browser storage keys start with `backspace-`. These are
technical identifiers, kept so upstream merges stay easy and nothing breaks. Users do
not see them, and they are not used to present the product.

## Third-party software

Tavvit includes or uses, each under its own license (see `NOTICE`):

| Component | License | Where |
| --- | --- | --- |
| Inter (font) | SIL OFL 1.1 | bundled, `packages/web/public/fonts/` |
| npm dependencies (React, Fastify, Drizzle, ...) | mostly MIT / ISC / Apache-2.0 / BSD | `pnpm licenses list --prod` |
| sharp / libvips | LGPL-3.0-or-later (libvips) | image processing, used unmodified |
| LiveKit server | Apache-2.0 | separate container, only if you enable voice |
| Caddy | Apache-2.0 | separate container, only in `allinone` mode |
| Node.js | MIT | base image |

The Electron desktop app (`packages/desktop`) pulls in more components (for example an
MPL-2.0 module on Linux). Tavvit does not build or ship it.

## What was removed on purpose

To make Tavvit private by default, these upstream features were removed or switched
off: the project page with its donation/community/insight cards, the "say hi"
telemetry prompt, the browser page offering upstream's desktop installers, the update
check against upstream's GitHub releases, the mascot, and the public space directory
(off unless you configure a hub). Nothing in a default Tavvit install contacts any
other server. [MODIFICATIONS.md](MODIFICATIONS.md) lists them.

## Open items for the owner

Honest list of what is still your job:

1. **Check the source offer** (above): the legal links show *Source code*, and `bash doctor.sh` says whether it is complete.
2. **Be sure you hold the rights to the logo** you supplied.
3. **The desktop app is part of what you offer.** `packages/desktop` is in the release
   archive, so the source offer covers the installers your server serves, and the
   installers carry the licence text and the notices (`extraResources` in
   `electron-builder.yml`).
4. **Upstream's CI configuration** (`.github/workflows/`) is still in the repository.
   Those workflows publish upstream's website, images and metrics; if you push this
   repository to GitHub, disable or delete the ones you do not want.
5. `docs/systems/` and `CLAUDE.md` are upstream's developer documentation. They are
   accurate about the code but still say "Backspace" in places.
