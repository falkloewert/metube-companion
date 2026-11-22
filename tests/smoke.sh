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
    -e 's#RETENTION_DAYS: "0"#RETENTION_DAYS: "${RETENTION_DAYS:-0}"\n      COMPANION_TOKEN: "${COMPANION_TOKEN:-}"\n      CLEANUP_INTERVAL: "${CLEANUP_INTERVAL:-3600}"#' \
    -e 's#TRASH_DAYS: "7"#TRASH_DAYS: "${TRASH_DAYS:-7}"#' \
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
curl -s "$B/config.js" | grep -q 'keepDays: 0, trashDays: 7, authRequired: 0' && ok "config.js" || bad "config.js: $(curl -s "$B/config.js")"
check 200 "MeTube history via /api/" "$B/api/history"
check 200 "MeTube history via /ext/" "$B/ext/history"
check 200 "file listing" "$B/files/"
check 403 "files are not served" "$B/files/x.jpg"
check 403 "folders cannot be deleted" -X DELETE "$B/files/sub/"
check 404 "hidden paths blocked" "$B/files/.tmp/"
check 404 "hidden paths blocked (state folder)" "$B/files/.metube/state"
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

echo "trash (fake files, no YouTube needed)"
D="$WORK/downloads"
FK="Trash test [aaaaaaaaaaa]"
FKE="Trash%20test%20%5Baaaaaaaaaaa%5D"
T=$(date +%s)
mkdir -p "$D/sub"
echo video > "$D/$FK.mp4"; echo text > "$D/$FK.en.txt"; echo nested > "$D/sub/$FK.mp3"
mv_() { curl -s -o /dev/null -w '%{http_code}' -X MOVE -H "Destination: $2" -H "Overwrite: ${3-F}" "$B/files/$1"; }
[ "$(mv_ "$FKE.mp4" "/files/.trash/$T/$FKE.mp4")" = 204 ] && ok "move to trash (204)" || bad "move to trash"
[ "$(mv_ "$FKE.en.txt" "$B/files/.trash/$T/$FKE.en.txt")" = 204 ] && ok "move with absolute Destination (204)" || bad "absolute Destination"
[ "$(mv_ "sub/$FKE.mp3" "/files/.trash/$T/sub/$FKE.mp3")" = 204 ] && ok "move from a subfolder keeps the path (204)" || bad "move from subfolder"
[ ! -e "$D/$FK.mp4" ] && [ "$(cat "$D/.trash/$T/$FK.mp4")" = video ] && [ "$(cat "$D/.trash/$T/sub/$FK.mp3")" = nested ] \
  && ok "files are in .trash/<time>/, same relative path" || bad "files not where expected in .trash"
curl -s "$B/files/" | grep -qF "$FK" && bad "trashed file still listed" || ok "trashed file gone from the list"
curl -s "$B/files/.trash/" | grep -q "\"$T\"" && ok "trash folder listed" || bad "trash folder not listed"
curl -s "$B/files/.trash/$T/" | grep -qF "$FK.mp4" && ok "trash content listed" || bad "trash content not listed"
curl -s "$B/files/.trash/$T/sub/" | grep -qF "$FK.mp3" && ok "trash subfolder listed" || bad "trash subfolder not listed"
echo changed > "$D/$FK.mp4"
check 412 "restore refuses to overwrite an existing file" -X MOVE -H "Destination: /files/$FKE.mp4" -H 'Overwrite: F' "$B/files/.trash/$T/$FKE.mp4"
[ "$(cat "$D/$FK.mp4")" = changed ] && [ -e "$D/.trash/$T/$FK.mp4" ] && ok "nothing was replaced" || bad "collision changed files"
rm "$D/$FK.mp4"
[ "$(mv_ ".trash/$T/$FKE.mp4" "/files/$FKE.mp4")" = 204 ] && [ "$(cat "$D/$FK.mp4")" = video ] && ok "restore (204)" || bad "restore"
[ "$(mv_ ".trash/$T/sub/$FKE.mp3" "/files/sub/$FKE.mp3")" = 204 ] && [ "$(cat "$D/sub/$FK.mp3")" = nested ] && ok "restore into a subfolder" || bad "restore into subfolder"
echo "(trash rules)"
[ "$(mv_ "$FKE.mp4" "/files/.trash/$T/x.mp4" "")" = 403 ] && ok "MOVE without Overwrite: F refused" || bad "MOVE without Overwrite accepted"
[ "$(mv_ "$FKE.mp4" "/files/.trash/$T/x.mp4" T)" = 403 ] && ok "Overwrite: T refused" || bad "Overwrite: T accepted"
for dest in "/files/.trash/$T/../x.mp4" "/files/.trash/$T/%2e%2e/x.mp4" "/files/.trash/$T/%2E%2E%2Fx.mp4" "/files/.tmp/x.mp4" \
            "/files/.metube/x.mp4" "/files/x.mp4" "/files/.trash/abc/x.mp4" "/files/.trash/$T/.x.mp4" "/files/.trash/$T/sub/" \
            "/etc/x.mp4" "/files/.trash/$T/x.mp4?y" "/files/.trash/$T/%00.mp4"; do
  [ "$(mv_ "$FKE.mp4" "$dest")" = 403 ] && ok "Destination refused: $dest" || bad "Destination accepted or odd answer: $dest"
