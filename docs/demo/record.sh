#!/usr/bin/env bash
# Rebuilds docs/demo.mp4 from scratch, fully automatic:
#   builds the image, starts compose.desktop.yml with it (real MeTube, real
#   YouTube downloads), drives the web UI with Playwright (record.js), encodes
#   the screencast with ffmpeg, tears everything down.
#
# Needs: docker, node, ffmpeg, Playwright for Node (`npm i -g playwright`,
# `playwright install chromium`) and internet access.
#
#   docs/demo/record.sh              # writes docs/demo.mp4
#   DEMO_TMP=/path docs/demo/record.sh   # where the temp files go (default /tmp)
#   SKIP_BUILD=1 / KEEP=1 / SHOTS=dir    # reuse the image / keep temp files / save debug PNGs
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
HERE=$ROOT/docs/demo
PORT=${COMPANION_PORT:-18999}
PROJECT=metube-demo
WORK=$(mktemp -d "${DEMO_TMP:-/tmp}/metube-demo.XXXXXX")

cleanup() {
  docker compose -p "$PROJECT" -f "$WORK/compose.yml" down -v >/dev/null 2>&1 || true
  if [ -n "${KEEP:-}" ]; then echo "kept $WORK"; else rm -rf "$WORK"; fi
}
trap cleanup EXIT

for c in docker node ffmpeg; do command -v "$c" >/dev/null || { echo "missing: $c" >&2; exit 1; }; done
export NODE_PATH="${NODE_PATH:-$(npm root -g 2>/dev/null || true)}"

[ -n "${SKIP_BUILD:-}" ] || docker build -q -t metube-companion:demo "$ROOT" >/dev/null

# The desktop compose file with the locally built image and a throw-away
# download folder.
sed 's#ghcr.io/falkloewert/metube-companion:latest#metube-companion:demo#' "$ROOT/compose.desktop.yml" > "$WORK/compose.yml"
export METUBE_DOWNLOADS="$WORK/downloads" COMPANION_PORT="$PORT" PUID="$(id -u)" PGID="$(id -g)"
compose() { docker compose -p "$PROJECT" -f "$WORK/compose.yml" "$@"; }

# Fresh MeTube and companion with an empty history and download folder.
stack_up() {
  compose down -v >/dev/null 2>&1 || true
  rm -rf "$WORK/downloads" && mkdir -p "$WORK/downloads"
  compose up -d >"$WORK/compose.log" 2>&1 || { cat "$WORK/compose.log" >&2; exit 1; }
  for _ in $(seq 1 60); do
    curl -fsS "http://127.0.0.1:$PORT/api/history" >/dev/null 2>&1 && return 0
    sleep 2
  done
  echo "MeTube did not come up" >&2; exit 1
}

# YouTube downloads can fail now and then: start over on a clean stack.
ok=
for attempt in 1 2 3; do
  stack_up
  if BASE="http://127.0.0.1:$PORT" OUT="$WORK/out" SHOTS="${SHOTS:-}" node "$HERE/record.js"; then ok=1; break; fi
  echo "attempt $attempt failed" >&2
done
[ -n "$ok" ] || exit 1

# 30 fps, H.264, no audio (captions instead of voice).
ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -i "$WORK/out/frames.txt" \
  -vf "fps=30,format=yuv420p" -c:v libx264 -preset slow -crf 22 -movflags +faststart \
  "$ROOT/docs/demo.mp4"
ls -l "$ROOT/docs/demo.mp4"
