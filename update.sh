#!/usr/bin/env bash
# ============================================================
# Tavvit — update a running instance
# ============================================================
# Takes a database snapshot, brings in the newest source (from a release archive
# you uploaded, or from your git remote), rebuilds the image, restarts only the
# app service, waits for it to report healthy, and then verifies the container
# really is running the image that was just built. If any of that fails, it puts
# the previous image back.
#
# Usage:
#   bash update.sh --from FILE   Update from a release archive made by
#                                scripts/package-release.mjs and uploaded here.
#   bash update.sh               Update from your git remote (a git checkout), or
#                                just rebuild the source that is already here.
#   bash update.sh --check       Report what an update would do. Changes nothing.
#                                With --from, compares the archive to this install;
#                                without it, asks your git remote.
#   bash update.sh --yes         Update without prompting (for ssh and cron).
#   bash update.sh --no-backup   Skip the pre-update snapshot. Not recommended.
#
# Only the `backspace` service (Tavvit's internal service name) is ever named, and
# --remove-orphans is never passed. Production hosts run other containers in the
# same compose project and behind the same Caddy; an update to Tavvit has no
# business recreating or reaping any of them.
# ============================================================

set -euo pipefail
# Where the operator was when they ran this, so a relative --from path means what
# they typed. The script then works from its own directory.
CALLER_DIR="$PWD"
cd "$(dirname "$0")"

# Everything from here to the closing brace is ONE command. Bash has therefore
# read the whole script before it runs the first line, which matters because
# `--from` replaces this very file part-way through: a script that is rewritten
# while bash is still reading it can jump to the middle of a line. Do not add
# code after the closing brace.
{

# ── Output helpers (matching install.sh) ────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}  OK ${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERR]${NC} $*" >&2; }
step()    { echo ""; echo -e "${BOLD}${CYAN}─── $* ───${NC}"; echo ""; }

SERVICE="backspace"
CONTAINER="backspace"
HEALTH_TIMEOUT=180

MODE="update"
ASSUME_YES=false
DO_BACKUP=true
FROM_ARCHIVE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)     MODE="check" ;;
    --yes|-y)    ASSUME_YES=true ;;
    --no-backup) DO_BACKUP=false ;;
    --from)
      if [[ $# -lt 2 || -z "$2" ]]; then
        error "--from needs the path of a release archive."
        exit 1
      fi
      FROM_ARCHIVE="$2"
      shift
      ;;
    --from=*)    FROM_ARCHIVE="${1#--from=}" ;;
    --help|-h)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      error "Unknown option: $1"
      error "Run bash update.sh --help for usage."
      exit 1
      ;;
  esac
  shift
done