done
[ "$(mv_ "$FKE.mp4" "/files/.trash/$T/x.mp4" )" = 204 ] && mv_ ".trash/$T/x.mp4" "/files/$FKE.mp4" >/dev/null
[ "$(mv_ "sub" "/files/.trash/$T/sub")" != 204 ] && [ -d "$D/sub" ] && ok "folders cannot be moved" || bad "folder was moved"
check 403 "moving a trash file into the trash again" -X MOVE -H "Destination: /files/.trash/$T/y" -H 'Overwrite: F' "$B/files/.trash/$T/sub/"
mkdir -p "$D/idx"; echo '<script>alert(1)</script>' > "$D/idx/index.html"
hdr=$(curl -si "$B/files/idx/")
printf '%s' "$hdr" | head -1 | grep -q 200 && printf '%s' "$hdr" | grep -qi '^content-type: application/json' && ! printf '%s' "$hdr" | grep -q '<script>' \
  && ok "folder with index.html: listing JSON, not the file" || bad "index.html served from /files/: $(printf '%s' "$hdr" | head -5 | tr '\r\n' '  ')"
printf '%s' "$hdr" | grep -qi '^content-security-policy: sandbox' && ok "CSP sandbox on /files/" || bad "no CSP on /files/"
check 403 "index.html itself is not served" "$B/files/idx/index.html"
mv_ "idx/index.html" "/files/.trash/$T/idx/index.html" >/dev/null
check 204 "restore of an index.html" -X MOVE -H "Destination: /files/idx2/index.html" -H 'Overwrite: F' "$B/files/.trash/$T/idx/index.html"
curl -s -i "$B/files/idx2/" | grep -q '<script>' && bad "restored index.html served" || ok "restored index.html not served"
check 404 "restore of a file that is not there (404)" -X MOVE -H "Destination: /files/nothing.mp4" -H 'Overwrite: F' "$B/files/.trash/$T/nothing.mp4"
rm -rf "$D/idx" "$D/idx2"
check 404 "hidden file inside the trash blocked" "$B/files/.trash/$T/.x"
check 404 "hidden source blocked" -X MOVE -H "Destination: /files/.trash/$T/x" -H 'Overwrite: F' "$B/files/.tmp/x"
check 403 "files in the trash are not served" "$B/files/.trash/$T/sub/$FKE.mp3"
check 403 "no CORS preflight for MOVE" -X OPTIONS -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: MOVE' "$B/files/$FKE.mp4"
curl -si -X OPTIONS -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: MOVE' "$B/files/$FKE.mp4" | grep -qi '^access-control' \
  && bad "CORS headers on /files/" || ok "no CORS headers on /files/"
# Firefox applies CORS to extension pages: the listing (GET only) is readable for them.
curl -si -X OPTIONS -H 'Origin: moz-extension://x' -H 'Access-Control-Request-Headers: x-companion-token' "$B/files/" \
  | grep -qi '^access-control-allow-methods: GET' && ok "extension preflight on /files/ (GET only)" || bad "extension preflight on /files/"
