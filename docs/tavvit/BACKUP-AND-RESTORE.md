# Backups and restoring

Two kinds of data matter, and they are backed up differently:

| Data | Where | Covered by `backup.sh` / automatic snapshots? |
| --- | --- | --- |
| Accounts, messages, spaces, settings | `data/backspace.db` | **Yes** |
| Avatars, attachments, uploaded images | `data/uploads/` | **Only with `bash backup.sh --with-uploads --to <place>`** |
| Your configuration and secrets | `.env`, `livekit.yaml` | **No.** Keep a copy somewhere safe |

(The database file keeps the name `backspace.db`; that is an internal name kept for
compatibility with upstream and has no other meaning.)

## Automatic snapshots

Tavvit snapshots the database by itself:

- **before every migration** (so a failed update can be undone),
- **on a schedule** (every 24 hours by default),
- **manually** with `bash backup.sh`,
- **before every update** done with `update.sh`.

They are consistent copies made with SQLite's online backup, so taking one does not
interrupt anybody. They are rotated per kind; the defaults keep 7 scheduled, 5
pre-migration and 10 manual ones. Tune it in `.env`:

```
BACKUP_INTERVAL_HOURS=24
BACKUP_KEEP_SCHEDULED=7
BACKUP_KEEP_PREMIGRATION=5
BACKUP_KEEP_MANUAL=10
```

Snapshots are written to `data/backups/`, **the same disk** as the database. That
protects against a bad update or a deleted message, not against a dead disk or a
stolen server. **Copy them off the machine.**

## Getting copies off the server

The easiest is one line in cron on the server, once a night, which copies the snapshots and the
uploaded files to another machine and warns you in the admin console, and by mail, if it fails or
stops running:

```bash
# crontab -e
0 4 * * * cd /opt/tavvit && bash backup.sh --copy-only --with-uploads --to backup@nas:/backups/tavvit >> data/backups/offsite.log 2>&1
```

`--to` takes what rsync takes (`user@host:/path`, or a folder on a disk you have mounted), or
`rclone:<remote>:<path>` for anything rclone knows, such as cloud storage. It needs rsync or rclone on
the server, and for rsync a way to log in without a password (`ssh-keygen`, `ssh-copy-id`). `--copy-only`
takes no new snapshot, since the server makes its own; leave it out to take one first. Nothing is ever
deleted at the other end. Keep `.env` and `livekit.yaml` somewhere safe yourself: they hold your secrets
and are deliberately not copied.

Or by hand, from your PC or from a second machine:

```bash
# From your PC: pull everything that matters (PowerShell/Windows Terminal with OpenSSH)
scp -r you@your-server:/opt/tavvit/data/backups ./orbit-backups/
scp -r you@your-server:/opt/tavvit/data/uploads ./orbit-uploads/
scp    you@your-server:/opt/tavvit/.env          ./orbit-env-backup

# From a second Linux machine, incrementally:
rsync -a --delete you@your-server:/opt/tavvit/data/uploads/ /backups/orbit/uploads/
rsync -a          you@your-server:/opt/tavvit/data/backups/ /backups/orbit/db/
```

The simplest automatic off-box copy is a cron job **on the server (or on another
machine)** that runs the `rsync`/`scp` above once a night.

Tavvit can also run a command of your choice after every new snapshot
(`BACKUP_OFFSITE_CMD` in `.env`). Know that it runs **inside the Tavvit container**,
which has no `rclone`, `rsync` or cloud tools, and it receives the snapshot's path as
its last argument (`<your command> "<snapshot>"`). So it is useful for copying to a
second disk or a network share that you mount into the container. For example, with
a share mounted at `/mnt/nas/orbit` on the host, add to a `docker-compose.override.yml`:

```yaml
services:
  backspace:
    volumes:
      - /mnt/nas/orbit:/offsite
```

and set in `.env`:

```
BACKUP_OFFSITE_CMD=cp -t /offsite
```

A failing hook is logged and never stops the backup.

Treat these copies as secrets: they contain every message and (hashed) password.
`.env` contains the key that signs logins.

## Restoring the database

```bash
cd /opt/tavvit
bash restore.sh                          # lists snapshots, newest first
bash restore.sh backspace-2026....-scheduled.db
```

It asks for confirmation, then:

1. stops the Tavvit container,
2. copies the **current** database to `data/backups/...-pre-restore.db` (so a
   restore can itself be undone),
3. clears the write-ahead-log files and installs the chosen snapshot,
4. starts the container again.

Uploaded files are left as they are. Messages that point to an attachment that was
uploaded after the snapshot show a broken file; that is the price of going back in
time.

## Restoring everything on a new server

1. Install Tavvit on the new machine from your archive (`DEPLOYMENT.md`, sections 2-3),
   but stop after the files are in place: `docker compose down` if it already started.
2. Put your saved `.env` and `livekit.yaml` back. **Keep the same `JWT_SECRET`** if
   you want people to stay signed in; a new one just signs everybody out.
3. Copy the saved `uploads` folder to `data/uploads/` and the snapshot you want to
   `data/backups/`. From a copy `backup.sh --to` made, that is
   `rsync -a backup@nas:/backups/tavvit/uploads/ data/uploads/` and
   `rsync -a backup@nas:/backups/tavvit/db/ data/backups/`.
4. `docker compose up -d`, then `bash restore.sh <snapshot>.db`.
5. Point the domain's DNS at the new server and wait for the certificate.

## Test your backup

A backup you have never restored is a hope, not a backup. Once, on a spare machine
or a spare folder, do the steps above and check that you can sign in and see old
messages.