# The scripts may have lost their executable bit on the way here (an upload from
# Windows does that). Restore it so ./backup.sh and friends work afterwards.
chmod +x ./*.sh 2>/dev/null || true

case "$FROM_ARCHIVE" in
  ""|/*) ;;
  *) FROM_ARCHIVE="$CALLER_DIR/$FROM_ARCHIVE" ;;
esac

# ── Reading .env ────────────────────────────────────────────
# Same shape as install.sh's env_val: read a single value without sourcing the
# file, so a stray shell metacharacter in a value cannot execute anything.

env_val() {
  if [[ -f .env ]]; then
    grep "^${1}=" .env 2>/dev/null | head -1 | cut -d= -f2- || true
  fi
}

# ── Release archives (--from) ───────────────────────────────
# An archive made by scripts/package-release.mjs holds one top-level directory
# with every file the server needs, a MANIFEST in `sha256sum` format and a
# RELEASE file. It never contains .env or data/, so applying it cannot touch the
# configuration or the database.

STAGING=""
cleanup_staging() { [[ -n "$STAGING" ]] && rm -rf "$STAGING"; return 0; }
trap cleanup_staging EXIT

# Unpacks and checks the archive; sets RELEASE_DIR to the unpacked tree.
open_release() {
  local archive="$1"
  if [[ ! -f "$archive" ]]; then
    error "No such file: $archive"
    exit 1
  fi
  if ! command -v tar >/dev/null 2>&1 || ! command -v sha256sum >/dev/null 2>&1; then
    error "tar and sha256sum are needed to read a release archive."
    exit 1
  fi
  if [[ -f "$archive.sha256" ]]; then
    local want got
    want="$(cut -d' ' -f1 "$archive.sha256")"
    got="$(sha256sum "$archive" | cut -d' ' -f1)"
    if [[ "$want" != "$got" ]]; then
      error "$archive does not match $archive.sha256. The upload is damaged; send it again."
      exit 1
    fi
  fi
  STAGING="$(mktemp -d "${TMPDIR:-/tmp}/orbit-release.XXXXXX")"
  if ! tar xzf "$archive" -C "$STAGING"; then
    error "Could not unpack $archive. Is it the whole file?"
    exit 1
  fi
  local tops
  tops="$(find "$STAGING" -mindepth 1 -maxdepth 1)"
  if [[ -z "$tops" || "$tops" == *$'\n'* || ! -d "$tops" ]]; then
    error "$archive is not an Tavvit release (expected one top-level directory)."
    exit 1
  fi
  RELEASE_DIR="$tops"
  local required
  for required in MANIFEST RELEASE update.sh docker-compose.yml Dockerfile; do
    if [[ ! -f "$RELEASE_DIR/$required" ]]; then
      error "$archive is not an Tavvit release: $required is missing."
      exit 1
    fi
  done
  if ! (cd "$RELEASE_DIR" && sha256sum --quiet -c MANIFEST >/dev/null 2>&1); then
    error "Some files in $archive do not match its MANIFEST, so it is damaged."
    (cd "$RELEASE_DIR" && sha256sum -c MANIFEST 2>/dev/null | grep -v ': OK$' | head -10 | sed 's/^/       /') || true
    exit 1
  fi
}

release_field() {
  sed -n "s/^$2=//p" "$1/RELEASE" | head -1
}

# Paths in a MANIFEST are written by our own packager, but a path that could leave
# this directory is never followed.
safe_manifest_path() {
  [[ -n "$1" && "$1" != /* && "$1" != ".." && "$1" != ../* && "$1" != */../* && "$1" != */.. ]]
}

# What changes: prints "N new, N changed, N removed" against the installed MANIFEST.
describe_release_changes() {
  local dir="$1" new=0 changed=0 removed=0 hash path
  declare -A old_hash=()
  if [[ -f MANIFEST ]]; then
    while read -r hash path; do old_hash["$path"]="$hash"; done < MANIFEST
  fi
  declare -A new_paths=()
  while read -r hash path; do
    new_paths["$path"]=1
    if [[ -z "${old_hash[$path]+x}" ]]; then new=$((new + 1))
    elif [[ "${old_hash[$path]}" != "$hash" ]]; then changed=$((changed + 1))
    fi
  done < "$dir/MANIFEST"
  for path in "${!old_hash[@]}"; do
    [[ -z "${new_paths[$path]+x}" ]] && removed=$((removed + 1))
  done
  echo "$new new, $changed changed, $removed removed"
}

