#!/usr/bin/env bash
# managed by glass-factory kit v1.2.0 (8b5ada6), do not edit; change factory/evidence.config.sh or factory/evidence/tests/
set -euo pipefail

# Level 0 + Level 1 evidence run for a project's factory sandbox, inside isolated Docker containers:
# 1. Starts the sandbox from the project's compose file
#    (own project name + ephemeral loopback ports, so parallel runs never collide)
# 2. Unit checks (throwaway node container or a compose service) and an optional smoke command,
#    all written as TAP cases
# 3. Playwright in the `evidence` container (same network, reaches the services by name):
#    regression + proof projects, H.264 proof.mp4, GIF preview, step screenshots,
#    EVIDENCE.md, deterministic quality gate (quality-gate.json)
# 4. Tears everything down (containers, volumes, ephemeral images) unless --keep
# Exit code 0 only if every part and the strict quality gate pass.
#
# Project-specific values live in factory/evidence.config.sh (see README.md next to this file).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FACTORY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$FACTORY_DIR/.." && pwd)"
RUN_PATH="${FACTORY_DIR#"$REPO_ROOT"/}/evidence/run-evidence.sh"

# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"
evidence_load_config "$FACTORY_DIR" || exit 2
COMPOSE_PATH="$REPO_ROOT/$COMPOSE_FILE"
[[ -f "$COMPOSE_PATH" ]] || { echo "[evidence] Error: COMPOSE_FILE '$COMPOSE_FILE' not found in $REPO_ROOT" >&2; exit 2; }
cd "$REPO_ROOT"

dc() { docker compose --progress plain -f "$COMPOSE_PATH" "$@"; }

KEEP_RUNNING=false
CUSTOM_OUT=""

