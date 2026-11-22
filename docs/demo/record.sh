#!/usr/bin/env bash
# Rebuilds docs/demo.mp4 from scratch, fully automatic, nobody records anything by hand:
#   builds the image and the extension, starts compose.desktop.yml with it (real
#   MeTube, real YouTube downloads), then
#     part 1  a real Chromium with the extension on a YouTube page, recorded as the
#             X display (xvfb + ffmpeg x11grab, real mouse input via xinput.py),
#     part 2  the real web UI (desktop, then phone) driven by Playwright (record.js),
#   adds music and synthesized UI sounds and encodes everything (compose.py).
#   The story is in storyboard.md; the music is credited in CREDITS.md.
#
# Needs: docker, node, ffmpeg (with x11grab), xvfb-run, ImageMagick (`import`),
# python3 with numpy, Playwright for Node (`npm i -g playwright`,
# `playwright install chromium`) and internet access.
#
#   docs/demo/record.sh                  # writes docs/demo.mp4
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

for c in docker node ffmpeg xvfb-run import python3; do command -v "$c" >/dev/null || { echo "missing: $c" >&2; exit 1; }; done
python3 -c 'import numpy' 2>/dev/null || { echo "missing: python3 numpy" >&2; exit 1; }
export NODE_PATH="${NODE_PATH:-$(npm root -g 2>/dev/null || true)}"

[ -n "${SKIP_BUILD:-}" ] || docker build -q -t metube-companion:demo "$ROOT" >/dev/null

# The extension as users get it (Chromium package), unpacked. Only the host
# permission for the demo port is added: the extension asks for it in a prompt
# otherwise, which nobody can click here.
"$ROOT/extension/build.sh" >/dev/null
python3 -m zipfile -e "$ROOT/extension/dist/metube-companion-chromium.zip" "$WORK/ext"
# The cookies are optional (asked on the settings page); the demo package
# grants them up front, so ticking the box needs no browser prompt.
python3 - "$WORK/ext/manifest.json" <<'PY'
import json, sys
path = sys.argv[1]
m = json.load(open(path))
m['permissions'] += m.pop('optional_permissions', [])
m['host_permissions'] = m.pop('optional_host_permissions', [])
json.dump(m, open(path, 'w'), indent=1)
PY

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
  if BASE="http://localhost:$PORT" EXT="$WORK/ext" OUT="$WORK/out" SHOTS="${SHOTS:-}" \
      xvfb-run -a -s "-screen 0 1920x1080x24" node "$HERE/record.js"; then ok=1; break; fi
  echo "attempt $attempt failed" >&2
done
[ -n "$ok" ] || exit 1

python3 -I "$HERE/compose.py" "$WORK/out" "$ROOT/docs/demo.mp4"
ls -l "$ROOT/docs/demo.mp4"
