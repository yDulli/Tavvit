#!/usr/bin/env bash
# Take a database snapshot inside the running Tavvit container, and copy what matters off this machine.
#
#   bash backup.sh                                       a snapshot, on this machine
#   bash backup.sh --to backup@nas:/backups/tavvit       and the snapshots there, with rsync
#   bash backup.sh --with-uploads --to backup@nas:/backups/tavvit   the uploaded files as well
#   bash backup.sh --with-uploads --to rclone:mycloud:tavvit        with rclone, to any remote it knows
#   bash backup.sh --copy-only --with-uploads --to ...   no new snapshot: the server makes its own
#
# A snapshot is a consistent copy of the DATABASE (accounts, messages, spaces, settings). Uploaded
# files (avatars, attachments) live in data/uploads and are NOT in it, and a copy on this machine
# does not survive losing this machine. See docs/tavvit/BACKUP-AND-RESTORE.md.
#
# Snapshots are written to data/backups/. update.sh takes one before every update. How the copy went
# is left in data/backups/offsite-status.json, and the admin console warns when it failed or is
# days old. Nothing is ever deleted at the other end.
set -euo pipefail
cd "$(dirname "$0")"

WITH_UPLOADS=0
COPY_ONLY=0
TARGET=""
while [ $# -gt 0 ]; do
  case "$1" in
    --with-uploads) WITH_UPLOADS=1 ;;
    --copy-only) COPY_ONLY=1 ;;
    --to)
      [ $# -ge 2 ] || { echo "Error: --to needs a place to copy to." >&2; exit 2; }
      TARGET="$2"
      shift
      ;;
    *) echo "Error: unknown option $1. See the top of backup.sh." >&2; exit 2 ;;
  esac
  shift
done

if [ -z "$TARGET" ] && { [ "$WITH_UPLOADS" = 1 ] || [ "$COPY_ONLY" = 1 ]; }; then
  echo "Error: --with-uploads and --copy-only need --to, a place to copy to." >&2
  exit 2
fi

if [ "$COPY_ONLY" = 0 ]; then
  DOCKER="docker"
  if ! docker info >/dev/null 2>&1; then
    if sudo docker info >/dev/null 2>&1; then
      DOCKER="sudo docker"
    else
      echo "Error: cannot reach the Docker daemon. Is it running, and are you in the docker group?" >&2
      exit 1
    fi
  fi

  # The compose service and container are still called 'backspace' (an internal
  # name, kept so upstream merges stay easy); nothing a user sees uses it.
  # Tested in bash rather than by piping into `grep -q`: its early exit can SIGPIPE the command
  # before it, which under pipefail turns a passing check into a failing one (see update.sh).
  running="$($DOCKER ps --format '{{.Names}}')"
  if [[ $'\n'"$running"$'\n' != *$'\n'backspace$'\n'* ]]; then
    echo "Error: the Tavvit container (named 'backspace') is not running." >&2
    echo "Start it with:  docker compose up -d" >&2
    exit 1
  fi

  $DOCKER exec -w /app/packages/server backspace \
    node --import tsx/esm src/scripts/snapshot.ts
fi

if [ -z "$TARGET" ]; then
  echo "Database only, on this machine. Uploaded files are in data/uploads and need their own backup: bash backup.sh --with-uploads --to <place> (docs/tavvit/BACKUP-AND-RESTORE.md)."
  exit 0
fi

# data/ belongs to the container's user, so someone else needs sudo to read it.
SUDO=""
if [ -e data/backups ] && [ ! -r data/backups ]; then SUDO="sudo"; fi

copy_folder() { # <folder under data/> <name at the other end>
  local from="data/$1" name="$2"
  [ -d "$from" ] || return 0
  case "$TARGET" in
    rclone:*)
      command -v rclone >/dev/null 2>&1 || { echo "rclone is not installed"; return 1; }
      $SUDO rclone copy "$from" "${TARGET#rclone:}/$name"
      ;;
    *)
      if command -v rsync >/dev/null 2>&1; then
        case "$TARGET" in
          *:*) ;;
          *) mkdir -p "$TARGET/$name" ;;
        esac
        $SUDO rsync -a "$from/" "$TARGET/$name/"
      else
        case "$TARGET" in
          *:*) echo "rsync is not installed"; return 1 ;;
        esac
        mkdir -p "$TARGET/$name"
        $SUDO cp -a "$from/." "$TARGET/$name/"
      fi
      ;;
  esac
}

json_string() {
  # A line of text as a JSON string. One line is enough to say what went wrong.
  printf '"%s"' "$(printf '%s' "$1" | head -n 1 | tr -d '\r' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
}

report() { # <ok: true|false> <reason>
  local at
  at="$(($(date +%s) * 1000))"
  local line
  if [ "$1" = true ]; then
    line="{\"ok\":true,\"at\":$at}"
  else
    line="{\"ok\":false,\"at\":$at,\"reason\":$(json_string "$2")}"
  fi
  printf '%s\n' "$line" | $SUDO tee data/backups/offsite-status.json >/dev/null 2>&1 || echo "Could not note how the copy went." >&2
}

mkdir -p data/backups 2>/dev/null || true

failure=""
if ! output="$(copy_folder backups db 2>&1)"; then
  failure="$output"
elif [ "$WITH_UPLOADS" = 1 ] && ! output="$(copy_folder uploads uploads 2>&1)"; then
  failure="$output"
fi

if [ -n "$failure" ]; then
  report false "$failure"
  echo "Error: the copy to $TARGET failed:" >&2
  echo "$failure" >&2
  exit 1
fi

report true ""
if [ "$WITH_UPLOADS" = 1 ]; then
  echo "Copied the snapshots and the uploaded files to $TARGET."
else
  echo "Copied the snapshots to $TARGET. Uploaded files were not copied: add --with-uploads."
fi
