#!/usr/bin/env bash
# Restore the Tavvit database from a snapshot in data/backups/.
#
#   bash restore.sh                 List the available snapshots, newest first.
#   bash restore.sh <snapshot.db>   Restore the named snapshot (path or file name).
#
# The current database is copied to data/backups/ first (as "...-pre-restore.db"),
# so a restore can itself be undone. Only the database is restored: uploaded files
# in data/uploads are untouched. See docs/tavvit/BACKUP-AND-RESTORE.md.
set -euo pipefail
cd "$(dirname "$0")"

BACKUP_DIR="data/backups"
DB="data/backspace.db"

DOCKER="docker"
COMPOSE="docker compose"
if ! docker info >/dev/null 2>&1; then
  if sudo docker info >/dev/null 2>&1; then
    DOCKER="sudo docker"
    COMPOSE="sudo docker compose"
  else
    echo "Error: cannot reach the Docker daemon. Is it running, and are you in the docker group?" >&2
    exit 1
  fi
fi

if [[ ! -d "$BACKUP_DIR" ]]; then
  echo "No backups directory at $BACKUP_DIR." >&2
  exit 1
fi

# No arg: list snapshots newest-first and exit.
if [[ $# -eq 0 ]]; then
  shopt -s nullglob
  snaps=("$BACKUP_DIR"/*.db)
  shopt -u nullglob
  if [[ ${#snaps[@]} -eq 0 ]]; then
    echo "No snapshots found in $BACKUP_DIR."
    exit 0
  fi
  echo "Available snapshots (newest first):"
  for f in $(ls -1t "$BACKUP_DIR"/*.db); do
    printf "  %s  (%s)\n" "$(basename "$f")" "$(du -h "$f" | cut -f1)"
  done
  echo ""
  echo "Restore with: bash restore.sh <snapshot-filename>"
  exit 0
fi

# Resolve the snapshot to a basename inside BACKUP_DIR (restore is always from data/backups/).
SNAP_NAME="$(basename "$1")"
if [[ ! -f "$BACKUP_DIR/$SNAP_NAME" ]]; then
  echo "Snapshot not found in $BACKUP_DIR: $SNAP_NAME" >&2
  exit 1
fi

echo "About to restore: $BACKUP_DIR/$SNAP_NAME"
echo "This will REPLACE $DB. The current DB is saved first as a pre-restore snapshot."
read -rp "Continue? [y/N] " yn
[[ "${yn,,}" == "y" ]] || { echo "Aborted."; exit 0; }

echo "[1/3] Stopping the Tavvit container..."
$COMPOSE stop backspace

# data/backspace.db and data/backups/ belong to the container's unprivileged user
# (uid 1000), so the host user may not be able to copy or remove them. The swap
# therefore runs inside a throwaway root container that mounts data/.
TS="$(date -u +%Y%m%dT%H%M%S)"
echo "[2/3] Swapping the database inside a root container (pre-restore copy, WAL clear, install)..."
$DOCKER run --rm -v "$(pwd)/data:/data" alpine sh -c '
  set -e
  if [ -f /data/backspace.db ]; then
    cp /data/backspace.db "/data/backups/backspace-$1-pre-restore.db"
  fi
  rm -f /data/backspace.db-wal /data/backspace.db-shm
  cp "/data/backups/$2" /data/backspace.db
' sh "$TS" "$SNAP_NAME"

echo "[3/3] Starting the Tavvit container..."
$COMPOSE start backspace
echo "Done. Watch it come up:  docker compose logs -f backspace"