usage() {
  cat <<EOT
Usage: $RUN_PATH [--keep] [--out <dir>]

Options:
  --keep        Keep the sandbox containers running (loopback ports are printed at the end)
  --out <dir>   Write evidence artifacts to <dir> instead of ${FACTORY_DIR#"$REPO_ROOT"/}/artifacts.
                The folder is wiped on every run, so it must be empty or a
                previous evidence folder (marker file .evidence-artifacts).
  -h, --help    Show this help message
EOT
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep)
      KEEP_RUNNING=true
      shift
      ;;
    --out)
      if [[ $# -lt 2 ]]; then
        echo "[evidence] Error: --out requires a directory path" >&2
        exit 2
      fi
      CUSTOM_OUT="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[evidence] Error: unknown option '$1'" >&2
      usage >&2
      exit 2
      ;;
  esac
done

# Resolve artifacts directory to an absolute path so Compose bind-mounts work reliably.
# Only --out or the default counts: an inherited ARTIFACTS_DIR is ignored (it gets wiped with rm -rf).
if [[ -n "$CUSTOM_OUT" ]]; then
  mkdir -p "$CUSTOM_OUT"
  ARTIFACTS_DIR="$(cd "$CUSTOM_OUT" && pwd)"
else
  ARTIFACTS_DIR="$FACTORY_DIR/artifacts"
fi
export ARTIFACTS_DIR

# Safety guard: the artifacts directory is wiped (rm -rf). Refuse root, home, the repo
# or any parent of it, and any path inside the repo that git does not ignore.
case "$ARTIFACTS_DIR" in
  ""|"/"|"${HOME:-}")
    echo "[evidence] Error: refusing to clear unsafe artifacts path '$ARTIFACTS_DIR'" >&2
    exit 2
    ;;
esac
case "$REPO_ROOT/" in
  "$ARTIFACTS_DIR"/*)
    echo "[evidence] Error: refusing to clear '$ARTIFACTS_DIR' (it contains the repository)" >&2
    exit 2
    ;;
esac
case "$ARTIFACTS_DIR/" in
  "$REPO_ROOT"/*)
    if ! git -C "$REPO_ROOT" check-ignore -q -- "$ARTIFACTS_DIR/x" 2>/dev/null; then
      echo "[evidence] Error: refusing to clear '$ARTIFACTS_DIR' (inside the repository and not git-ignored)" >&2
      exit 2
    fi
    ;;
esac

# Parallel-safe defaults: unique Compose project name and ephemeral loopback ports (port 0),
# so concurrent agents / git worktrees never collide on container names or host ports.
CLEANUP_RMI_LOCAL="${CLEANUP_RMI_LOCAL:-false}"
if [[ "$KEEP_RUNNING" == "true" ]]; then
  export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-${PROJECT_PREFIX}-evidence-keep}"
elif [[ -z "${COMPOSE_PROJECT_NAME:-}" ]]; then
  RAND_SUFFIX="$(od -An -tx1 -N3 /dev/urandom | tr -d ' \n')"
  export COMPOSE_PROJECT_NAME="${PROJECT_PREFIX}-evidence-$$-${RAND_SUFFIX}"
  CLEANUP_RMI_LOCAL="true"
fi
# An inherited name wins over "name:" in the compose file; never let it point
# at a real install (e.g. "${PROJECT_PREFIX}"), whose "up"/"down" would hit it.
case "$COMPOSE_PROJECT_NAME" in
  "${PROJECT_PREFIX}-evidence-"*|"${PROJECT_PREFIX}-factory"*) ;;
  *)
    echo "[evidence] Error: COMPOSE_PROJECT_NAME '$COMPOSE_PROJECT_NAME' must start with ${PROJECT_PREFIX}-evidence- or ${PROJECT_PREFIX}-factory" >&2
    exit 2
    ;;
esac
for port_var in "$APP_PORT_VAR" "$MOCK_PORT_VAR"; do
  [[ -z "$port_var" ]] || export "$port_var=${!port_var:-0}"
done
# Sandbox env (e.g. a slower mock tick for the video): the caller's value wins.
for pair in $SANDBOX_ENV; do
  [[ "${pair%%=*}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "[evidence] Error: bad SANDBOX_ENV entry '$pair'" >&2; exit 2; }
  key="${pair%%=*}"
  [[ -n "${!key+x}" ]] || export "$pair"
done

# Host ports are only needed for --keep output and the smoke command: resolved from the service
# name and port of the browser-facing URLs (http://<service>:<port>).
url_host() { local u="${1#*://}"; u="${u%%/*}"; echo "${u%%:*}"; }
url_port() { local u="${1#*://}"; u="${u%%/*}"; [[ "$u" == *:* ]] && echo "${u##*:}" || echo 80; }
APP_HOST_PORT="?"
MOCK_HOST_PORT="?"

cleanup() {
  if [[ "$KEEP_RUNNING" == "false" ]]; then
    echo "[evidence] Tearing down isolated sandbox containers and volumes (project: $COMPOSE_PROJECT_NAME)..."
    if [[ "$CLEANUP_RMI_LOCAL" == "true" ]]; then
      dc --profile evidence down -v --remove-orphans --rmi local >/dev/null 2>&1 || true
    else
      dc --profile evidence down -v --remove-orphans >/dev/null 2>&1 || true
    fi
  else
    echo "[evidence] Sandbox kept running (--keep, project: $COMPOSE_PROJECT_NAME):"
    echo "           App:            http://127.0.0.1:${APP_HOST_PORT}"
    echo "           Mock inspector: http://127.0.0.1:${MOCK_HOST_PORT}"
    echo "           Stop later:     cd \"$REPO_ROOT\" && COMPOSE_PROJECT_NAME=\"$COMPOSE_PROJECT_NAME\" docker compose -f \"$COMPOSE_FILE\" --profile evidence down -v"
  fi
}
trap cleanup EXIT

# The CI workflow carries a rendered copy of the scope patterns (its publish job never checks out PR code).
WORKFLOW_FILE="$REPO_ROOT/.github/workflows/level1-evidence.yml"
if [[ -f "$WORKFLOW_FILE" ]]; then
  for key in SCOPE_VERIFICATION_RE SCOPE_SENSITIVE_RE; do
    if ! grep -qF -- "$(evidence_json_str "${!key}")" "$WORKFLOW_FILE"; then
      echo "[evidence] $key in evidence.config.sh differs from .github/workflows/level1-evidence.yml; run install.sh <repo> --update" >&2
      # In CI the publish job would cross-check with other patterns than this run: do not go on.
      [[ "${GITHUB_ACTIONS:-}" != "true" ]] || exit 2
    fi
  done
fi

# Only wipe a folder this script created (marker) or an empty one.
if [[ -d "$ARTIFACTS_DIR" && ! -f "$ARTIFACTS_DIR/.evidence-artifacts" ]] && [[ -n "$(ls -A "$ARTIFACTS_DIR")" ]]; then
  echo "[evidence] Error: $ARTIFACTS_DIR is not empty and is no evidence folder (.evidence-artifacts missing); refusing to wipe it" >&2
  if [[ -z "$CUSTOM_OUT" ]]; then
    echo "[evidence] This is probably output of an older pipeline (git-ignored, generated). Check it and delete it once: rm -rf \"$ARTIFACTS_DIR\"" >&2
  else
    echo "[evidence] Pass an empty folder to --out, or delete this one yourself." >&2
  fi
  exit 2
fi
echo "[evidence] Preparing clean artifacts directory: $ARTIFACTS_DIR"
rm -rf "$ARTIFACTS_DIR"
mkdir -p "$ARTIFACTS_DIR"
touch "$ARTIFACTS_DIR/.evidence-artifacts"

# Collect changed files for deterministic Scope & Verification Integrity checks.
# Includes BOTH committed feature-branch diffs (relative to base ref) AND uncommitted/untracked files.
if [[ -n "${CHANGED_FILES+x}" ]]; then
  printf '%s\n' "$CHANGED_FILES" | sed '/^$/d' | sort -u > "$ARTIFACTS_DIR/changed-files.txt"
elif git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  RESOLVED_BASE="${BASE_REF:-}"
  if [[ -z "$RESOLVED_BASE" ]]; then
    for candidate in origin/main main origin/master master; do
      if git -C "$REPO_ROOT" rev-parse --verify --quiet "$candidate" >/dev/null 2>&1; then
        RESOLVED_BASE="$candidate"
        break
      fi
    done
  fi
  {
    if [[ -n "$RESOLVED_BASE" ]]; then
      git -C "$REPO_ROOT" diff --no-renames --name-only "${RESOLVED_BASE}...HEAD" 2>/dev/null || true
    fi
    git -C "$REPO_ROOT" diff --no-renames --name-only HEAD 2>/dev/null || true
    git -C "$REPO_ROOT" ls-files --others --exclude-standard 2>/dev/null || true
  } | sed '/^$/d' | sort -u > "$ARTIFACTS_DIR/changed-files.txt"
else
  : > "$ARTIFACTS_DIR/changed-files.txt"
fi

echo "[evidence] Starting Level 0 sandbox (project: $COMPOSE_PROJECT_NAME)..."
dc up -d --build --wait

APP_HOST_PORT="$(dc port "$(url_host "$APP_URL")" "$(url_port "$APP_URL")" 2>/dev/null | tail -n 1 | sed 's/.*://' || true)"
MOCK_HOST_PORT="$(dc port "$(url_host "$MOCK_URL")" "$(url_port "$MOCK_URL")" 2>/dev/null | tail -n 1 | sed 's/.*://' || true)"
APP_HOST_PORT="${APP_HOST_PORT:-?}"
MOCK_HOST_PORT="${MOCK_HOST_PORT:-?}"
echo "[evidence] Sandbox up: app 127.0.0.1:$APP_HOST_PORT, mock 127.0.0.1:$MOCK_HOST_PORT"

# ---- Unit and smoke checks, written as TAP so generate-report.mjs / quality-gate.mjs read them ----
T_START_MS="$(date +%s%3N)"
TAP_BODY=""
T_TOTAL=0 T_PASS=0 T_FAIL=0 T_SKIP=0 T_TODO=0

tap_case() { # <ok|not ok> <title, may carry "# SKIP" / "# TODO">
  T_TOTAL=$((T_TOTAL + 1))
  if [[ "$2" =~ \#[[:space:]]*SKIP ]]; then T_SKIP=$((T_SKIP + 1))
  elif [[ "$2" =~ \#[[:space:]]*TODO ]]; then T_TODO=$((T_TODO + 1))
  elif [[ "$1" == "ok" ]]; then T_PASS=$((T_PASS + 1))
  else T_FAIL=$((T_FAIL + 1)); fi
  TAP_BODY+="$1 $T_TOTAL - $2"$'\n'
}

case "$UNIT_RUNNER" in
  none) ;;
  node|service)
    [[ -n "$UNIT_CMD" ]] || { echo "[evidence] Error: UNIT_CMD is required for UNIT_RUNNER=$UNIT_RUNNER" >&2; exit 2; }
    set +e
    if [[ "$UNIT_RUNNER" == "service" ]]; then
      [[ -n "$UNIT_SERVICE" ]] || { echo "[evidence] Error: UNIT_SERVICE is required for UNIT_RUNNER=service" >&2; exit 2; }
      echo "[evidence] Unit checks in compose service '$UNIT_SERVICE': $UNIT_CMD"
      UNIT_OUT="$(dc exec -T "$UNIT_SERVICE" sh -c "$UNIT_CMD" 2>&1)"
    else
      # Same Node as the compose file unless UNIT_NODE_IMAGE says otherwise; no network, repository read-only.
      NODE_IMAGE="${UNIT_NODE_IMAGE:-$(sed -n 's/^[[:space:]]*image:[[:space:]]*\(node:[^[:space:]]*\).*/\1/p' "$COMPOSE_PATH" | head -n 1)}"
      [[ -n "$NODE_IMAGE" ]] || { echo "[evidence] Error: no node: image in $COMPOSE_FILE; set UNIT_NODE_IMAGE" >&2; exit 2; }
      echo "[evidence] Unit checks in a throwaway $NODE_IMAGE container: $UNIT_CMD"
      UNIT_OUT="$(docker run --rm --network none -v "$REPO_ROOT:/repo:ro" -w /repo "$NODE_IMAGE" sh -c "$UNIT_CMD" 2>&1)"
    fi
    UNIT_CMD_EXIT=$?
    set -e
    printf '%s\n' "$UNIT_OUT"
    UNIT_CASES=0
    UNIT_CASE_FAILS=0
    while IFS= read -r line; do
      if [[ "$line" =~ ^(ok|not\ ok)(\ [0-9]+)?\ -\ (.+)$ ]]; then
        # Copy first: tap_case runs its own [[ =~ ]] and overwrites BASH_REMATCH.
        result="${BASH_REMATCH[1]}"
        name="${BASH_REMATCH[3]}"
        tap_case "$result" "$name"
        UNIT_CASES=$((UNIT_CASES + 1))
        [[ "$result" == "ok" ]] || UNIT_CASE_FAILS=$((UNIT_CASE_FAILS + 1))
      fi
    done <<< "$UNIT_OUT"
    if [[ "$UNIT_CASES" -eq 0 || ( "$UNIT_CMD_EXIT" -ne 0 && "$UNIT_CASE_FAILS" -eq 0 ) ]]; then
      tap_case "not ok" "unit command exited $UNIT_CMD_EXIT without a usable TAP result"
    fi
    ;;
  *)
    echo "[evidence] Error: UNIT_RUNNER must be node, service or none (got '$UNIT_RUNNER')" >&2
    exit 2
    ;;
