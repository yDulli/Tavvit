#!/usr/bin/env bash
# Tavvit doctor: checks this installation and says what is wrong, in plain words.
#
#   ./doctor.sh
#
# Read-only: it changes nothing, and it prints no secret (it checks that the
# JWT secret and the LiveKit key exist and agree, never what they are).
# Exit status is 1 if anything FAILED, 0 otherwise (warnings do not fail it), so it
# can run from cron or a monitoring check.
set -uo pipefail   # no -e: one failed check must not stop the others
cd "$(dirname "$0")"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
PASSES=0; WARNS=0; FAILS=0
pass() { PASSES=$((PASSES + 1)); echo -e "${GREEN}  PASS${NC}  $*"; }
warn() { WARNS=$((WARNS + 1)); echo -e "${YELLOW}  WARN${NC}  $*"; }
fail() { FAILS=$((FAILS + 1)); echo -e "${RED}  FAIL${NC}  $*"; }
note() { echo -e "${DIM}        $*${NC}"; }
heading() { echo ""; echo -e "${BOLD}$*${NC}"; }

# Reads one value from .env without sourcing it (a stray metacharacter in a value
# must not execute anything).
env_val() {
  if [[ -f .env ]]; then
    grep "^${1}=" .env 2>/dev/null | head -1 | cut -d= -f2- || true
  fi
}

CONTAINER="backspace"

echo -e "${BOLD}Tavvit doctor${NC}  ($(pwd))"

# ── Docker ──────────────────────────────────────────────────
heading "Docker"
DOCKER="docker"
if ! command -v docker >/dev/null 2>&1; then
  fail "docker is not installed or not on PATH."
  note "Install it: https://docs.docker.com/engine/install/"
  echo ""; echo -e "${BOLD}Cannot continue without Docker.${NC}"; exit 1
fi
if docker info >/dev/null 2>&1; then
  pass "Docker is reachable"
elif sudo -n docker info >/dev/null 2>&1; then
  DOCKER="sudo docker"
  warn "Docker needs sudo for this user."
  note "Add yourself to the docker group so the scripts work without it: sudo usermod -aG docker \$USER (then log in again)."
else
  fail "Cannot reach the Docker daemon."
  note "Is it running?  sudo systemctl start docker"
  echo ""; echo -e "${BOLD}Cannot continue without Docker.${NC}"; exit 1
fi

# ── Configuration ───────────────────────────────────────────
heading "Configuration (.env)"
if [[ ! -f .env ]]; then
  fail "There is no .env in this directory."
  note "Run ./install.sh, or copy .env.example to .env and fill it in."