# Replaces the shipped files with the release's. Never touches .env or data/.
apply_release() {
  local dir="$1" stamp hash path
  stamp="$(date +%Y%m%d-%H%M%S)"
  mkdir -p data/backups

  if [[ -f MANIFEST ]]; then
    # A copy of every shipped file as it is now, so the previous source can be put
    # back by hand if the new one misbehaves.
    if sed 's/^[0-9a-f]\{64\}  //' MANIFEST \
        | while IFS= read -r p; do if [[ -f "$p" ]]; then printf '%s\n' "$p"; fi; done \
        | tar czf "data/backups/source-$stamp.tar.gz" MANIFEST RELEASE -T - 2>/dev/null; then
      success "Previous source saved to data/backups/source-$stamp.tar.gz"
    else
      warn "Could not save the previous source; continuing."
    fi

    # Files edited on this server since the last release are about to be replaced.
    # Keep a copy of each rather than discarding someone's change silently.
    local edited
    edited="$(sha256sum -c MANIFEST 2>/dev/null | sed -n 's/: FAILED$//p' || true)"
    if [[ -n "$edited" ]]; then
      mkdir -p "data/backups/local-edits-$stamp"
      while IFS= read -r path; do
        safe_manifest_path "$path" && [[ -f "$path" ]] || continue
        mkdir -p "data/backups/local-edits-$stamp/$(dirname "$path")"
        cp -p "$path" "data/backups/local-edits-$stamp/$path"
        warn "You had changed $path here; your copy is in data/backups/local-edits-$stamp/"
      done <<< "$edited"
    fi

    # Remove what the old release shipped and the new one no longer does.
    declare -A keep=()
    while read -r hash path; do keep["$path"]=1; done < "$dir/MANIFEST"
    while read -r hash path; do
      safe_manifest_path "$path" || continue
      if [[ -z "${keep[$path]+x}" && -f "$path" ]]; then
        rm -f -- "$path"
        rmdir -p --ignore-fail-on-non-empty "$(dirname "$path")" 2>/dev/null || true
      fi
    done < MANIFEST
  fi

  # tar keeps the modes the packager set (scripts executable), and the exclusions
  # make it impossible for an archive to overwrite the configuration or the data.
  tar -C "$dir" --exclude='./.env' --exclude='./data' -cf - . | tar -xpf -
  chmod +x ./*.sh 2>/dev/null || true
}

# The id the image is built with, shown beside the version. A git checkout has a
# commit; an uploaded release carries its own id.
build_id() {
  # The release just applied names what runs, whatever repository lies around it.
  if [[ -n "${NEW_RELEASE_ID:-}" ]]; then
    echo "$NEW_RELEASE_ID"
  elif git rev-parse --short HEAD >/dev/null 2>&1; then
    git rev-parse --short HEAD
  elif [[ -f RELEASE ]]; then
    sed -n 's/^name=.*-\([0-9a-f]\{8\}\)$/\1/p' RELEASE | head -1
  fi
}

RELEASE_DIR=""
NEW_RELEASE_ID=""
if [[ -n "$FROM_ARCHIVE" ]]; then
  open_release "$FROM_ARCHIVE"
  NEW_RELEASE_ID="$(release_field "$RELEASE_DIR" name | sed -n 's/^.*-\([0-9a-f]\{8\}\)$/\1/p')"
fi

# ── Phase 1: Preflight ──────────────────────────────────────

step "Checking this install"

if ! command -v docker >/dev/null 2>&1; then
  error "docker is not installed, or is not on PATH."
  exit 1
fi

DOCKER="docker"
COMPOSE="docker compose"
if ! docker info >/dev/null 2>&1; then
  if sudo docker info >/dev/null 2>&1; then
    DOCKER="sudo docker"
    COMPOSE="sudo docker compose"
    info "Using sudo for Docker commands."
  else
    error "Cannot connect to the Docker daemon."
    error "Is Docker running? Try: sudo systemctl start docker"
    exit 1
  fi
fi

if ! $COMPOSE version >/dev/null 2>&1; then
  error "'docker compose' is unavailable. This script needs Compose v2."
  error "On older hosts, upgrade Docker or install the compose plugin."
  exit 1
fi

if [[ ! -f .env ]]; then
  error "No .env in $(pwd)."
  error "Run this from your Tavvit install directory, or ./install.sh first."
  exit 1
fi

if [[ ! -f docker-compose.yml ]]; then
  error "No docker-compose.yml in $(pwd)."
  exit 1
fi

# Membership is tested in bash rather than by piping into `grep -q`.
# `grep -q` exits on its first match, which SIGPIPEs the upstream command, and
# under `set -o pipefail` that turns a passing check into a failing one. It
# reported "no backspace service" against a compose file whose first listed
# service is backspace.
contains_line() {
  local haystack="$1" needle="$2"
  [[ $'\n'"$haystack"$'\n' == *$'\n'"$needle"$'\n'* ]]
}

# COMPOSE_FILE lives in .env, and docker compose reads it from there, so proxy
# and tunnel installs resolve both files with no -f flags here.
compose_services="$($COMPOSE config --services 2>/dev/null || true)"
if ! contains_line "$compose_services" "$SERVICE"; then
  error "The compose project here defines no '$SERVICE' service."
  error "Check COMPOSE_FILE in .env, and that you are in the right directory."
  exit 1
fi

running_containers="$($DOCKER ps --format '{{.Names}}' 2>/dev/null || true)"
if ! contains_line "$running_containers" "$CONTAINER"; then
  error "The $CONTAINER container is not running."
  error "Start it first with: $COMPOSE up -d $SERVICE"
  exit 1
fi

success "Compose project and running container found"

# ── Reading the running instance ────────────────────────────

# Asks the app itself rather than inferring from a tag. It names the build the way
# a person would ("1.11.0 (a1b2c3d)"): the version and, when the image was built
# from a git checkout, the commit. A fork is updated by pulling commits, most of
# which do not touch the version number, so the version alone cannot tell two
# builds apart. This is for reporting; whether the update took effect is decided
# by comparing image IDs (Phase 8).
running_version() {
  $DOCKER exec "$CONTAINER" node -e '
    const port = process.env.PORT || 3000;
    fetch("http://localhost:" + port + "/api/instance/info")
      .then((r) => r.json())
      .then((j) => {
        const version = String(j.version || "");
        process.stdout.write(version && j.commit ? version + " (" + j.commit + ")" : version);
      })
      .catch(() => { process.exit(1); });
  ' 2>/dev/null || true
}

CURRENT_VERSION="$(running_version)"
if [[ -z "$CURRENT_VERSION" ]]; then
  warn "Could not read the running version from the container."
  warn "The update will proceed, but the post-update version check is skipped."
fi

# The image this container was created from. This exact ID is the rollback
# target, and comparing it after the pull is how a no-op update is detected.
ROLLBACK_IMAGE_ID="$($DOCKER inspect --format '{{.Image}}' "$CONTAINER" 2>/dev/null || true)"
IMAGE_REF="$($DOCKER inspect --format '{{.Config.Image}}' "$CONTAINER" 2>/dev/null || true)"

if [[ -z "$ROLLBACK_IMAGE_ID" || -z "$IMAGE_REF" ]]; then
  error "Could not determine the image the $CONTAINER container is running."
  error "Refusing to update without a rollback target."
  exit 1
fi

# The reference compose will actually deploy, which is not necessarily the one
# the running container was created from. An operator who repins
# BACKSPACE_IMAGE_TAG in .env changes the former without touching the latter, so
# rolling back against the running container's reference would restore the old
# image under a name compose no longer looks at, and the failed version would
# come straight back up.
target_ref_raw="$($COMPOSE config --images "$SERVICE" 2>/dev/null || true)"
TARGET_REF="${target_ref_raw%%$'\n'*}"
if [[ -z "$TARGET_REF" ]]; then
  TARGET_REF="$IMAGE_REF"
  info "Could not resolve the target image from compose; using $TARGET_REF."
fi

# prebuilt | source. install.sh records this after its pull/build decision.
# When it is missing (a hand-written .env), the image reference decides: a name
# that lives in a registry (it contains a slash, as in ghcr.io/you/orbit) is
# pulled, and a bare local name such as the default `tavvit:local` is rebuilt.
# Tavvit has no public image, so an unknown reference is a source install:
# guessing "pull" would fetch nothing and report that everything is up to date.
INSTALL_CHANNEL="$(env_val BACKSPACE_INSTALL_CHANNEL)"
if [[ -z "$INSTALL_CHANNEL" ]]; then
  if [[ "$IMAGE_REF" == */* ]]; then
    INSTALL_CHANNEL="prebuilt"
  else
    INSTALL_CHANNEL="source"
  fi
  info "No BACKSPACE_INSTALL_CHANNEL in .env; using '$INSTALL_CHANNEL' for $IMAGE_REF."
