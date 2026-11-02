<p align="center">
  <img src="packages/web/public/icons/logo.png" alt="Tavvit" width="140" />
</p>

<h1 align="center">Tavvit</h1>

<p align="center">
  A home for your friends and communities.<br />
  Channels, direct messages, voice and screen sharing in one quick, quiet app.
</p>

---

Tavvit is where a group of friends or a community talks, plays and keeps its things: no ads,
no trackers, and pictures from other websites load only when you click them. It runs at
[tavvit.com](https://tavvit.com), and in a single Docker stack on a small machine if you
want your own server.

It is a modified version of **[Backspace](https://github.com/TheZwiss/backspace)** by
Jannis Braun, under the same license (AGPL-3.0). See [Licensing](#licensing-and-attribution).

## What it does

- **Spaces** with text and voice channels, categories, roles and permissions.
- **Direct messages** and group chats, friends, presence, and what everyone is playing.
- **Home**: who is online, **who is on voice right now** (one click to join), unread
  conversations and open friend requests, on one page.
- **Voice, video and screen sharing** through LiveKit.
- **Private by default**: registration is closed, accounts are made from invite links you
  control or by you on the server, there is no "first visitor becomes admin" trap, and
  sign-in is rate-limited per account.
- **Yours**: choose the server's name and accent colour; the browser tab, the installed
  app and the colours follow.
- Works on **desktop and phone** (installable as an app), in five languages
  (English, Deutsch, Português, Русский, 简体中文).
- Messages with Markdown, code blocks, files and images, GIFs (optional), reactions,
- Pinned messages, spoilers, polls, forwarding, and push notifications to a phone while the app is closed
- Threads, forums with tags, announcement channels other spaces can follow, events with reminders, a welcome page with rules, and incoming webhooks
- Voice messages, saved messages with reminders, keyword alerts and a soundboard
- Bots with an HTTP and WebSocket API, closed by default and off until the operator turns them on
  replies, mentions and search.

## Put it on a server

You need a Debian/Ubuntu machine with a domain pointing at it. On your PC, in this folder:

```powershell
node scripts/package-release.mjs
scp .\dist\release\tavvit-*.tar.gz you@your-server:/tmp/
```

On the server:

```bash
sudo mkdir -p /opt/tavvit && sudo chown "$USER" /opt/tavvit
tar xzf /tmp/tavvit-*.tar.gz -C /opt/tavvit --strip-components=1
cd /opt/tavvit && bash install.sh
```

The installer sets up Docker if needed, asks for your domain, builds the image, starts
Tavvit and creates your administrator account. Then invite your friends from
*Admin console → Registration*. The full guide, including updating, voice,
backups and what to do when something goes wrong, is in
**[docs/tavvit/DEPLOYMENT.md](docs/tavvit/DEPLOYMENT.md)** (with a German quick start at its end).

| | |
| --- | --- |
| [DEPLOYMENT.md](docs/tavvit/DEPLOYMENT.md) | install, update, HTTPS and proxies, health checks, recovery |
| [FIRST-ADMIN.md](docs/tavvit/FIRST-ADMIN.md) | the first administrator, invites, accounts |
| [VOICE.md](docs/tavvit/VOICE.md) | LiveKit, ports, troubleshooting |
| [BACKUP-AND-RESTORE.md](docs/tavvit/BACKUP-AND-RESTORE.md) | snapshots, uploads, restoring |
| [LICENSING.md](docs/tavvit/LICENSING.md) | the AGPL and what you must do (one setting!) |
| [MODIFICATIONS.md](docs/tavvit/MODIFICATIONS.md) | what differs from Backspace |
| [PLAN.md](docs/tavvit/PLAN.md) | the plan, decisions and status of this fork |

> **Before others use it:** fill in Admin console → Legal (who runs the server, the
> terms, the privacy policy; [legal.md](docs/systems/legal.md)). The source the AGPL requires
> people to be able to get is served by your server itself, see
> [LICENSING.md](docs/tavvit/LICENSING.md).

## Developing

Requirements: Node.js 24 (see `.nvmrc`), pnpm 10 (`corepack enable`).

```bash
pnpm install
JWT_SECRET=$(openssl rand -hex 32) pnpm dev     # server on :3005, web on :5173
```

The dev database is created in `data/` at the repository root (and `.env` there is read, if you have one). Create an account without a registration
form: `pnpm --filter @backspace/server exec tsx src/scripts/tavvit-admin.ts create me --admin`.

```bash
pnpm typecheck        # shared build + every package + the i18n consistency check
pnpm lint
pnpm test             # every package
pnpm build            # shared, server, web (what the Docker image does)
```

| Folder | |
| --- | --- |
| `packages/server` | Fastify + SQLite (Drizzle) API, WebSocket, LiveKit tokens |
| `packages/web` | React + Vite + Tailwind client (PWA) |
| `packages/shared` | types, error codes and helpers shared by both |
| `packages/desktop` | upstream's Electron client; not part of Tavvit, see LICENSING.md |
| `scripts/` | icon generation, i18n check, release packaging, repo tooling |
| `docs/tavvit/` | the documents above |
| `docs/systems/` | upstream's architecture notes (still say "Backspace" in places) |

Some internals keep Backspace's names (`@backspace/*`, the `backspace` Docker service,
`backspace.db`) so upstream changes stay easy to merge; users never see them.

## Licensing and attribution

Tavvit is free software under the **GNU Affero General Public License v3.0**
([LICENSE](LICENSE)). It is a modified version of Backspace, © 2026 Jannis Braun; the
original notices are kept in [NOTICE](NOTICE). Tavvit is not the work of the Backspace
author and is not endorsed by him. "Backspace", its logo and its icons are trademarks of
Jannis Braun; Tavvit uses its own name and logo.

If you run Tavvit for others, the AGPL's section 13 applies: they are entitled to the
source of the version you run. [docs/tavvit/LICENSING.md](docs/tavvit/LICENSING.md)
explains how Tavvit helps you do that, and what is left for you.
