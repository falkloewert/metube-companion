#!/usr/bin/env bash
# managed by glass-factory kit v1.2.0 (8b5ada6), do not edit; change factory/evidence.config.sh or factory/evidence/tests/
# Shared by run-evidence.sh and install.sh (and the kit self-test): loads factory/evidence.config.sh
# on top of the kit defaults. Source it, do not execute it.

# evidence_load_config <factory-dir>
# Resets every key to its default (an inherited environment variable never wins), then sources
# <factory-dir>/evidence.config.sh. Keys are documented in README.md, "Config reference".
evidence_load_config() {
  local factory_dir="$1" config="$1/evidence.config.sh" key
  [[ -f "$config" ]] || { echo "[evidence] Error: $config not found (install.sh writes a template)" >&2; return 1; }

  COMPOSE_FILE="docker-compose.factory.yml"   # relative to the repository root
  PROJECT_PREFIX=""                           # required
  APP_URL=""                                  # required, as the browser in the sandbox network sees it
  MOCK_URL=""                                 # required
  INSPECTOR_URL=""                            # default: MOCK_URL
  APP_PORT_VAR=""                             # compose variable that sets the app's host port (optional)
  MOCK_PORT_VAR=""
  RESET_REQUESTS=""                           # "POST http://web:8080/reset; DELETE http://mock:4000/_mock/events"
  ALLOWED_ORIGINS=""                          # extra origins the browser may reach, ";"-separated
  ROUTED_FIXTURES=""                          # "https://cdn.example/** => /fixtures/x.jpg; ..."
  UNIT_RUNNER="node"                          # node | service | none
  UNIT_SERVICE=""                             # compose service for UNIT_RUNNER=service
  UNIT_NODE_IMAGE=""                          # default: first node: image of the compose file
  UNIT_CMD=""                                 # sh snippet that prints TAP lines ("ok N - name" / "not ok N - name")
  UNIT_LABEL="Unit Tests"
  SMOKE_CMD=""                                # optional, runs on the host from the repository root
  ENVIRONMENT_DESC=""                         # shown in the report: "Isolated ... Sandbox (<this>, 0 prod secrets)"
  SCOPE_VERIFICATION_RE='(^|[\/._-])(tests?|__tests__|specs?|mocks?|evidence)([\/._-]|$)|docker-compose|run-evidence\.sh'
  SCOPE_SENSITIVE_RE='(^|[\/._-])(auth|security|migrations?|billing|payments?)([\/._-]|$)|Dockerfile|\.github\/workflows\/|\.env|secret|evidence\.config\.sh'
  SCOPE_SENSITIVE_LABEL="Sensitive paths (auth, migrations, CI, Docker, secrets)"
  SANDBOX_ENV=""                              # "KEY=value KEY2=value2" exported unless already set
  PW_TIMEOUT_MS="45000"
  PW_PROOF_TIMEOUT_MS=""                      # default: PW_TIMEOUT_MS
  NOTIFY="none"                               # none | nextcloud-talk (CI publish job, after the PR comment)
  NOTIFY_NC_URL=""                            # https://cloud.example.com
  NOTIFY_NC_USER=""                           # bot account; its app password is the repo secret NEXTCLOUD_NOTIFY_APP_PASSWORD
  NOTIFY_NC_TALK_ROOM=""                      # room token (last part of the room URL)
  NOTIFY_RETENTION_DAYS="30"                  # uploaded videos older than this are removed

  # shellcheck disable=SC1090
  source "$config"

  for key in PROJECT_PREFIX APP_URL MOCK_URL; do
    [[ -n "${!key}" ]] || { echo "[evidence] Error: $key is required in $config" >&2; return 1; }
  done
  [[ "$PROJECT_PREFIX" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || {
    echo "[evidence] Error: PROJECT_PREFIX '$PROJECT_PREFIX' must be lowercase letters, digits, - or _" >&2; return 1; }
  for key in SCOPE_VERIFICATION_RE SCOPE_SENSITIVE_RE; do
    [[ "${!key}" != *$'\n'* ]] || { echo "[evidence] Error: $key must be a single line" >&2; return 1; }
  done
  case "$NOTIFY" in
    none) ;;
    nextcloud-talk)
      for key in NOTIFY_NC_URL NOTIFY_NC_USER NOTIFY_NC_TALK_ROOM; do
        [[ -n "${!key}" ]] || { echo "[evidence] Error: $key is required for NOTIFY=nextcloud-talk" >&2; return 1; }
      done
      [[ "$NOTIFY_NC_URL" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._/-]*)?$ ]] || {
        echo "[evidence] Error: NOTIFY_NC_URL must be a plain https:// URL" >&2; return 1; }
      [[ "$NOTIFY_NC_USER$NOTIFY_NC_TALK_ROOM$NOTIFY_RETENTION_DAYS" =~ ^[A-Za-z0-9._@-]+$ ]] || {
        echo "[evidence] Error: NOTIFY_NC_USER / NOTIFY_NC_TALK_ROOM / NOTIFY_RETENTION_DAYS contain unsupported characters" >&2; return 1; }
      ;;
    *) echo "[evidence] Error: NOTIFY must be none or nextcloud-talk" >&2; return 1 ;;
  esac
  [[ -n "$INSPECTOR_URL" ]] || INSPECTOR_URL="$MOCK_URL"
  [[ -n "$PW_PROOF_TIMEOUT_MS" ]] || PW_PROOF_TIMEOUT_MS="$PW_TIMEOUT_MS"
}

# evidence_json_str <value>: JSON/JS string literal (used to render the scope patterns into the workflow).
evidence_json_str() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '"%s"' "$s"
}

# evidence_container_env_args: fills EVIDENCE_ENV_ARGS (-e KEY=value ...) with everything the
# evidence container reads. Same names as the config keys.
evidence_container_env_args() {
  local key
  EVIDENCE_ENV_ARGS=()
  for key in APP_URL MOCK_URL INSPECTOR_URL RESET_REQUESTS ALLOWED_ORIGINS ROUTED_FIXTURES \
             SCOPE_VERIFICATION_RE SCOPE_SENSITIVE_RE SCOPE_SENSITIVE_LABEL ENVIRONMENT_DESC \
             UNIT_LABEL PW_TIMEOUT_MS PW_PROOF_TIMEOUT_MS; do
    [[ -z "${!key}" ]] || EVIDENCE_ENV_ARGS+=(-e "$key=${!key}")
  done
}