fi

echo ""
echo -e "  Running version   ${BOLD}${CURRENT_VERSION:-unknown}${NC}"
echo -e "  Image             ${IMAGE_REF}"
if [[ "$TARGET_REF" != "$IMAGE_REF" ]]; then
  echo -e "  Target image      ${TARGET_REF}  ${YELLOW}(repinned in .env)${NC}"
fi
echo -e "  Install channel   ${INSTALL_CHANNEL}"

if [[ -n "$FROM_ARCHIVE" && "$INSTALL_CHANNEL" != "source" ]]; then
  echo ""
  error "--from replaces source files, but this install runs a prebuilt image ($IMAGE_REF)."
  error "Nothing was changed."
  exit 1
fi

# ── --check: report and exit, touching nothing ──────────────
# There is no release feed for Tavvit to ask: Backspace's GitHub releases describe
# a different program. What can be compared is this checkout against the git
# remote you pull from, which is where an update would come from.

if [[ "$MODE" == "check" && -n "$FROM_ARCHIVE" ]]; then
  step "Comparing $FROM_ARCHIVE with this install"
  echo -e "  Release           ${BOLD}$(release_field "$RELEASE_DIR" name)${NC}"
  echo -e "  Version           $(release_field "$RELEASE_DIR" version)"
  echo -e "  Files             $(release_field "$RELEASE_DIR" files)"
  echo -e "  Against installed $(describe_release_changes "$RELEASE_DIR")"
  echo ""
  info "The archive is intact. Nothing was changed."
  exit 0
