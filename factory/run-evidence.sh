#!/usr/bin/env bash
set -euo pipefail

# Level 0 + Level 1 evidence run for the factory sandbox, inside isolated Docker containers:
# 1. Starts the companion (`web`) + mock MeTube (`metube`) from docker-compose.factory.yml
#    (own project name + ephemeral loopback ports, so parallel runs never collide)
# 2. Unit checks: `node --check` over web/*.js extension/*.js, and `node --test` over tests/*.test.mjs if any exist
# 3. factory/smoke.sh against the sandbox
# 4. Playwright in the `evidence` container (same network, reaches web/metube by service name):
#    regression + proof projects, H.264 proof.mp4, GIF preview, step screenshots,
#    EVIDENCE.md, deterministic quality gate (quality-gate.json)
# 5. Tears everything down (containers, volumes, ephemeral images) unless --keep
# Exit code 0 only if every part and the strict quality gate pass.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker-compose.factory.yml"
cd "$REPO_ROOT"

dc() { docker compose --progress plain -f "$COMPOSE_FILE" "$@"; }

KEEP_RUNNING=false
CUSTOM_OUT=""

usage() {
  cat <<'EOF'
Usage: factory/run-evidence.sh [--keep] [--out <dir>]

Options:
  --keep        Keep the sandbox containers running (loopback ports are printed at the end)
  --out <dir>   Write evidence artifacts to <dir> instead of factory/artifacts.
                The folder is wiped on every run, so it must be empty or a
                previous evidence folder (marker file .evidence-artifacts).
  -h, --help    Show this help message
EOF
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
if [[ -n "$CUSTOM_OUT" ]]; then
  mkdir -p "$CUSTOM_OUT"
  ARTIFACTS_DIR="$(cd "$CUSTOM_OUT" && pwd)"
else
  ARTIFACTS_DIR="$SCRIPT_DIR/artifacts"
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
  export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-metube-companion-evidence-keep}"
elif [[ -z "${COMPOSE_PROJECT_NAME:-}" ]]; then
  RAND_SUFFIX="$(od -An -tx1 -N3 /dev/urandom | tr -d ' \n')"
  export COMPOSE_PROJECT_NAME="metube-companion-evidence-$$-${RAND_SUFFIX}"
  CLEANUP_RMI_LOCAL="true"
fi
export FACTORY_WEB_PORT="${FACTORY_WEB_PORT:-0}"
export FACTORY_MOCK_PORT="${FACTORY_MOCK_PORT:-0}"
# Slower simulated downloads than the default 250 ms, so the progress is readable in the proof video.
export FACTORY_MOCK_TICK_MS="${FACTORY_MOCK_TICK_MS:-700}"

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
    echo "           Companion UI:   http://127.0.0.1:${WEB_PORT:-?}"
    echo "           Mock inspector: http://127.0.0.1:${MOCK_PORT:-?}"
    echo "           Stop later:     cd \"$REPO_ROOT\" && COMPOSE_PROJECT_NAME=\"$COMPOSE_PROJECT_NAME\" docker compose -f docker-compose.factory.yml --profile evidence down -v"
  fi
}
trap cleanup EXIT

# Only wipe a folder this script created (marker) or an empty one.
if [[ -d "$ARTIFACTS_DIR" && ! -f "$ARTIFACTS_DIR/.evidence-artifacts" ]] && [[ -n "$(ls -A "$ARTIFACTS_DIR")" ]]; then
  echo "[evidence] Error: $ARTIFACTS_DIR is not empty and is no evidence folder (.evidence-artifacts missing); refusing to wipe it" >&2
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

WEB_PORT="$(dc port web 8080 | tail -n 1 | sed 's/.*://')"
MOCK_PORT="$(dc port metube 8081 | tail -n 1 | sed 's/.*://')"
echo "[evidence] Sandbox up: companion 127.0.0.1:$WEB_PORT, mock MeTube 127.0.0.1:$MOCK_PORT"

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

