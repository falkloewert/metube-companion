#!/bin/sh
# Smoke test: starts compose.desktop.yml with a locally built image next to a
# real MeTube and checks the companion end to end. Needs Docker and curl.
#
#   tests/smoke.sh            # builds metube-companion:smoke
#   IMAGE=... tests/smoke.sh  # uses an existing image
#   STRICT=1 tests/smoke.sh   # fail (instead of warn) when YouTube blocks
set -eu
cd "$(dirname "$0")/.."
IMAGE="${IMAGE:-metube-companion:smoke}"
PORT="${PORT:-18181}"
VIDEO=jNQXAC9IVRw   # "Me at the zoo", 19 s, public since 2005
B="http://127.0.0.1:$PORT"
WORK=$(mktemp -d)
P="mcsmoke$$"
fails=0

ok()   { echo "  ok    $*"; }
bad()  { echo "  FAIL  $*"; fails=$((fails + 1)); }
warn() { echo "  WARN  $*"; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
check() { want=$1; label=$2; shift 2; got=$(code "$@"); [ "$got" = "$want" ] && ok "$label ($got)" || bad "$label: want $want, got $got"; }

cleanup() {
  docker compose -p "$P" -f "$WORK/compose.yml" down -v >/dev/null 2>&1 || true
  docker run --rm -v "$WORK:/w" alpine:3.20 rm -rf /w/downloads >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

if [ "$IMAGE" = "metube-companion:smoke" ]; then
  echo "build $IMAGE"
  docker build -q -t "$IMAGE" . >/dev/null
fi

sed -e "s#ghcr.io/falkloewert/metube-companion:latest#$IMAGE#" \
    -e "s#127.0.0.1:8081:8080#127.0.0.1:$PORT:8080#" \
    -e 's#RETENTION_DAYS: "0"#RETENTION_DAYS: "${RETENTION_DAYS:-0}"\n      COMPANION_TOKEN: "${COMPANION_TOKEN:-}"#' \
    compose.desktop.yml > "$WORK/compose.yml"
mkdir -p "$WORK/downloads"
export METUBE_DOWNLOADS="$WORK/downloads" PUID="$(id -u)" PGID="$(id -g)"
up() { docker compose -p "$P" -f "$WORK/compose.yml" up -d "$@" >/dev/null 2>&1; }
wait_up() {
  i=0; until [ "$(code "$B/healthz")" = 200 ]; do i=$((i + 1)); [ $i -gt 60 ] && return 1; sleep 1; done
  i=0; until [ "$(code "$B/api/history")" != 502 ]; do i=$((i + 1)); [ $i -gt 90 ] && return 1; sleep 1; done
}

echo "start MeTube + companion"
up
wait_up || { bad "stack did not come up"; docker compose -p "$P" -f "$WORK/compose.yml" logs --tail 30; exit 1; }

echo "endpoints"
check 200 "web UI" "$B/"
check 200 "health" "$B/healthz"
curl -s "$B/config.js" | grep -q 'keepDays: 0, authRequired: 0' && ok "config.js" || bad "config.js: $(curl -s "$B/config.js")"
check 200 "MeTube history via /api/" "$B/api/history"
check 200 "MeTube history via /ext/" "$B/ext/history"
check 200 "file listing" "$B/files/"
check 403 "files are not served" "$B/files/x.jpg"
check 403 "folders cannot be deleted" -X DELETE "$B/files/sub/"
check 404 "hidden paths blocked" "$B/files/.tmp/"
curl -s "$B/yt/notanid" | grep -q "MeTube Companion" && ok "/yt/ only proxies video IDs" || bad "/yt/ proxied a non-ID"

echo "download (thumbnail of $VIDEO)"
curl -s -H 'Content-Type: application/json' \
  -d "{\"url\":\"https://www.youtube.com/watch?v=$VIDEO\",\"download_type\":\"thumbnail\",\"format\":\"jpg\",\"quality\":\"best\"}" \
  "$B/api/add" >/dev/null
f=""
i=0; while [ $i -lt 90 ]; do
  f=$(ls "$WORK/downloads" | grep "\[$VIDEO\]\.jpg$" || true)
  [ -n "$f" ] && break
  curl -s "$B/api/history" | grep -q '"status": "error"' && break
  i=$((i + 1)); sleep 1
done
if [ -n "$f" ]; then
  ok "file with video ID in its name: $f"
  curl -s "$B/files/" | grep -q "\[$VIDEO\]" && ok "listed in /files/" || bad "not in /files/"
  enc=$(printf '%s' "$f" | sed 's/ /%20/g; s/\[/%5B/g; s/\]/%5D/g')
  check 204 "delete via /files/" -X DELETE "$B/files/$enc"
  [ -z "$(ls "$WORK/downloads" | grep "$VIDEO" || true)" ] && ok "file gone" || bad "file still there"
else
  msg=$(curl -s "$B/api/history" | tr ',' '\n' | grep '"msg"' | head -1)
  if [ "${STRICT:-0}" = 1 ]; then bad "no download: $msg"; else warn "no download (YouTube may block this network): $msg"; fi
fi

echo "access token"
COMPANION_TOKEN=smoke-token-1234567890 up companion
wait_up || true
check 200 "health stays open" "$B/healthz"
check 401 "API without token" "$B/api/history"
check 401 "extension path without token" "$B/ext/history"
check 401 "file listing without token" "$B/files/"
check 200 "API with header" -H 'X-Companion-Token: smoke-token-1234567890' "$B/api/history"
check 200 "API with cookie" -b 'companion_token=smoke-token-1234567890' "$B/api/history"
check 401 "wrong token" -H 'X-Companion-Token: wrong-token-123456789' "$B/api/history"
curl -s "$B/config.js" | grep -q 'authRequired: 1' && ok "config.js reports the token" || bad "config.js: $(curl -s "$B/config.js")"

echo "unsafe token is rejected"
COMPANION_TOKEN='short"x' up companion
sleep 3
docker compose -p "$P" -f "$WORK/compose.yml" logs companion 2>&1 | grep -q "COMPANION_TOKEN must be" && ok "container refuses it" || bad "unsafe token not rejected"

echo
[ $fails -eq 0 ] && echo "smoke test passed" || { echo "smoke test: $fails failure(s)"; exit 1; }
