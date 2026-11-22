// managed by glass-factory kit v1.2.0 (8b5ada6), do not edit; change factory/evidence.config.sh or factory/evidence/tests/
/**
 * Deterministic classifier for PR/workspace changed files.
 * Shared between generate-report.mjs and quality-gate.mjs so rules never drift.
 *
 * The two patterns come from factory/evidence.config.sh (SCOPE_VERIFICATION_RE, SCOPE_SENSITIVE_RE),
 * passed in by run-evidence.sh. install.sh renders the same two strings into the CI workflow
 * (the publish job never checks out PR code), so there is one source of truth.
 * Patterns are regex sources; the case-insensitive flag is fixed.
 */

function requiredRegex(name) {
  const source = process.env[name];
  if (!source) {
    throw new Error(`${name} is not set; run through factory/evidence/run-evidence.sh (it exports factory/evidence.config.sh)`);
  }
  return new RegExp(source, 'i');
}

// Tests, mocks, evidence kit, sandbox compose file and the scripts that run them.
export const VERIFICATION_RE = requiredRegex('SCOPE_VERIFICATION_RE');

// Paths where a green UI proof says nothing about safety (auth, migrations, CI, images, secrets, ...).
export const SENSITIVE_RE = requiredRegex('SCOPE_SENSITIVE_RE');

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