curl -si -H 'Origin: moz-extension://x' "$B/healthz" | grep -qi '^access-control-allow-origin: moz-extension://x' \
  && ok "healthz readable for the extension" || bad "healthz without CORS for the extension"
mkdir -p "$D/.trash/$T"; echo z > "$D/.trash/$T/del.mp4"
check 204 "delete a file in the trash (empty trash)" -X DELETE "$B/files/.trash/$T/del.mp4"
rm -rf "$D/.trash" "$D/sub" "$D/$FK".*

echo "trash purge (TRASH_DAYS=1, RETENTION_DAYS=1, cleanup every 2 s)"
TRASH_DAYS=1 RETENTION_DAYS=1 CLEANUP_INTERVAL=2 up companion
wait_up || true
old=$(( $(date +%s) - 3 * 86400 )); new=$(( $(date +%s) - 3600 ))
mkdir -p "$D/.trash/$old/sub" "$D/.trash/$new" "$D/.trash/notmine" "$D/.trash/$new-empty"
echo a > "$D/.trash/$old/sub/a.mp4"; echo b > "$D/.trash/$new/b.mp4"; echo c > "$D/.trash/notmine/c.mp4"
touch -d '5 days ago' "$D/.trash/$new/b.mp4"      # old file, new in the trash: the retention pass must not take it
echo v > "$D/visible.mp4"; touch -d '5 days ago' "$D/visible.mp4"
i=0; until [ ! -e "$D/.trash/$old" ] || [ $i -gt 15 ]; do i=$((i + 1)); sleep 1; done
[ ! -e "$D/.trash/$old" ] && ok "trash folder older than TRASH_DAYS purged" || bad "old trash folder still there"
[ -e "$D/.trash/$new/b.mp4" ] && ok "younger trash folder kept (also with an old file in it)" || bad "RETENTION_DAYS pass took a file from the trash"
[ -e "$D/.trash/notmine/c.mp4" ] && ok "non-numeric folder in .trash left alone" || bad "foreign folder purged"
# touch gives visible.mp4 a fresh ctime, so the retention pass must keep it (an
# old ctime cannot be faked without root and a clock change).
sleep 3
[ -e "$D/visible.mp4" ] && ok "old mtime but fresh ctime survives RETENTION_DAYS" || bad "retention pass ignored the change time"
# Restored file: old mtime, fresh ctime (the move) -> must survive RETENTION_DAYS.
echo r > "$D/.trash/$new/r.mp4"; touch -d '5 days ago' "$D/.trash/$new/r.mp4"
[ "$(mv_ ".trash/$new/r.mp4" "/files/restored.mp4")" = 204 ] && ok "restored a file with an old mtime" || bad "restore for the retention test"
sleep 5
[ -e "$D/restored.mp4" ] && ok "restored file survives RETENTION_DAYS (fresh ctime)" || bad "restored file deleted by the retention pass"
rm -rf "$D/.trash"
mkdir -p "$D/.trash/$new"; echo b > "$D/.trash/$new/b.mp4"
TRASH_DAYS=0 RETENTION_DAYS=0 CLEANUP_INTERVAL=2 up companion
wait_up || true
i=0; until [ ! -e "$D/.trash/$new" ] || [ $i -gt 15 ]; do i=$((i + 1)); sleep 1; done
[ ! -e "$D/.trash/$new" ] && ok "TRASH_DAYS=0 empties an old trash" || bad "old trash stays with TRASH_DAYS=0"
rm -rf "$D/.trash" "$D/restored.mp4"
curl -s "$B/config.js" | grep -q 'trashDays: 0' && ok "TRASH_DAYS=0 reported to the UI" || bad "config.js: $(curl -s "$B/config.js")"

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
check 401 "MOVE without token" -X MOVE -H 'Destination: /files/.trash/1700000000/x' -H 'Overwrite: F' "$B/files/x"
check 401 "DELETE without token" -X DELETE "$B/files/x"
check 401 "trash listing without token" "$B/files/.trash/"
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