fi

if [[ "$MODE" == "check" ]]; then
  step "Checking your git remote for newer source"

  if [[ ! -d .git ]] || ! git rev-parse --git-dir >/dev/null 2>&1; then
    warn "This directory is not a git checkout, so there is no source to compare."
    warn "Update by copying the new source here, then run ./update.sh."
    exit 0
  fi
  if ! git remote get-url origin >/dev/null 2>&1; then
    warn "No 'origin' remote is configured, so there is nowhere to look for updates."
    exit 0
  fi
  if ! git fetch --quiet origin 2>/dev/null; then
    warn "Could not reach 'origin'. This says nothing about whether an update exists."
    exit 0
  fi
  upstream_branch="$(git rev-parse --abbrev-ref '@{upstream}' 2>/dev/null || true)"
  if [[ -z "$upstream_branch" ]]; then
    warn "The current branch tracks no remote branch. Set one with:"
    warn "  git branch --set-upstream-to=origin/<branch>"
    exit 0
  fi

  behind="$(git rev-list --count 'HEAD..@{upstream}' 2>/dev/null || echo 0)"
  ahead="$(git rev-list --count '@{upstream}..HEAD' 2>/dev/null || echo 0)"
  if [[ "$behind" -eq 0 ]]; then
    success "This checkout is up to date with ${upstream_branch}."
  else
    echo ""
    echo -e "  ${BOLD}${behind} newer commit(s) are available on ${upstream_branch}.${NC}"
    echo -e "  You are running ${CURRENT_VERSION:-an unknown version}."
    echo -e "  Update with: ${BOLD}./update.sh${NC}"
  fi
  if [[ "$ahead" -gt 0 ]]; then
    warn "This checkout is ${ahead} commit(s) ahead of ${upstream_branch}; those would not be pulled or lost."
  fi
  echo ""
  info "Nothing was changed."
  exit 0
fi

# ── Confirmation ────────────────────────────────────────────

if [[ "$ASSUME_YES" != true ]]; then
  if [[ ! -t 0 ]]; then
    error "Not running interactively and --yes was not given."
    error "Re-run as: ./update.sh --yes"
    exit 1
  fi
  echo ""
  if [[ -n "$FROM_ARCHIVE" ]]; then
    echo "This will snapshot the database, replace the source here with release"
    echo "$(release_field "$RELEASE_DIR" name) ($(describe_release_changes "$RELEASE_DIR")),"
    echo "rebuild, and restart the $SERVICE service. .env and data/ are not touched."
  else
    echo "This will snapshot the database, rebuild from the newest source, and restart"
    echo "the $SERVICE service."
  fi
  echo "Other containers are left alone. Clients reconnect on their own."
  read -rp "Continue? [y/N] " yn
  [[ "${yn,,}" == "y" ]] || { echo "Aborted. Nothing was changed."; exit 0; }
fi

# ── Phase 2: Refresh the checkout, tolerantly ───────────────

step "Refreshing the checkout"

if [[ -n "$FROM_ARCHIVE" ]]; then
  info "Using the uploaded release instead of a git remote; it is applied after the backup."
elif [[ ! -d .git ]]; then
  info "Not a git checkout, so there is nothing to pull."
  info "That is normal for an rsync-deployed host. The image update below still applies."
elif ! git rev-parse --git-dir >/dev/null 2>&1; then
  warn "A .git directory exists but git cannot read it. Skipping the pull."
elif ! git diff --quiet HEAD 2>/dev/null; then
  warn "This checkout has uncommitted changes, so it will not be pulled."
  warn "Your local edits are untouched. The image update below still applies."