# Same Node as the mock MeTube in the compose file, no network, repository read-only.
NODE_IMAGE="$(sed -n 's/^[[:space:]]*image:[[:space:]]*\(node:[^[:space:]]*\).*/\1/p' "$COMPOSE_FILE" | head -n 1)"
run_node() { docker run --rm --network none -v "$REPO_ROOT:/repo:ro" -w /repo "$NODE_IMAGE" "$@"; }

echo "[evidence] Unit check: node --check web/*.js web/i18n/*.js extension/*.js ($NODE_IMAGE)..."
SYNTAX_OUT="$(run_node sh -c 'for f in web/*.js web/i18n/*.js extension/*.js; do if node --check "$f" 2>&1; then echo "OK $f"; else echo "FAIL $f"; fi; done' 2>&1 || true)"
SYNTAX_SEEN=0
while IFS= read -r line; do
  case "$line" in
    "OK "*)   tap_case ok "node --check ${line#OK }"; SYNTAX_SEEN=1 ;;
    "FAIL "*) tap_case "not ok" "node --check ${line#FAIL }"; SYNTAX_SEEN=1 ;;
    *)        [[ -n "$line" ]] && echo "       $line" ;;
  esac
done <<< "$SYNTAX_OUT"
[[ "$SYNTAX_SEEN" -eq 1 ]] || tap_case "not ok" "node --check could not run"

if find tests -name '*.test.mjs' -print -quit | grep -q .; then
  echo "[evidence] Unit check: node --test tests/*.test.mjs..."
  set +e
  TEST_OUT="$(run_node sh -c 'node --test --test-reporter=tap $(find tests -name "*.test.mjs" | sort)' 2>&1)"
  TEST_EXIT=$?
  set -e
  printf '%s\n' "$TEST_OUT"
  NODE_TEST_CASES=0
  NODE_TEST_FAILS=0
  while IFS= read -r line; do
    if [[ "$line" =~ ^(ok|not\ ok)\ [0-9]+\ -\ (.+)$ ]]; then
      # Copy first: tap_case runs its own [[ =~ ]] and overwrites BASH_REMATCH.
      result="${BASH_REMATCH[1]}"
      name="${BASH_REMATCH[2]}"
      tap_case "$result" "node --test: $name"
      NODE_TEST_CASES=$((NODE_TEST_CASES + 1))
      [[ "$result" == "ok" ]] || NODE_TEST_FAILS=$((NODE_TEST_FAILS + 1))
    fi
  done <<< "$TEST_OUT"
  if [[ "$NODE_TEST_CASES" -eq 0 || ( "$TEST_EXIT" -ne 0 && "$NODE_TEST_FAILS" -eq 0 ) ]]; then
    tap_case "not ok" "node --test exited $TEST_EXIT"
  fi
else
  echo "[evidence] No tests/*.test.mjs yet, skipping node --test."
fi

echo "[evidence] Smoke test: factory/smoke.sh..."
set +e
FACTORY_WEB_PORT="$WEB_PORT" FACTORY_MOCK_PORT="$MOCK_PORT" "$SCRIPT_DIR/smoke.sh" 2>&1 | tee "$ARTIFACTS_DIR/smoke.log"
SMOKE_EXIT="${PIPESTATUS[0]}"
set -e
if [[ "$SMOKE_EXIT" -eq 0 ]]; then
  tap_case ok "smoke: factory/smoke.sh (endpoints, file rules, language, download, failure paths)"
else
  tap_case "not ok" "smoke: factory/smoke.sh (exit $SMOKE_EXIT, see smoke.log)"
fi

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
UNIT_EXIT=0
[[ "$T_FAIL" -eq 0 ]] || UNIT_EXIT=1
printf '{"exitCode":%d}\n' "$UNIT_EXIT" > "$ARTIFACTS_DIR/unit-status.json"
echo "[evidence] Checks: $T_PASS/$T_TOTAL passed, $T_FAIL failed, $T_SKIP skipped"

echo "[evidence] Running Level 1 Playwright evidence suite + deterministic quality gate..."
set +e
LOCAL_UID="$(id -u)" LOCAL_GID="$(id -g)" \
  dc --profile evidence run -T --rm --build evidence
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
