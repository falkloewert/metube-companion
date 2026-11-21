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
    -e 's#RETENTION_DAYS: "0"#RETENTION_DAYS: "${RETENTION_DAYS:-0}"\n      COMPANION_TOKEN: "${COMPANION_TOKEN:-}"#' \
    compose.desktop.yml > "$WORK/compose.yml"
mkdir -p "$WORK/downloads"
export METUBE_DOWNLOADS="$WORK/downloads" PUID="$(id -u)" PGID="$(id -g)" COMPANION_PORT="$PORT"
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
check 404 "MeTube live updates blocked on /ext/" "$B/ext/socket.io/?EIO=4&transport=polling"

echo "cross-site requests (CSRF)"
J='{"url":"https://example.com/csrf-test","download_type":"thumbnail","format":"jpg","quality":"best"}'
check 403 "foreign page cannot add via /ext/" -H 'Origin: https://evil.example' -H 'Sec-Fetch-Site: cross-site' -H 'Content-Type: text/plain' -d "$J" "$B/ext/add"
check 403 "foreign page cannot add via /api/" -H 'Origin: https://evil.example' -H 'Sec-Fetch-Site: cross-site' -H 'Content-Type: text/plain' -d "$J" "$B/api/add"
check 403 "foreign page cannot delete via /ext/" -H 'Origin: https://evil.example' -H 'Sec-Fetch-Site: cross-site' -H 'Content-Type: text/plain' -d '{"ids":["x"],"where":"done"}' "$B/ext/delete"
check 200 "extension origin can use /ext/" -H 'Origin: chrome-extension://smoketest' -H 'Sec-Fetch-Site: cross-site' "$B/ext/history"

echo "download (thumbnail of $VIDEO)"
# The answer of /add is checked regardless of YouTube: a changed MeTube API
# must fail the test, only YouTube refusing the download is a warning.
resp=$(curl -s -w '\n%{http_code}' -H 'Content-Type: application/json' \
  -d "{\"url\":\"https://www.youtube.com/watch?v=$VIDEO\",\"download_type\":\"thumbnail\",\"format\":\"jpg\",\"quality\":\"best\"}" \
  "$B/api/add")
[ "$(printf '%s' "$resp" | tail -1)" = 200 ] && printf '%s' "$resp" | head -1 | grep -q '"status": "ok"' \
  && ok "MeTube accepted the job" || bad "MeTube /add answered: $resp"
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
  if [ "${STRICT:-0}" != 1 ] && printf '%s' "$msg" | grep -qiE "sign in|429|too many requests|not a bot"; then
    warn "no download, YouTube refused this network: $msg"
  else
    bad "no download: ${msg:-no message, nothing in the history}"
  fi
fi

echo "history only vs. with files (DELETE_FILE_ON_TRASHCAN=ask)"
if [ -n "$f" ]; then
  U="https://www.youtube.com/watch?v=$VIDEO"
  curl -s -H 'Content-Type: application/json' \
    -d "{\"url\":\"$U\",\"download_type\":\"thumbnail\",\"format\":\"jpg\",\"quality\":\"best\"}" "$B/api/add" >/dev/null
  i=0; until ls "$WORK/downloads" | grep -q "\[$VIDEO\]\.jpg$" || [ $i -gt 90 ]; do i=$((i + 1)); sleep 1; done
  # MeTube reports "finished" while the job is still in the queue; wait until
  # it has moved to the history, otherwise the delete hits the old entry.
  i=0; until curl -s "$B/api/history" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(any('$VIDEO' in j['url'] for j in d['queue']+d['pending']))" || [ $i -gt 30 ]; do i=$((i + 1)); sleep 1; done
  curl -s -H 'Content-Type: application/json' -d "{\"ids\":[\"$U\"],\"where\":\"done\",\"delete_files\":false}" "$B/api/delete" >/dev/null
  sleep 1
  ls "$WORK/downloads" | grep -q "\[$VIDEO\]" && ok "history only keeps the file" || bad "history only deleted the file"
  curl -s "$B/api/history" | grep -q "$VIDEO" && bad "entry still in history" || ok "entry removed from history"
else
  warn "skipped (no download)"
fi

echo "MeTube recreated (new container, maybe a new IP)"
docker compose -p "$P" -f "$WORK/compose.yml" up -d --force-recreate metube >/dev/null 2>&1
i=0; until [ "$(code "$B/api/history")" = 200 ] || [ $i -gt 90 ]; do i=$((i + 1)); sleep 1; done
check 200 "companion reaches the new MeTube without restart" "$B/api/history"

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

echo "unsafe tokens are rejected"
for t in 'short"x' '~aaaaaaaaaaaaaaaaaa'; do
  COMPANION_TOKEN="$t" up companion
  sleep 3
  docker compose -p "$P" -f "$WORK/compose.yml" logs --since 10s companion 2>&1 | grep -q "COMPANION_TOKEN must be" \
    && ok "container refuses '$t'" || bad "unsafe token '$t' not rejected"
done

echo
[ $fails -eq 0 ] && echo "smoke test passed" || { echo "smoke test: $fails failure(s)"; exit 1; }