elif ! git remote get-url origin >/dev/null 2>&1; then
  warn "No 'origin' remote configured. Skipping the pull."
elif git pull --ff-only 2>&1 | sed 's/^/       /'; then
  success "Checkout is up to date"
else
  warn "Could not fast-forward this checkout, most likely because it has diverged."
  warn "Nothing was rewritten. Resolve it by hand later if you want the newest"
  warn "compose files and scripts. The image update below still applies."
fi

# ── Phase 3: Back up ────────────────────────────────────────
# The one step whose failure is fatal. Everything after it is only safe to
# attempt because it happened.

step "Backing up the database"

if [[ "$DO_BACKUP" != true ]]; then
  warn "--no-backup given, so no snapshot was taken."
elif [[ ! -f ./backup.sh ]]; then
  error "./backup.sh is missing, so no snapshot can be taken."
  error "Re-run with --no-backup if you have a backup by other means."
  exit 1
elif bash ./backup.sh; then
  success "Snapshot written to data/backups/"
else
  error "The backup failed, so the update was not attempted."
  error "Nothing was changed."
  exit 1
fi

# ── Phase 3b: bring in the uploaded release ─────────────────

if [[ -n "$FROM_ARCHIVE" ]]; then
  step "Applying release $(release_field "$RELEASE_DIR" name)"
  release_changes="$(describe_release_changes "$RELEASE_DIR")"
  apply_release "$RELEASE_DIR"
  success "Source files replaced ($release_changes). .env and data/ were not touched."
  # The release may deploy under another image name than the one read above, and
  # comparing against the old name would look like nothing changed.
  target_ref_raw="$($COMPOSE config --images "$SERVICE" 2>/dev/null || true)"
  TARGET_REF="${target_ref_raw%%$'
'*}"
  TARGET_REF="${TARGET_REF:-$IMAGE_REF}"
  # AGPL-3.0 § 13: people on this server can download what it now runs.
  bash ./publish-source.sh || warn "Could not publish the source archive. Run: bash publish-source.sh"
fi

# ── Phase 4: Fetch the new image ────────────────────────────

step "Building the new image"

case "$INSTALL_CHANNEL" in
  source)
    info "From-source install: rebuilding $SERVICE."
    build_commit="$(build_id)"
    # AGPL-3.0 § 13: bake the commit (or the release id) so /api/instance/info
    # advertises the exact build, the same way install.sh does.
    if ! $COMPOSE build --build-arg BACKSPACE_COMMIT="$build_commit" "$SERVICE"; then
      error "The build failed. Nothing was restarted, so your instance is untouched."
      exit 1
    fi
    ;;
  *)
    info "Prebuilt-image install: pulling $TARGET_REF."
    if ! $COMPOSE pull "$SERVICE"; then
      error "The pull failed. Nothing was restarted, so your instance is untouched."
      exit 1
    fi
    ;;
esac

NEW_IMAGE_ID="$($DOCKER image inspect --format '{{.Id}}' "$TARGET_REF" 2>/dev/null || true)"

# ── Phase 5: Skip a no-op ───────────────────────────────────
# Restarting a chat server for nothing drops everyone in a voice call.

if [[ -n "$NEW_IMAGE_ID" && "$NEW_IMAGE_ID" == "$ROLLBACK_IMAGE_ID" ]]; then
  echo ""
  success "Already running the newest image. Nothing to restart."
  info "Version ${CURRENT_VERSION:-unknown} is current for $TARGET_REF."
  exit 0
fi

# ── Phase 6 and 7: Restart, then wait for healthy ───────────

wait_for_healthy() {
  local deadline=$(( SECONDS + HEALTH_TIMEOUT ))
  local status=""
  while (( SECONDS < deadline )); do
    status="$($DOCKER inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER" 2>/dev/null || echo "gone")"
    case "$status" in
      healthy) return 0 ;;
      none)
        # No healthcheck defined on this service. Fall back to "running".
        if [[ "$($DOCKER inspect --format '{{.State.Running}}' "$CONTAINER" 2>/dev/null || echo false)" == "true" ]]; then
          return 0
        fi
        ;;
    esac
    sleep 3
  done
  return 1
}

