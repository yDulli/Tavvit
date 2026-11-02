#!/usr/bin/env bash
# Tavvit operator tool, run inside the running container.
#
#   ./tavvit-admin.sh create <username> --admin|--member [--display-name "Name"] [--generate|--password-stdin]
#   ./tavvit-admin.sh reset-password <username> [--generate|--password-stdin]
#   ./tavvit-admin.sh list
#   ./tavvit-admin.sh status
#   ./tavvit-admin.sh help
#
# This is how the first administrator is made: Tavvit is private by default, so
# there is no registration form that could do it. It is also the way back in if
# the administrator's password is lost. See docs/tavvit/FIRST-ADMIN.md.
#
# Passwords are typed at a hidden prompt, piped on stdin (--password-stdin), or
# generated and printed once (--generate). They are never command-line arguments.
set -euo pipefail
cd "$(dirname "$0")"

DOCKER="docker"
if ! docker info >/dev/null 2>&1; then
  if sudo docker info >/dev/null 2>&1; then
    DOCKER="sudo docker"
  else
    echo "Cannot reach the Docker daemon. Is it running, and are you in the docker group?" >&2
    exit 1
  fi
fi

running="$($DOCKER inspect -f '{{.State.Running}}' backspace 2>/dev/null || echo false)"
if [[ "$running" != "true" ]]; then
  echo "The Tavvit container is not running. Start it with:  docker compose up -d" >&2
  echo "(The compose service is still called 'backspace': an internal name kept so upstream scripts keep working.)" >&2
  exit 1
fi

# -i keeps stdin open for --password-stdin; -t as well gives the hidden password
# prompt a terminal. A terminal on only one side gets -i alone, which still works
# for piped input.
flags=(-i)
if [[ -t 0 && -t 1 ]]; then
  flags=(-it)
fi

exec $DOCKER exec "${flags[@]}" -w /app/packages/server backspace \
  node --import tsx/esm src/scripts/tavvit-admin.ts "$@"
