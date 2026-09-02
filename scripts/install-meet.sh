#!/usr/bin/env bash
# Put the video room on OUR OWN server.
#
# Until this runs, meetings use meet.jit.si — the public instance, which
# works with no infrastructure and carries the media across servers we do not
# run. This replaces it with a Jitsi we own, on meet.neurai.pt, and after it
# the product's own sentence about where the video goes becomes true.
#
# ── BEFORE RUNNING, TWO THINGS ONLY YOU CAN DO ───────────────────────────
#
#  1. A DNS record. In Cloudflare, add:
#         meet.neurai.pt   A   178.105.251.216   (proxy OFF — grey cloud)
#     The proxy MUST be off. Cloudflare's proxy does not carry the UDP that
#     video runs on, and a proxied record produces a room that connects,
#     shows everyone's name, and never shows a face.
#
#  2. The firewall. Jitsi needs, on the server itself:
#         80/tcp    (once, for the certificate)
#         443/tcp   (the room's own web — NOT the API's tunnel)
#         10000/udp (the media itself; this is the one that matters)
#
# ── WHAT IT COSTS ────────────────────────────────────────────────────────
#
# Jitsi's video bridge is the memory-hungry part: roughly 1 GB idle, more per
# participant. MEASURED ON THIS SERVER, 2026-09-02:
#
#     total 3.7 Gi · used 2.6 Gi · AVAILABLE 1.1 Gi
#
# That is not enough. The API, the worker and the speech service already have
# it, and a bridge started into 1.1 GB gets as far as a room that connects
# before the out-of-memory reaper takes something — quite possibly the API,
# which would mean a meeting that drops the whole platform. Worse than a
# meeting on somebody else's server.
#
# So before running this, one of:
#   · resize the Hetzner box to 8 GB (CX32 or similar), or
#   · put this on a SECOND small server of its own and point the DNS there —
#     which is the better shape anyway: video and the API fail for different
#     reasons and should not fail together.
#
# Re-check with `free -h` and only continue when ~2 GB is genuinely free.
#
# ── AFTER IT RUNS ────────────────────────────────────────────────────────
#
#   NEXT_PUBLIC_MEET_DOMAIN=meet.neurai.pt   in Vercel → redeploy.
#
# The footer in the room changes its own sentence when that variable is set;
# nothing else in the product needs to know.
set -euo pipefail

DOMAIN="${MEET_DOMAIN:-meet.neurai.pt}"
EMAIL="${LETSENCRYPT_EMAIL:-neurai.git.acc@gmail.com}"
DIR=/opt/jitsi

echo "==> installing a Jitsi Meet room at ${DOMAIN}"

if ! command -v docker >/dev/null 2>&1; then
  echo "==> docker"
  curl -fsSL https://get.docker.com | sh
fi

mkdir -p "${DIR}"
cd "${DIR}"

if [ ! -d docker-jitsi-meet ]; then
  git clone --depth 1 https://github.com/jitsi/docker-jitsi-meet.git
fi
cd docker-jitsi-meet

# The release tag rather than master: master is where their work in progress
# lives, and a video server that changes under a running product is a
# different outage every week.
git fetch --tags --depth 1 origin
LATEST="$(git tag -l 'stable-*' --sort=-v:refname | head -n 1)"
if [ -n "${LATEST}" ]; then
  echo "==> pinning ${LATEST}"
  git checkout --quiet "${LATEST}"
fi

if [ ! -f .env ]; then
  cp env.example .env
  ./gen-passwords.sh
fi

# Idempotent: every value is REPLACED if present and appended if not, so
# re-running after a change does not leave two lines disagreeing.
set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    printf '%s=%s\n' "${key}" "${value}" >> .env
  fi
}

set_env PUBLIC_URL "https://${DOMAIN}"
set_env LETSENCRYPT_DOMAIN "${DOMAIN}"
set_env LETSENCRYPT_EMAIL "${EMAIL}"
set_env ENABLE_LETSENCRYPT 1
set_env ENABLE_HTTP_REDIRECT 1
set_env HTTP_PORT 80
set_env HTTPS_PORT 443
set_env JVB_PORT 10000

# NO ACCOUNTS, ANYWHERE. The user's requirement in their own words: "does not
# need any login or anything else, just the video". Nobody authenticates,
# nobody waits for a moderator, and the lobby is off — the room's address is
# already unguessable (a UUID), and the wall is the address, not a door
# somebody has to be let through.
set_env ENABLE_AUTH 0
set_env ENABLE_GUESTS 1
set_env ENABLE_LOBBY 0
set_env ENABLE_PREJOIN_PAGE 0
set_env ENABLE_WELCOME_PAGE 0
set_env ENABLE_CLOSE_PAGE 0
set_env DISABLE_DEEP_LINKING 1

mkdir -p ~/.jitsi-meet-cfg/{web,transcripts,prosody/config,prosody/prosody-plugins-custom,jicofo,jvb}

echo "==> starting"
docker compose up -d

echo
echo "==> up. Two checks before believing it:"
echo "    1)  curl -sI https://${DOMAIN} | head -1        (expect 200)"
echo "    2)  open https://${DOMAIN}/neurai-selftest in TWO browsers"
echo "        — if both see each other, the UDP is open; if they connect and"
echo "          see nothing, 10000/udp is blocked or the DNS is proxied."
echo
echo "==> then, in Vercel:  NEXT_PUBLIC_MEET_DOMAIN=${DOMAIN}  and redeploy."
