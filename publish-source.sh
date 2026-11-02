#!/usr/bin/env bash
# Publish the source of the version this install runs, at
#   https://<your domain>/downloads/source/<release name>.tar.gz
#
# AGPL-3.0 section 13: everyone who uses a modified version over a network must be
# able to get its source. The archive is made from the files this release shipped
# (MANIFEST), so it is exactly what runs here, and the app's "Source code" link
# finds it by its build id. update.sh and install.sh run this.
#
# An install from a git checkout has no MANIFEST: set TAVVIT_SOURCE_URL in .env.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if [[ ! -f MANIFEST || ! -f RELEASE ]]; then
  echo "No MANIFEST or RELEASE here (a checkout?). Set TAVVIT_SOURCE_URL in .env instead." >&2
  exit 1
fi

name="$(sed -n 's/^name=//p' RELEASE | head -1)"
if [[ ! "$name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
  echo "RELEASE does not name this release." >&2
  exit 1
fi

if [[ -f .env ]] && grep -q '^DOWNLOADS_DIR=' .env; then
  echo "DOWNLOADS_DIR is set in .env, so the server looks elsewhere. Set TAVVIT_SOURCE_URL instead." >&2
  exit 1
fi

partial="$(mktemp "${TMPDIR:-/tmp}/tavvit-source.XXXXXX")"
trap 'rm -f "$partial"' EXIT

# What the release shipped, and nothing that could leave this folder or hold a secret.
sed 's/^[0-9a-f]\{64\}  //' MANIFEST \
  | while IFS= read -r path; do
      case "$path" in
        .env.example) ;;
        ''|/*|..|../*|*/../*|*/..|.env|.env.*|data/*) continue ;;
      esac
      if [[ -f "$path" ]]; then printf '%s\n' "$path"; fi
    done \
  | tar czf "$partial" --transform "s,^,$name/," MANIFEST RELEASE -T -

# data/ belongs to the container's user, so writing there may take sudo.
dir="data/downloads/source"
mkdir -p "$dir" 2>/dev/null || sudo mkdir -p "$dir"
as_owner() { if [[ -w "$dir" ]]; then "$@"; else sudo "$@"; fi; }

as_owner cp "$partial" "$dir/.$name.partial"
as_owner chmod 644 "$dir/.$name.partial"
as_owner mv "$dir/.$name.partial" "$dir/$name.tar.gz"

# Keep what runs and the one before it: until an update has proved itself, the
# version before it may be the one still running, or the one rolled back to. The
# server offers only the archive with its own build id.
ls -1t "$dir"/*.tar.gz | tail -n +3 | while IFS= read -r old; do as_owner rm -f -- "$old"; done

echo "Source published: $dir/$name.tar.gz"