esac

if [[ -n "$SMOKE_CMD" ]]; then
  echo "[evidence] Smoke test: $SMOKE_CMD"
  # Host ports only for this command (exporting them would make "compose run" recreate the services).
  smoke_env=(EVIDENCE_APP_PORT="$APP_HOST_PORT" EVIDENCE_MOCK_PORT="$MOCK_HOST_PORT")
  [[ -z "$APP_PORT_VAR" ]] || smoke_env+=("$APP_PORT_VAR=$APP_HOST_PORT")
  [[ -z "$MOCK_PORT_VAR" ]] || smoke_env+=("$MOCK_PORT_VAR=$MOCK_HOST_PORT")
  set +e
  env "${smoke_env[@]}" bash -c "$SMOKE_CMD" 2>&1 | tee "$ARTIFACTS_DIR/smoke.log"
  SMOKE_EXIT="${PIPESTATUS[0]}"
  set -e
  if [[ "$SMOKE_EXIT" -eq 0 ]]; then
    tap_case ok "smoke: $SMOKE_CMD"
  else
    tap_case "not ok" "smoke: $SMOKE_CMD (exit $SMOKE_EXIT, see smoke.log)"
  fi
fi

UNIT_EXIT=0
if [[ "$T_TOTAL" -gt 0 ]]; then
  T_DURATION_MS=$(( $(date +%s%3N) - T_START_MS ))
  {
    printf '%s' "$TAP_BODY"
    echo "1..$T_TOTAL"
    echo "# tests $T_TOTAL"
    echo "# suites 0"
    echo "# pass $T_PASS"
    echo "# fail $T_FAIL"
    echo "# cancelled 0"
    echo "# skipped $T_SKIP"
    echo "# todo $T_TODO"
    echo "# duration_ms $T_DURATION_MS"
  } > "$ARTIFACTS_DIR/unit-tests.tap"
  [[ "$T_FAIL" -eq 0 ]] || UNIT_EXIT=1
  printf '{"exitCode":%d}\n' "$UNIT_EXIT" > "$ARTIFACTS_DIR/unit-status.json"
