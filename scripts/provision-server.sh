#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# NeurAI core box — rebuild from a bare Ubuntu server (item 12, 2026-08-23).
#
# Turns a fresh Ubuntu 24.04+ host into neurai-core-1: api + worker + ml +
# TTS under systemd, ready for the normal deploy flow (git archive over
# scp — see the runbook in docs/). Idempotent: safe to re-run.
#
# WHAT IT DOES NOT DO — the operator's three manual steps, all secrets:
#   1. /etc/neurai/core.env   — written by scripts/deploy-secrets-to-server.ps1
#      (or by hand from the key list this script prints)
#   2. /etc/neurai/ml.env     — ditto
#   3. /etc/neurai/purge.env  — DATABASE_URL_PURGE (echo_purge), by hand;
#      the purge timer stays dormant until it exists (ConditionPathExists)
#   4. cloudflared            — the tunnel is claimed interactively once:
#      `cloudflared tunnel login` + the route for api.neurai.pt
#
# Usage (as root on the new box):
#   bash provision-server.sh
# then from the dev machine: the normal code deploy + secrets script, then
#   systemctl enable --now neurai-api neurai-worker neurai-ml neurai-tts
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

echo "== packages =="
apt-get update -qq
apt-get install -y -qq curl ffmpeg python3-venv python3-pip git rsync

echo "== node 22 (nodesource) =="
if ! command -v node >/dev/null || [[ "$(node --version)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
node --version

echo "== user + directories =="
id neurai >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin neurai
mkdir -p /opt/neurai/app /opt/neurai/tts /etc/neurai
chown -R neurai:neurai /opt/neurai

echo "== TTS venv (piper) =="
if [[ ! -x /opt/neurai/tts-venv/bin/python ]]; then
  python3 -m venv /opt/neurai/tts-venv
  /opt/neurai/tts-venv/bin/pip install --quiet piper-tts
  chown -R neurai:neurai /opt/neurai/tts-venv
fi

echo "== piper voices (models are public artifacts) =="
cd /opt/neurai/tts
for voice in fa_IR-gyro-medium fa_IR-amir-medium fa_IR-ganji-medium; do
  if [[ ! -f "$voice.onnx" ]]; then
    base="https://huggingface.co/rhasspy/piper-voices/resolve/main/fa/fa_IR/${voice#fa_IR-}"
    base="${base%-medium}/medium"
    curl -fsSL -o "$voice.onnx" "$base/$voice.onnx" || echo "  (fetch $voice manually)"
    curl -fsSL -o "$voice.onnx.json" "$base/$voice.onnx.json" || true
  fi
done
chown neurai:neurai /opt/neurai/tts/* 2>/dev/null || true

echo "== systemd units (from the repo's scripts/systemd/) =="
# run this script from a checkout/archive that includes scripts/systemd
UNIT_SRC="$(dirname "$0")/systemd"
install -m 644 "$UNIT_SRC"/neurai-*.service "$UNIT_SRC"/neurai-*.timer /etc/systemd/system/
systemctl daemon-reload

echo "== ml models note =="
cat <<'EOF'
  /opt/neurai/app/ml/models needs: silero_vad.onnx, segmentation.onnx,
  embedding.onnx — copied from the previous box or the ml/ model sources
  (see ml/README.md). The deploy flow ships code; models travel once.
EOF

echo "== remaining manual steps =="
cat <<'EOF'
  1. /etc/neurai/core.env  keys: NODE_ENV, DATABASE_URL_APP,
     DATABASE_URL_AGENT, OPENROUTER_API_KEY, SUPABASE_URL,
     SUPABASE_SERVICE_KEY, SONIOX_API_KEY, TTS_URL
     (scripts/deploy-secrets-to-server.ps1 writes this from the DPAPI store)
  2. /etc/neurai/ml.env    keys: NODE_ENV, ML_PORT, ML_HOST, ML_LANE_ORDER,
     ML_REQUIRE_WORD_TIMESTAMPS, ML_ALLOW_LOCAL_PATHS, ML_URL_ALLOWLIST,
     ML_WORK_DIR, ML_SILERO_MODEL, ML_DIARIZER, ML_SEGMENTATION_MODEL,
     ML_EMBEDDING_MODEL, ML_DIARIZER_THREADS, OPENROUTER_API_KEY,
     SONIOX_API_KEY
  3. /etc/neurai/purge.env key:  DATABASE_URL_PURGE  (enables the nightly
     purge timer: systemctl enable --now neurai-purge.timer)
  4. cloudflared tunnel for api.neurai.pt
  5. deploy code (git archive flow), then:
     systemctl enable --now neurai-api neurai-worker neurai-ml neurai-tts
EOF
echo "== provision done =="