else
  pass ".env exists"

  domain="$(env_val DOMAIN)"
  if [[ -z "$domain" || "$domain" == "example.com" ]]; then
    fail "DOMAIN is not set to your real address (it is '${domain:-empty}')."
  else
    pass "DOMAIN is ${domain}"
  fi

  secret="$(env_val JWT_SECRET)"
  if [[ -z "$secret" || "$secret" == change_me* ]]; then
    fail "JWT_SECRET is empty or a placeholder: anyone could forge a login."
    note "Generate one:  openssl rand -hex 32   (changing it signs everyone out)"
  elif (( ${#secret} < 32 )); then
    fail "JWT_SECRET is only ${#secret} characters; it must be at least 32."
  else
    pass "JWT_SECRET is set (${#secret} characters)"
  fi

  # Mode bits: anything readable by "others" is too open for a file of secrets.
  mode="$(stat -c '%a' .env 2>/dev/null || stat -f '%Lp' .env 2>/dev/null || echo '')"
  if [[ -n "$mode" ]]; then
    if [[ "${mode: -1}" != "0" ]]; then
      warn ".env is readable by every user on this machine (mode ${mode})."
      note "Tighten it:  chmod 600 .env"
    else
      pass ".env is not world-readable (mode ${mode})"
    fi
  fi

  if [[ "$(env_val REGISTRATION_OPEN)" == "true" ]]; then
    warn "REGISTRATION_OPEN=true: anyone who finds the address can create an account."
    note "Tavvit is meant to be invite-only. Set it to false (or switch it off in Settings → Instance → Registration)."
  else
    pass "Registration is closed by .env (invite links and the CLI only)"
  fi
  if [[ "$(env_val FEDERATION_ENABLED)" == "true" || "$(env_val FEDERATION_ENABLED)" == "1" ]]; then
    warn "Federation is ENABLED: this server accepts peer requests and its browser policy is relaxed."
  else
    pass "Federation is off"
  fi
  if [[ -z "$(env_val TAVVIT_SOURCE_URL)" && -z "$(env_val ORBIT_SOURCE_URL)" && -z "$(env_val BACKSPACE_SOURCE_URL)" ]] \
    && ! compgen -G "data/downloads/source/*-$(sed -n 's/^name=.*-\([0-9a-f]\{8\}\)$/\1/p' RELEASE 2>/dev/null | head -1).tar.gz" >/dev/null; then
    warn "No source offer: the AGPL-3.0 offer for this modified version is incomplete."
    note "Run: bash publish-source.sh   (or set TAVVIT_SOURCE_URL in .env; docs/tavvit/LICENSING.md)."
  else
    pass "Source offer is configured"
  fi
fi

# ── Program files ───────────────────────────────────────────
# An upload can go wrong quietly: a file cut short, or a Windows tool that turns
# every line ending into CRLF, which makes a shell script fail on its first line.
heading "Program files"
crlf_scripts=""
for script in ./*.sh; do
  [[ -f "$script" ]] || continue
  # Count the carriage returns with tr: a grep pattern made of one is unreliable.
  if (( $(tr -cd '\r' < "$script" | wc -c) > 0 )); then crlf_scripts="${crlf_scripts:+$crlf_scripts }${script#./}"; fi
done
if [[ -n "$crlf_scripts" ]]; then
  fail "These scripts have Windows line endings and will not run: ${crlf_scripts}"
  note "Fix them:  sed -i 's/\\\\r\$//' ./*.sh        Then upload with a tool that does not convert text files."
else
  pass "The scripts have Unix line endings"
fi
if [[ ! -f MANIFEST ]]; then
  note "No MANIFEST here (a git checkout or a hand copy), so the files cannot be checked against a release."
elif ! command -v sha256sum >/dev/null 2>&1; then
  warn "sha256sum is not installed, so the program files were not checked."
else
  bad="$(sha256sum -c MANIFEST 2>/dev/null | grep -v ': OK$' | grep -v 'WARNING' || true)"
  if [[ -z "$bad" ]]; then
    pass "Every program file matches release $(sed -n 's/^name=//p' RELEASE 2>/dev/null | head -1)"
  else
    missing="$(printf '%s\n' "$bad" | grep -c 'FAILED open or read' || true)"
    changed="$(printf '%s\n' "$bad" | grep -c ': FAILED$' || true)"
    if (( missing > 0 )); then
      fail "${missing} program file(s) are missing: the upload was incomplete."
      printf '%s\n' "$bad" | grep 'FAILED open or read' | head -5 | sed 's/: FAILED open or read//; s/^/          /'
      note "Upload the release archive again and run:  bash update.sh --from <archive>"
    fi
    if (( changed > 0 )); then
      warn "${changed} program file(s) differ from the release (edited here, or altered in transit)."
      printf '%s\n' "$bad" | grep ': FAILED$' | head -5 | sed 's/: FAILED$//; s/^/          /'
      note "Fine if you changed them on purpose. If not, upload the release archive again."
    fi
  fi
fi

# ── The running service ─────────────────────────────────────
heading "Service"
running="$($DOCKER inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || echo false)"
if [[ "$running" != "true" ]]; then
  fail "The Tavvit container ('${CONTAINER}') is not running."
  note "Start it:  docker compose up -d      Then look:  docker compose logs --tail 50 ${CONTAINER}"
else
  health="$($DOCKER inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER" 2>/dev/null || echo unknown)"
  case "$health" in
    healthy) pass "Container is running and healthy" ;;
    starting) warn "Container is still starting; run this again in a minute." ;;
    *)
      fail "Container is running but its health check says: ${health}."
      note "Look at:  docker compose logs --tail 80 ${CONTAINER}"
      ;;
  esac

  info_json="$($DOCKER exec "$CONTAINER" node -e '
    const port = process.env.PORT || 3000;
    fetch("http://localhost:" + port + "/api/instance/info")
      .then((r) => r.text()).then((t) => process.stdout.write(t))
      .catch(() => process.exit(1));
  ' 2>/dev/null || true)"
  if [[ -z "$info_json" ]]; then
    fail "The app did not answer on its own port inside the container."
  else
    pass "The app answers requests"
    # Read fields by name with node (no jq needed); each prints true/false/empty.
    field() {
      printf '%s' "$info_json" | $DOCKER exec -i "$CONTAINER" node -e '
        let d = ""; process.stdin.on("data", (c) => d += c).on("end", () => {
          try { const v = JSON.parse(d)[process.argv[1]]; process.stdout.write(v === undefined ? "" : String(v)); } catch { }
        });' "$1" 2>/dev/null || true
    }
    version="$(field version)"; commit="$(field commit)"
    pass "Running version ${version:-unknown}${commit:+ ($commit)}"
    if [[ "$(field setupRequired)" == "true" ]]; then
      fail "No account exists yet, and registration is closed: nobody can sign in."
      note "Create the administrator:  ./tavvit-admin.sh create <username> --admin"
    fi
    if [[ "$(field registrationOpen)" == "true" ]]; then
      warn "Registration is OPEN in the app right now (an administrator switched it on)."
    fi
    if [[ "$(field sourceCodeConfigured)" == "false" ]]; then
      warn "The app reports the AGPL source offer as unconfigured."
    fi
  fi
fi

# ── HTTPS ───────────────────────────────────────────────────
mode_deploy="$(env_val DEPLOY_MODE)"; mode_deploy="${mode_deploy:-allinone}"
domain="$(env_val DOMAIN)"
if [[ "$mode_deploy" == "allinone" && -n "$domain" && "$domain" != "example.com" ]] && command -v curl >/dev/null 2>&1; then
  heading "HTTPS"
  if curl -fsS --max-time 10 --resolve "${domain}:443:127.0.0.1" "https://${domain}/api/health" >/dev/null 2>&1; then
    pass "https://${domain} answers with a valid certificate"
  else
    warn "https://${domain} is not answering with a valid certificate yet."
    note "Caddy needs ${domain} to resolve to this machine and ports 80 and 443 open to the internet."
    note "Watch it work:  docker compose logs -f caddy"
  fi
  resolved="$(getent hosts "$domain" 2>/dev/null | awk '{print $1; exit}')"
  if [[ -n "$resolved" ]]; then
    note "${domain} currently resolves to ${resolved}. That must be this server's public address."
  else
    warn "${domain} does not resolve from this machine."
  fi
fi

# ── Two-factor authentication ───────────────────────────────
heading "Two-factor authentication"
totp_key="$(env_val TOTP_ENCRYPTION_KEY)"
if [[ -z "$totp_key" ]]; then
  warn "TOTP_ENCRYPTION_KEY is empty, so nobody can turn on two-factor authentication here, and anyone who has it cannot sign in."
  note "Generate one:  echo \"TOTP_ENCRYPTION_KEY=\$(openssl rand -hex 32)\" >> .env   then: docker compose up -d"
elif [[ "$totp_key" =~ ^[0-9a-fA-F]{64}$ ]] || (( ${#totp_key} == 44 )); then
  pass "TOTP_ENCRYPTION_KEY is set. Back it up with .env: without it, every two-factor secret is lost."
else
  fail "TOTP_ENCRYPTION_KEY is not 32 bytes (64 hex characters or base64); the server will refuse to start."
fi

# ── Email ───────────────────────────────────────────────────
heading "Email"
mail_transport="$(env_val EMAIL_TRANSPORT)"
case "${mail_transport:-none}" in
  none)
    pass "Email is off: a forgotten password is an administrator's to reset. To enable: docs/systems/email.md"
    ;;
  resend|smtp)
    if [[ -n "$(env_val EMAIL_FROM)" ]]; then pass "Sender: $(env_val EMAIL_FROM)"
    else fail "EMAIL_FROM is empty; the server will refuse to start."; fi
    if [[ "$mail_transport" == "resend" ]]; then
      if [[ -n "$(env_val RESEND_API_KEY)" ]]; then pass "RESEND_API_KEY is set"
      else fail "RESEND_API_KEY is empty; the server will refuse to start."; fi
      if [[ -z "$(env_val RESEND_WEBHOOK_SECRET)" ]]; then
        warn "RESEND_WEBHOOK_SECRET is empty: this server does not hear about bounces, and many of them can get the whole Resend account paused."
      fi
    else
      if [[ -n "$(env_val SMTP_HOST)" ]]; then pass "SMTP_HOST is set"
      else fail "SMTP_HOST is empty; the server will refuse to start."; fi
    fi
    note "Admin area, Email: send a test mail, and look for warnings. A mail in the spam folder looks like success from here."
    ;;
  *)
    fail "EMAIL_TRANSPORT must be none, resend or smtp; the server will refuse to start."
    ;;
esac

# ── Voice ───────────────────────────────────────────────────
heading "Voice and video"
lk_url="$(env_val LIVEKIT_URL)"
if [[ -z "$lk_url" ]]; then
  pass "Voice is not configured (text only). To enable: docs/tavvit/VOICE.md"
else
  profiles="$(env_val COMPOSE_PROFILES)"
  if [[ "$profiles" != *voice* ]]; then
    warn "LIVEKIT_URL is set but COMPOSE_PROFILES does not include 'voice', so no LiveKit server starts."
  else
    lk_running="$($DOCKER inspect -f '{{.State.Running}}' livekit 2>/dev/null || echo false)"
    if [[ "$lk_running" == "true" ]]; then pass "The LiveKit container is running"
    else fail "The LiveKit container is not running (docker compose up -d)."; fi
  fi
  lk_key="$(env_val LIVEKIT_API_KEY)"
  if [[ -z "$lk_key" || -z "$(env_val LIVEKIT_API_SECRET)" ]]; then
    fail "LIVEKIT_API_KEY or LIVEKIT_API_SECRET is empty."
  elif [[ -f livekit.yaml ]]; then
    if grep -qF "$lk_key" livekit.yaml; then pass "livekit.yaml uses the same API key as .env"
    else fail "livekit.yaml does not contain the API key from .env: voice sign-in will be refused."; fi
  else
    warn "livekit.yaml is missing; the LiveKit container cannot start without it."
  fi
  if [[ "$mode_deploy" == "tunnel" ]]; then
    warn "Voice cannot work through a tunnel: WebRTC media is UDP."
  fi
  note "Open on the firewall and forward to this host: 3478/udp, 7881/tcp, 50000-60000/udp (and 80, 443 for the web app)."
  note "Voice also needs HTTPS in the browser; join a channel and watch the browser console if it will not connect."
fi

# ── Disk, backups, uploads ──────────────────────────────────
heading "Data and backups"
if [[ -d data ]]; then
  free_kb="$(df -Pk data 2>/dev/null | awk 'NR==2 {print $4}')"
  if [[ -n "$free_kb" ]]; then
    free_mb=$((free_kb / 1024))
    if (( free_mb < 1024 )); then warn "Only ${free_mb} MB free where data/ lives."
    else pass "${free_mb} MB free where data/ lives"; fi
  fi
  if [[ -d data/backups ]]; then
    newest="$(ls -t data/backups/*.db 2>/dev/null | head -1 || true)"
    if [[ -z "$newest" ]]; then
      warn "No database snapshot exists yet. Take one now:  ./backup.sh"
    else
      now="$(date +%s)"
      mtime="$(stat -c %Y "$newest" 2>/dev/null || stat -f %m "$newest" 2>/dev/null || echo "$now")"
      age_days=$(( (now - mtime) / 86400 ))
      if (( age_days > 3 )); then warn "The newest snapshot is ${age_days} days old ($(basename "$newest"))."
      else pass "Newest snapshot is ${age_days} day(s) old"; fi
    fi
    note "Snapshots sit on this disk. Copy data/backups and data/uploads off the machine (docs/tavvit/BACKUP-AND-RESTORE.md)."
  else
    warn "data/backups does not exist yet (the first snapshot creates it)."
  fi
else
  warn "There is no data/ directory yet (created on first start)."
fi

# ── Summary ─────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${PASSES} passed, ${WARNS} warning(s), ${FAILS} failed${NC}"
if (( FAILS > 0 )); then
  echo "Fix the FAIL lines first; each says what to run."
  exit 1
fi
exit 0
