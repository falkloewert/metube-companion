#!/bin/sh
# Smoke test against the running factory sandbox (docker-compose.factory.yml):
# companion endpoints, file rules, language detection and a full simulated
# download through the companion, all offline. Exit 1 on any failure.
#
#   docker compose -f docker-compose.factory.yml up -d --build --wait
#   factory/smoke.sh
set -eu
B="http://127.0.0.1:${FACTORY_WEB_PORT:-18480}"
M="http://127.0.0.1:${FACTORY_MOCK_PORT:-18481}"
fails=0

ok()   { echo "  ok    $*"; }
bad()  { echo "  FAIL  $*"; fails=$((fails + 1)); }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
check() { want=$1; label=$2; shift 2; got=$(code "$@"); [ "$got" = "$want" ] && ok "$label ($got)" || bad "$label: want $want, got $got"; }
post() { curl -s -X POST -H 'Content-Type: application/json' "$B/api/$1" -d "$2"; }

curl -s -X POST "$M/_mock/reset" >/dev/null

echo "endpoints"
check 200 "web UI" "$B/"
check 200 "health" "$B/healthz"
curl -s "$B/config.js" | grep -q 'keepDays: 0, trashDays: 7, authRequired: 0' && ok "config.js" || bad "config.js"
curl -s "$B/api/history" | grep -q '"Big Buck Bunny' && ok "seeded history via /api/" || bad "seeded history via /api/"
check 200 "history via /ext/" "$B/ext/history"
curl -s "$B/files/" | grep -q 'Big Buck Bunny' && ok "seeded files listed" || bad "seeded files listed"
check 403 "files are not served" "$B/files/x.jpg"
check 403 "folders cannot be deleted" -X DELETE "$B/files/sub/"

echo "language detection (/yt/ -> mock watch page)"
curl -s "$B/yt/jNQXAC9IVRw" | grep -q '"id":"en.4"' && ok "English video" || bad "English video"
curl -s "$B/yt/deMockVid01" | grep -q '"id":"de.4"' && ok "German video" || bad "German video"

echo "simulated download through the companion"
U='https://www.youtube.com/watch?v=eRsGyueVLvQ'
post add "{\"url\":\"$U\",\"download_type\":\"audio\",\"format\":\"mp3\",\"quality\":\"best\"}" | grep -q '"ok"' && ok "add accepted" || bad "add accepted"
post add "{\"url\":\"$U\",\"download_type\":\"audio\",\"format\":\"mp3\",\"quality\":\"best\"}" | grep -q 'Already in queue' && ok "duplicate refused" || bad "duplicate refused"
i=0; until curl -s "$B/files/" | grep -q 'Sintel.*\.mp3'; do i=$((i + 1)); [ $i -gt 40 ] && break; sleep 0.25; done
curl -s "$B/files/" | grep -q 'Sintel.*\.mp3' && ok "file appears in listing" || bad "file appears in listing"
F=$(curl -s "$B/files/" | grep -o 'Sintel[^"]*\.mp3' | head -1)
check 204 "delete the file" -X DELETE "$B/files/$(printf %s "$F" | sed 's/ /%20/g; s/\[/%5B/g; s/\]/%5D/g')"

echo "failure paths"
post add '{"url":"https://www.youtube.com/watch?v=xxxxxxxxxxx","download_type":"video","format":"any","quality":"best"}' >/dev/null
i=0; until curl -s "$B/api/history" | grep -q 'This video is unavailable'; do i=$((i + 1)); [ $i -gt 20 ] && break; sleep 0.25; done
curl -s "$B/api/history" | grep -q 'This video is unavailable' && ok "unknown video fails" || bad "unknown video fails"
curl -s "$M/_mock/events" | grep -q '"/add"' && ok "mock recorded the requests" || bad "mock recorded the requests"

echo
[ "$fails" -eq 0 ] && echo "SMOKE PASS" || { echo "SMOKE FAIL ($fails)"; exit 1; }
