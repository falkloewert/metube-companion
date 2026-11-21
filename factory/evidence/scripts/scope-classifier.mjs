/**
 * Deterministic classifier for PR/workspace changed files.
 * Shared between generate-report.mjs and quality-gate.mjs so rules never drift.
 * The same two patterns are inlined in .github/workflows/level1-evidence.yml
 * (the publish job never checks out PR code): change both together.
 */

// Tests, mocks, evidence kit, sandbox compose file and the scripts that run them.
export const VERIFICATION_RE =
  /(^|[\/._-])(tests?|__tests__|specs?|mocks?|evidence)([\/._-]|$)|docker-compose|run-evidence\.sh|smoke\.sh/i;

// Paths where a green UI proof says nothing about safety: image and web server
// setup, compose files, CI, the whole factory sandbox, tests, extension manifests.
export const SENSITIVE_RE =
  /(^|\/)Dockerfile|^nginx\/|^docker\/|(^|\/)(docker-)?compose[^\/]*\.ya?ml$|^\.github\/|^factory\/|^tests\/|^extension\/manifest[^\/]*\.json$|(^|\/)\.env|secret/i;

export function parseChangedFiles(rawText) {
  return String(rawText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function classifyChangedFiles(paths) {
  const unique = [...new Set(paths)];
  const verification = unique.filter((p) => VERIFICATION_RE.test(p)).sort();
  const sensitive = unique.filter((p) => SENSITIVE_RE.test(p)).sort();
  return { all: unique.sort(), verification, sensitive };
}
