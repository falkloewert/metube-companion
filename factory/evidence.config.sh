#!/usr/bin/env bash
# Evidence kit config of metube-companion (kit reference: factory/evidence/README.md).

PROJECT_PREFIX=metube-companion
COMPOSE_FILE=docker-compose.factory.yml
APP_URL=http://web:8080
MOCK_URL=http://metube:8081
APP_PORT_VAR=FACTORY_WEB_PORT
MOCK_PORT_VAR=FACTORY_MOCK_PORT

# Slower simulated downloads than the default 250 ms, so the progress is readable in the proof video.
SANDBOX_ENV="FACTORY_MOCK_TICK_MS=700"

# The mock resets history, cookies, downloads and recorded events to the seed (it has no real data).
RESET_REQUESTS="POST $MOCK_URL/_mock/reset"
# Card thumbnails load from i.ytimg.com in the browser: serve the fixture image, block everything else.
ROUTED_FIXTURES="https://i.ytimg.com/** => /fixtures/thumbnail.jpg"

# Unit checks in a throwaway container of the mock's Node image: syntax of the browser files,
# then node --test over tests/*.test.mjs if there are any.
UNIT_RUNNER=node
UNIT_LABEL="Unit & smoke checks"
UNIT_CMD='
for f in web/*.js web/i18n/*.js extension/*.js; do
  if node --check "$f" >/dev/null 2>&1; then echo "ok - node --check $f"; else echo "not ok - node --check $f"; fi
done
if [ -n "$(find tests -name "*.test.mjs" | head -n 1)" ]; then
  node --test --test-reporter=tap $(find tests -name "*.test.mjs" | sort)
fi'
SMOKE_CMD="factory/smoke.sh"

ENVIRONMENT_DESC='companion `web` + mock MeTube `metube`, no database, no internet'

SCOPE_VERIFICATION_RE='(^|[\/._-])(tests?|__tests__|specs?|mocks?|evidence)([\/._-]|$)|docker-compose|run-evidence\.sh|smoke\.sh'
# Image and web server setup, compose files, CI, the whole factory sandbox, tests, extension manifests.
SCOPE_SENSITIVE_RE='(^|\/)Dockerfile|^nginx\/|^docker\/|(^|\/)(docker-)?compose[^\/]*\.ya?ml$|^\.github\/|^factory\/|^tests\/|^extension\/manifest[^\/]*\.json$|(^|\/)\.env|secret'
SCOPE_SENSITIVE_LABEL="Sensitive paths (Docker, nginx, CI, factory sandbox, tests, manifests)"

# The proof flow downloads and waits for simulated downloads.
PW_PROOF_TIMEOUT_MS=90000

# Reviewer notification (CI): proof video into the Nextcloud Talk room "Glass Factory Beweise".
NOTIFY=nextcloud-talk
NOTIFY_NC_URL=https://nextcloud.loewert-lab.ipv64.de
NOTIFY_NC_USER=factory-bot
NOTIFY_NC_TALK_ROOM=6prrk8qj