roll_back() {
  echo ""
  warn "Rolling back to the image you were running before."
  # Re-point the reference compose deploys at the previous image ID, then let
  # compose recreate from it.
  if ! $DOCKER tag "${ROLLBACK_IMAGE_ID#sha256:}" "$TARGET_REF"; then
    error "Could not re-tag the previous image. Roll back by hand:"
    error "  $DOCKER tag ${ROLLBACK_IMAGE_ID#sha256:} $TARGET_REF"
    error "  $COMPOSE up -d $SERVICE"
    return 1
  fi
  if ! $COMPOSE up -d "$SERVICE"; then
    error "Could not restart the previous image. Check: $COMPOSE logs $SERVICE"
    return 1
  fi
  if wait_for_healthy; then
    success "Rolled back to version ${CURRENT_VERSION:-the previous build}"
    echo ""
    warn "The local tag $TARGET_REF now points at the image you were running."
    warn "Once the problem is fixed, rebuild with: ./update.sh$(if [[ "$INSTALL_CHANNEL" != source ]]; then echo " (or $COMPOSE pull $SERVICE)"; fi)"
    return 0
  fi
  error "The previous image did not come back healthy either."
  error "Check: $COMPOSE logs $SERVICE"
  error "Restore the database with: ./restore.sh"
  return 1
}

step "Restarting $SERVICE"

# The service is named explicitly and --remove-orphans is never passed, so
# co-hosted containers in this project are not recreated or reaped.
if ! $COMPOSE up -d "$SERVICE"; then
  error "The restart failed."
  roll_back || true
  exit 1
fi

info "Waiting up to ${HEALTH_TIMEOUT}s for $CONTAINER to report healthy..."
if ! wait_for_healthy; then
  error "$CONTAINER did not become healthy within ${HEALTH_TIMEOUT}s."
  # Container state first. A container that exited produces no logs worth
  # tailing, and "exited with code 1" is the answer in that case.
  error "Container state: $($DOCKER inspect --format '{{.State.Status}} (exit code {{.State.ExitCode}})' "$CONTAINER" 2>/dev/null || echo unknown)"
  # The health probe output says why the check failed, which the service logs
  # often do not. During the rollback rehearsal the logs were empty and this was
  # the only line that explained anything.
  probe="$($DOCKER inspect --format '{{range .State.Health.Log}}{{.Output}}{{end}}' "$CONTAINER" 2>/dev/null || true)"
  if [[ -n "${probe// /}" ]]; then
    error "Last health probe output:"
    printf '%s\n' "$probe" | sed 's/^/       /'
  fi
  error "Recent logs:"
  $COMPOSE logs --tail 40 "$SERVICE" 2>&1 | sed 's/^/       /' || true
  roll_back || true
  exit 1
fi

success "Container is healthy"

# ── Phase 8: Verify the new image is what is running ───────
# A container that is healthy but still running the old image is a failed update,
# and this is the only check that catches it. It compares image IDs, which are
# exact. It does not compare version numbers: Tavvit is updated by pulling
# commits, and most commits do not change the version, so a version check would
# call every ordinary update a failure and roll it back.

step "Verifying the running build"

NEW_VERSION="$(running_version)"
RUNNING_IMAGE_ID="$($DOCKER inspect --format '{{.Image}}' "$CONTAINER" 2>/dev/null || true)"

if [[ -z "$RUNNING_IMAGE_ID" ]]; then
  error "Could not read which image the container is running."
  roll_back || true
  exit 1
elif [[ -n "$NEW_IMAGE_ID" && "$RUNNING_IMAGE_ID" != "$NEW_IMAGE_ID" ]]; then
  error "The container is healthy but is not running the image that was just built."
  error "The new image did not take effect."
  roll_back || true
  exit 1
fi

if [[ -n "$CURRENT_VERSION" && -n "$NEW_VERSION" && "$CURRENT_VERSION" != "$NEW_VERSION" ]]; then
  success "Updated from ${CURRENT_VERSION} to ${NEW_VERSION}"
else
  success "Tavvit is running the new build (${NEW_VERSION:-version unknown})"
fi

echo ""
echo -e "${BOLD}Done.${NC}"
echo "  Snapshot:  data/backups/  (restore with ./restore.sh)"
echo "  Logs:      $COMPOSE logs -f $SERVICE"
echo ""

exit 0
}
