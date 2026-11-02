# Deploying Tavvit

This is the guide for putting Tavvit on your own server and keeping it running.
It assumes a Debian (or Ubuntu) machine, Docker, and that you are working on a
Windows PC and **upload the files to the server** instead of using git there.

> **Kurzfassung auf Deutsch** steht ganz unten: [Schnellstart (Deutsch)](#schnellstart-deutsch).

---

## 1. What you need

| | Minimum | Comfortable |
| --- | --- | --- |
| Server | 1 vCPU, 2 GB RAM, 10 GB disk | 2 vCPU, 4 GB RAM, 40 GB+ disk |
| OS | Debian 11/12 or Ubuntu 22.04/24.04, 64-bit | |
| Software | Docker Engine with the Compose plugin (`install.sh` can install it) | |
| Network | A domain name pointing at the server; ports **80** and **443** open | + voice ports, see [VOICE.md](VOICE.md) |

Notes on size:

- The **first image build** is the heavy part (it compiles the web app). It wants
  about 2 GB of free memory; on a 1 GB machine add swap first
  (`sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`).
- Running Tavvit for 5-30 friends needs roughly 150-300 MB of RAM for the app.
  Voice (LiveKit) adds some CPU while people talk; screen sharing is the most
  demanding part.
- Disk grows with uploads (`data/uploads`). Budget what your friends will share.

The server needs **no** Node.js, pnpm or git. Everything is built inside Docker.
You do need internet access on the server for the build (Docker Hub for the base
image, the npm registry for packages).

## 2. Package the files on your PC

On the Windows machine, in the project folder (you need Node.js and git there):

```powershell
node scripts/package-release.mjs
```

This writes `dist/release/tavvit-<version>-<id>.tar.gz` and a `.sha256` file next
to it. The archive contains exactly what the server needs, and fixes the things
that go wrong when files travel from Windows to Linux:

- all text files get Unix line endings (a script with Windows line endings fails
  on its very first line),
- shell scripts keep their executable bit,
- `.env`, `data/`, `node_modules/`, the desktop app and other things a server
  never uses are left out,
- a `MANIFEST` lists the SHA-256 of every file, so a damaged or incomplete upload
  is noticed instead of half-working.

The `<id>` in the name changes exactly when the content does; two archives with
the same name are the same release.

## 3. Upload and install (first time)

Upload the archive to the server. Any of these works:

```powershell
# PowerShell / Windows Terminal (OpenSSH is part of Windows 10/11)
scp .\dist\release\orbit-1.11.0-b9977d4c.tar.gz you@your-server:/tmp/
```

or WinSCP / FileZilla (SFTP) into `/tmp`. Upload the `.sha256` file as well if you
like; the update script checks it when it is next to the archive.

Then on the server:

```bash
# 1. A home for Tavvit. /opt/tavvit is a good choice; any folder you own works.
sudo mkdir -p /opt/tavvit && sudo chown "$USER" /opt/tavvit

# 2. Unpack. --strip-components=1 drops the archive's top-level folder.
tar xzf /tmp/orbit-1.11.0-b9977d4c.tar.gz -C /opt/tavvit --strip-components=1
cd /opt/tavvit

# 3. Install. It asks a few questions and does the rest.
bash install.sh
```

`install.sh` will:

1. install Docker if it is missing (after asking),
2. ask for your **domain** and how Tavvit is exposed (see [HTTPS](#5-https-and-reverse-proxies)),
3. ask whether to enable **voice**,
4. write `.env` with a freshly generated `JWT_SECRET` (an existing `.env` is
   backed up first, never overwritten blindly),
5. build the image and start Tavvit,
6. ask for the **name of the administrator account** and a password at a hidden
   prompt,
7. check that the site answers.

Run it with `bash install.sh` (not `./install.sh`): it works even if the upload
dropped the executable bit, and it restores that bit for the other scripts.

When it finishes, open `https://your-domain` and sign in.

### Set where your source code lives (licence requirement)

Tavvit is free software under the **AGPL-3.0**. Everyone who uses your server over
the network is entitled to the source code of the exact version you run. Publish
your copy of the repository (a public GitHub fork is simplest) and put its address
in `.env`:

```
TAVVIT_SOURCE_URL=https://github.com/<you>/tavvit
```

then `docker compose up -d`. Until you do, the **About** page, `doctor.sh` and the
boot log say that the offer is incomplete. Details: [LICENSING.md](LICENSING.md).

## 4. Invite your friends

Tavvit is **private by default**: registration is closed. Two ways in:

- **Invite links** (best for friends): *Admin console → Registration* →
  create a link, optionally with an expiry and a maximum number of uses. Send it;
  it opens the sign-up page already filled in. You can revoke a link any time.
- **You create the account** on the server:
  ```bash
  ./tavvit-admin.sh create alice --member --display-name "Alice" --generate
  ```
  `--generate` prints a one-time password. Give it to Alice and ask her to change
  it. (`bash tavvit-admin.sh ...` works too.)

More in [FIRST-ADMIN.md](FIRST-ADMIN.md).

## 5. HTTPS and reverse proxies

`install.sh` offers three modes (it detects which fits):

| Mode | Use when | Who handles HTTPS |
| --- | --- | --- |
| `allinone` | ports 80/443 are free on the server | the bundled **Caddy**, automatically (needs the domain's DNS to point here) |
| `proxy` | you already run nginx, Traefik, Caddy, Nginx Proxy Manager... | **your** proxy; Tavvit listens on `127.0.0.1:APP_PORT` |
| `tunnel` | Cloudflare Tunnel, Tailscale... | the tunnel (voice does not work through a tunnel, see [VOICE.md](VOICE.md)) |

In `proxy` and `tunnel` mode the installer prints a ready-to-paste config. For
nginx it looks like this (adapt the domain and certificate paths):

```nginx
server {
    listen 443 ssl http2;
    server_name chat.example.com;
    # ssl_certificate / ssl_certificate_key ...

    client_max_body_size 100m;           # match MAX_UPLOAD_SIZE in .env

    location / {
        proxy_pass http://127.0.0.1:8080;          # your APP_PORT
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;     # WebSocket
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}
```

Two things matter for correctness behind a proxy:

- **WebSockets** must be passed through (the `Upgrade` lines). Without them the
  page loads but nothing updates live.
- `TRUSTED_PROXY_HOPS` in `.env` must match how many proxies sit in front of the
  app (default `1`). It decides which address the rate limits count.

### More domains

The app runs under one address, `DOMAIN` in `.env`: sign-ins are per address, and invite links and voice are built from it. Any other domain you own forwards to it. Caddy reads extra sites from `data/caddy-sites/*.caddy` and gets a certificate for each by itself; updates never touch that folder.

1. Point an `A` record of each name at the server's IPv4 address. Add `AAAA` only if the server really answers on IPv6, because Let's Encrypt tries it first.
2. Create the file:
   ```bash
   sudo mkdir -p data/caddy-sites
   sudo tee data/caddy-sites/redirects.caddy >/dev/null <<'EOF'
   example.com, www.example.com {
       redir https://your-main-domain{uri}
   }
   EOF
   ```
3. Apply it: `docker compose up -d caddy` the first time after updating to 1.13.0 (the folder is new), `docker compose restart caddy` after later changes.
4. Watch it: `docker compose logs -f caddy`. A name whose DNS is not there yet is retried until it is.

`redir` answers with a temporary redirect by default. Use `redir https://your-main-domain{uri} permanent` only once the address is final, because browsers remember a permanent one.

### Changing the domain

Everyone signs in again afterwards, because sign-ins belong to an address; invite links made before keep their old address.

1. Point the new name at the server and wait until it resolves: `dig +short new.example`.
2. Replace the old name: `sed -i 's/old\.example/new.example/g' .env livekit.yaml`.
3. Make the old name forward, as under "More domains".
4. Bring everything up: `docker compose up -d`, and `docker compose restart livekit` if you use voice.

The desktop app has its address built in (`PRODUCTION_URL` in `packages/desktop/src/appUrl.ts`, `publish` in `electron-builder.yml`), so a new domain also needs a new desktop release. Keep the old name forwarding until the installed apps have updated: they fetch their update from it, following the redirect. Without it they are stranded, and people have to install the new version by hand from `/download`.

## 6. Updating

On your PC, make a new archive after changing the code:

```powershell
node scripts/package-release.mjs
scp .\dist\release\orbit-1.11.0-<new-id>.tar.gz you@your-server:/tmp/
```

On the server:

```bash
cd /opt/tavvit
bash update.sh --from /tmp/orbit-1.11.0-<new-id>.tar.gz --check   # what would change? (changes nothing)
bash update.sh --from /tmp/orbit-1.11.0-<new-id>.tar.gz           # do it
```

What the update does, in order:

1. checks the archive (checksum file, `MANIFEST`) before touching anything,
2. takes a **database snapshot** (`data/backups/`), and stops if that fails,
3. keeps a copy of the current source (`data/backups/source-<time>.tar.gz`) and a
   copy of any file you edited on the server (`data/backups/local-edits-<time>/`),
4. replaces the source files, removes the ones the new release dropped, and
   **never touches `.env` or `data/`**,
5. rebuilds the image and restarts only the Tavvit container,
6. waits for it to report healthy and confirms the container really runs the new
   image; if not, it **puts the previous image back**.

Everyone is briefly disconnected; clients reconnect on their own. Add `--yes` to
skip the confirmation (for scripts), `--no-backup` to skip the snapshot (don't).

If the update fails, read the next section.

### Publishing the desktop app

The Windows app opens https://tavvit.com directly and updates itself from the
same server. A release is three files in `data/downloads/desktop/`:

```powershell
# On the Windows PC, in the project folder
node scripts/bump-version.mjs 1.12.1            # every manifest moves together; installed apps only take a HIGHER version
pnpm --filter @backspace/desktop build
node scripts/package-desktop.mjs                # writes dist/release/tavvit-desktop-<version>.tar.gz
scp dist/release/tavvit-desktop-<version>.tar.gz you@server:/tmp/
```

```bash
# On the server (with sudo if your user is not uid 1000, which owns data/)
tar -xzf /tmp/tavvit-desktop-<version>.tar.gz -C /opt/tavvit/data
```

No restart is needed. The sign-in page, the About page and `/download` offer the
new installer at once. Installed apps check 10 seconds after they start and then
every 30 minutes, download the update by themselves and install it silently,
then start again: at once while the window is in the tray or minimised,
otherwise once nobody has used the computer for five minutes, and never during
a call. "Restart now" in the update notice installs straight away. What the
updater did is logged in `%APPDATA%\Tavvit\logs\updater.log`.

The version bump also moves the server's version, so build the server archive
from the same checkout when you release both.

An app older than 1.12.0 takes its first update with its old updater: it shows
"Restart now", or installs when Tavvit is quit from the tray. From 1.12.0 on,
updates install by themselves as described.

The installer is not code-signed, so Windows shows "unknown publisher" the first
time it runs.

### Updating from 1.12 or older to 1.13

The image is called `tavvit:local` from 1.13 on, and the `update.sh` on your server does not know that yet: it would compare against the old name, report that nothing changed and leave its health check and rollback out. Give it the new name first, once:

```bash
echo 'BACKSPACE_IMAGE=tavvit' >> .env
docker tag "$(docker inspect --format '{{.Image}}' backspace)" tavvit:local
bash update.sh --from /tmp/tavvit-1.13.0-<id>.tar.gz
bash publish-source.sh
```

`publish-source.sh` runs by hand this once, for the same reason. `update.sh` restarts only the app, so run `docker compose up -d` afterwards for Caddy to read the new `Caddyfile`.

## 7. When something goes wrong

**First, ask the doctor:**

```bash
bash doctor.sh
```

It checks Docker, `.env`, the program files (against the release's `MANIFEST`),
the container and its health, the app's own answers, HTTPS, voice and backups, and
says in plain words what is wrong and what to run. It only reads; it changes
nothing and never prints a secret.

**Logs:**

```bash
docker compose logs --tail 100 backspace     # the app (the service keeps its internal name)
docker compose logs --tail 100 caddy         # HTTPS / the bundled proxy
docker compose ps                            # what is running and healthy
```

**A failed update.** The script rolls the *image* back by itself when the new one
does not become healthy. If it could not, or you want the old *source* back:

```bash
cd /opt/tavvit
tar xzf data/backups/source-<time>.tar.gz          # the previous source files
docker compose build && docker compose up -d backspace
```

**A broken database** (after a failed migration, say): restore the snapshot taken
before the update.

```bash
bash restore.sh                      # lists snapshots, newest first
bash restore.sh <snapshot>.db        # asks first; saves the current DB as ...-pre-restore.db
```

Snapshots, uploads and off-site copies are covered in
[BACKUP-AND-RESTORE.md](BACKUP-AND-RESTORE.md).

**The upload went wrong** (`doctor.sh` says files are missing, or a script prints
`$'\r': command not found`): send the archive again. If you uploaded a *folder*
from Windows instead of the archive and the scripts have Windows line endings:
`sed -i 's/\r$//' ./*.sh`.

**Voice does not connect:** [VOICE.md](VOICE.md).

## 8. Health checks and monitoring

- `https://your-domain/api/health` answers `{"status":"ok"}` when the app is up.
  Point an uptime monitor at it.
- The container has a Docker health check; `docker compose ps` shows `healthy`.
- `bash doctor.sh` exits `1` if anything FAILED and `0` otherwise (warnings do not
  fail it), so it can run from cron:
  ```
  0 8 * * *  cd /opt/tavvit && bash doctor.sh >/tmp/orbit-doctor.txt || mail -s "Tavvit needs attention" you@example.com </tmp/orbit-doctor.txt
  ```

## 9. Server hygiene

- Keep `.env` private: `chmod 600 .env`. Whoever holds `JWT_SECRET` can mint a
  login for any account. Changing it signs everyone out.
- Firewall (ufw example): `sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp`
  and, for voice, `sudo ufw allow 7881/tcp && sudo ufw allow 3478/udp && sudo ufw allow 50000:60000/udp`.
- SSH: keys only, no password login; consider `fail2ban`.
- Keep the OS patched (`unattended-upgrades` for security updates) and Docker current.
- **Copy `data/backups/` and `data/uploads/` off the machine.** A backup on the
  same disk dies with the disk.

## 10. Files and folders

| Path | What it is |
| --- | --- |
| `.env` | your configuration and secrets (never uploaded, never overwritten by updates) |
| `data/backspace.db` | the database |
| `data/uploads/` | avatars and attachments |
| `data/backups/` | database snapshots, and the source copies `update.sh` makes |
| `livekit.yaml` | voice server configuration with its key (secret) |
| `MANIFEST`, `RELEASE` | which release this folder came from; `doctor.sh` and `update.sh` read them |

The service and container are still called `backspace` internally (kept so the
scripts and future upstream merges keep working). Nothing users see uses that name.

## 11. Removing Tavvit

```bash
cd /opt/tavvit
docker compose down            # stops it; data/ stays
# To delete everything including the database and uploads (irreversible):
# docker compose down -v && sudo rm -rf /opt/tavvit
```

---

## Schnellstart (Deutsch)

**Auf deinem Windows-PC** (im Projektordner; Node.js und git müssen installiert sein):

```powershell
node scripts/package-release.mjs
scp .\dist\release\tavvit-*.tar.gz du@dein-server:/tmp/
```

(oder die Datei per WinSCP/FileZilla nach `/tmp` hochladen)

**Auf dem Debian-Server:**

```bash
sudo mkdir -p /opt/tavvit && sudo chown "$USER" /opt/tavvit
tar xzf /tmp/tavvit-*.tar.gz -C /opt/tavvit --strip-components=1
cd /opt/tavvit
bash install.sh
```

Der Installer fragt nach deiner **Domain** (die muss per DNS auf den Server zeigen,
Ports 80 und 443 müssen frei sein), ob **Voice** an soll, und legt dann den
**Administrator** an. Danach erreichst du Tavvit unter `https://deine-domain`.

**Freunde einladen:** Admin-Konsole → Registrierung → Einladungslink
erstellen und verschicken. Die Registrierung ist sonst geschlossen.

**Aktualisieren** (nach Änderungen am Code, wieder `package-release.mjs` + hochladen):

```bash
cd /opt/tavvit
bash update.sh --from /tmp/orbit-NEU.tar.gz --check   # Vorschau, ändert nichts
bash update.sh --from /tmp/orbit-NEU.tar.gz           # ausführen
```

Das Skript sichert vorher die Datenbank, ersetzt nur den Programmcode (`.env` und
`data/` bleiben unberührt) und rollt automatisch zurück, wenn die neue Version nicht
gesund startet.

**Wenn etwas nicht klappt:** `bash doctor.sh` sagt dir in Klartext, was fehlt.
Logs: `docker compose logs --tail 100 backspace`. Backups: `bash backup.sh`,
Wiederherstellen: `bash restore.sh`.

**Wichtig (Lizenz):** Tavvit steht unter der AGPL-3.0. Veröffentliche deinen Code
(z. B. als öffentliches GitHub-Repository) und trage die Adresse in der `.env` als
`TAVVIT_SOURCE_URL=...` ein, siehe [LICENSING.md](LICENSING.md).