fi
echo "[evidence] Checks: $T_PASS/$T_TOTAL passed, $T_FAIL failed, $T_SKIP skipped"

echo "[evidence] Running Level 1 Playwright evidence suite + deterministic quality gate..."
evidence_container_env_args
# Without unit and smoke cases the report says that checks are disabled, not that they are missing.
[[ "$T_TOTAL" -gt 0 ]] || EVIDENCE_ENV_ARGS+=(-e UNIT_DISABLED=true)
set +e
LOCAL_UID="$(id -u)" LOCAL_GID="$(id -g)" \
  dc --profile evidence run -T --rm --build "${EVIDENCE_ENV_ARGS[@]}" -e EVIDENCE_OUT=/artifacts -e HOME=/tmp evidence
E2E_EXIT=$?
set -e

REPORT_PASS=false
if [[ -s "$ARTIFACTS_DIR/EVIDENCE.md" ]] && [[ "$(head -n 1 "$ARTIFACTS_DIR/EVIDENCE.md")" == "# Level 1 Evidence Report – PASS" ]]; then
  REPORT_PASS=true
fi

GATE_STRICT_PASS=false
if [[ -s "$ARTIFACTS_DIR/quality-gate.json" ]] && grep -Eq '^  "ok": true,$' "$ARTIFACTS_DIR/quality-gate.json" && grep -Eq '^  "mode": "strict",$' "$ARTIFACTS_DIR/quality-gate.json"; then
  GATE_STRICT_PASS=true
fi

echo ""
if [[ "$UNIT_EXIT" -eq 0 && "$E2E_EXIT" -eq 0 && "$REPORT_PASS" == "true" && "$GATE_STRICT_PASS" == "true" ]]; then
  echo "[evidence] PASS – Evidence bundle & quality gates ready:"
  echo "           Report:       $ARTIFACTS_DIR/EVIDENCE.md"
  echo "           Proof Video:  $ARTIFACTS_DIR/videos/proof.mp4"
  echo "           Preview GIF:  $ARTIFACTS_DIR/preview/proof-preview.gif"
  echo "           Step Timings: $ARTIFACTS_DIR/proof-steps.json"
  echo "           Quality Gate: $ARTIFACTS_DIR/quality-gate.json"
  echo "           Screenshots:  $ARTIFACTS_DIR/screenshots/"
  exit 0
else
  echo "[evidence] FAIL – Verification or quality gate failed (unit+smoke exit: $UNIT_EXIT, evidence/gate exit: $E2E_EXIT, report PASS: $REPORT_PASS, strict gate PASS: $GATE_STRICT_PASS)" >&2
  echo "           Inspect report: $ARTIFACTS_DIR/EVIDENCE.md" >&2
  exit 1
fi
