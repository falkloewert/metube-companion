// managed by glass-factory kit v1.2.0 (8b5ada6), do not edit; change factory/evidence.config.sh or factory/evidence/tests/
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { classifyChangedFiles, parseChangedFiles } from './scope-classifier.mjs';

const execFileAsync = promisify(execFile);

const OUT_DIR = process.env.EVIDENCE_OUT || path.resolve('./artifacts');
// Report wording from factory/evidence.config.sh (see README, "Config reference").
const UNIT_LABEL = process.env.UNIT_LABEL || 'Unit Tests';
// Set by run-evidence.sh when UNIT_RUNNER=none and there is no SMOKE_CMD.
const UNIT_DISABLED = process.env.UNIT_DISABLED === 'true';
const ENVIRONMENT_DESC = process.env.ENVIRONMENT_DESC || '';
const SCOPE_SENSITIVE_LABEL = process.env.SCOPE_SENSITIVE_LABEL || 'Sensitive paths (auth, migrations, CI, Docker, secrets)';
const RESULTS_FILE = path.join(OUT_DIR, 'results.json');
const PROOF_STEPS_FILE = path.join(OUT_DIR, 'proof-steps.json');
const UNIT_TAP_FILE = path.join(OUT_DIR, 'unit-tests.tap');
const UNIT_STATUS_FILE = path.join(OUT_DIR, 'unit-status.json');
const CHANGED_FILES_PATH = path.join(OUT_DIR, 'changed-files.txt');
const MEDIA_META_FILE = path.join(OUT_DIR, 'media-meta.json');
const VIDEOS_DIR = path.join(OUT_DIR, 'videos');
const FAILURE_VIDEOS_DIR = path.join(VIDEOS_DIR, 'failures');
const PREVIEW_DIR = path.join(OUT_DIR, 'preview');
const SCREENSHOTS_DIR = path.join(OUT_DIR, 'screenshots');
const TEST_RESULTS_DIR = path.join(OUT_DIR, 'test-results');

function stripAnsi(str) {
  return String(str || '').replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

function escapeCell(str) {
  return String(str || '').replaceAll('|', '\\|').replaceAll('\n', ' ').trim();
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function parseFrameRate(raw) {
  if (!raw) return 0;
  const parts = String(raw).split('/');
  if (parts.length === 2) {
    const num = Number(parts[0]);
    const den = Number(parts[1]);
    return den > 0 ? Number((num / den).toFixed(2)) : 0;
  }
  return Number(Number(raw).toFixed(2)) || 0;
}

function flattenSpecs(suites = [], acc = []) {
  for (const suite of suites) {
    for (const spec of suite.specs || []) {
      const testRuns = spec.tests?.length ? spec.tests : [null];
      for (const testRun of testRuns) {
        const results = testRun?.results || [];
        const result = results.at(-1);
        const isSkipped =
          testRun?.status === 'skipped' ||
          testRun?.expectedStatus === 'skipped' ||
          result?.status === 'skipped' ||
          (!result && Boolean(spec.ok));
        const status = isSkipped ? 'skipped' : result?.status || (spec.ok ? 'passed' : 'failed');
        const passed = !isSkipped && Boolean(spec.ok) && status === 'passed';
        const errorMsg = result?.error?.message
          ? stripAnsi(result.error.message).split('\n')[0].trim()
          : '';
        acc.push({
          title: spec.title,
          projectName: testRun?.projectName || 'default',
          ok: passed,
          skipped: isSkipped,
          status,
          durationMs: result?.duration ?? 0,
          errorMessage: errorMsg,
          attachments: result?.attachments || [],
        });
      }
    }
    if (suite.suites?.length) {
      flattenSpecs(suite.suites, acc);
    }
  }
  return acc;
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

async function listFilesSafe(dir, ext) {
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((f) => f.endsWith(ext)).sort();
  } catch {
    return [];
  }
}

async function removeWebmRecursive(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await removeWebmRecursive(full);
      } else if (entry.name.endsWith('.webm')) {
        await fs.rm(full, { force: true });
      }
    }
  } catch {
    // Ignore missing dirs.
  }
}

async function runCmd(cmd, args) {
  const { stdout, stderr } = await execFileAsync(cmd, args, { maxBuffer: 20 * 1024 * 1024 });
  return { stdout, stderr };
}

async function probeMedia(filePath) {
  const { stdout } = await runCmd('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=codec_name,pix_fmt,width,height,avg_frame_rate,r_frame_rate',
    '-show_entries',
    'format=duration,size',
    '-of',
    'json',
    filePath,
  ]);
  const data = JSON.parse(stdout);
  const stream = data.streams?.[0] || {};
  const format = data.format || {};
  const fps = parseFrameRate(stream.avg_frame_rate) || parseFrameRate(stream.r_frame_rate);
  return {
    codec: stream.codec_name || 'unknown',
    pixFmt: stream.pix_fmt || 'unknown',
    width: Number(stream.width || 0),
    height: Number(stream.height || 0),
    fps,
    durationSeconds: Number(Number(format.duration || 0).toFixed(2)),
    sizeBytes: Number(format.size || 0),
  };
}

async function transcodeToH264Mp4(srcWebm, destMp4, trimStartSeconds = 0) {
  const trimArgs = trimStartSeconds > 0.05 ? ['-ss', String(trimStartSeconds)] : [];
  await runCmd('ffmpeg', [
    '-y',
    ...trimArgs,
    '-i',
    srcWebm,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '22',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-an',
    destMp4,
  ]);
  return probeMedia(destMp4);
}

async function buildSmoothPreviewGif(srcMp4, destGif) {
  // Smooth 12 fps, 960px wide, 128-color palette so step banners & click highlights stay crisp and legible.
  await runCmd('ffmpeg', [
    '-y',
    '-i',
    srcMp4,
    '-vf',
    'fps=12,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a',
    '-loop',
    '0',
    destGif,
  ]);
  return probeMedia(destGif);
}

async function readUnitResults() {
  let exitCode = null;
  try {
    const rawStatus = await fs.readFile(UNIT_STATUS_FILE, 'utf-8');
    const parsed = JSON.parse(rawStatus);
    if (typeof parsed.exitCode === 'number') {
      exitCode = parsed.exitCode;
    }
  } catch {
    // Optional in standalone evidence runs.
  }

  let tapRaw = '';
  try {
    tapRaw = await fs.readFile(UNIT_TAP_FILE, 'utf-8');
  } catch {
    if (exitCode === null) return null;
    return {
      exitCode,
      total: 0,
      passed: 0,
      failed: exitCode === 0 ? 0 : 1,
      skipped: 0,
      cancelled: 0,
      todo: 0,
      durationMs: 0,
      cases: [],
      ok: false,
    };
  }

  const cases = [];
  let total = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let cancelled = 0;
  let todo = 0;
  let durationMs = 0;

  for (const line of tapRaw.split(/\r?\n/)) {
    const caseMatch = line.match(/^(ok|not ok)\s+\d+\s+-\s+(.+)$/);
    if (caseMatch) {
      const rawTitle = caseMatch[2].trim();
      const isSkip = /#\s*SKIP\b/i.test(rawTitle);
      const isTodo = /#\s*TODO\b/i.test(rawTitle);
      cases.push({
        ok: caseMatch[1] === 'ok' && !isSkip && !isTodo,
        status: isSkip ? 'SKIP' : isTodo ? 'TODO' : caseMatch[1] === 'ok' ? 'PASS' : 'FAIL',
        title: rawTitle,
      });
      continue;
    }
    const statMatch = line.match(/^#\s+(tests|pass|fail|skipped|cancelled|todo|duration_ms)\s+([\d.]+)$/);
    if (statMatch) {
      const key = statMatch[1];
      const val = Number(statMatch[2]);
      if (key === 'tests') total = val;
      if (key === 'pass') passed = val;
      if (key === 'fail') failed = val;
      if (key === 'skipped') skipped = val;
      if (key === 'cancelled') cancelled = val;
      if (key === 'todo') todo = val;
      if (key === 'duration_ms') durationMs = val;
    }
  }

  if (total === 0 && cases.length > 0) {
    total = cases.length;
    passed = cases.filter((c) => c.status === 'PASS').length;
    skipped = cases.filter((c) => c.status === 'SKIP').length;
    todo = cases.filter((c) => c.status === 'TODO').length;
    failed = cases.filter((c) => c.status === 'FAIL').length;
  }

  const effectiveExitCode =
    exitCode ?? (failed === 0 && skipped === 0 && cancelled === 0 && todo === 0 && passed > 0 ? 0 : 1);
  const ok =
    effectiveExitCode === 0 &&
    total > 0 &&
    passed > 0 &&
    failed === 0 &&
    skipped === 0 &&
    cancelled === 0 &&
    todo === 0;

  return { exitCode: effectiveExitCode, total, passed, failed, skipped, cancelled, todo, durationMs, cases, ok };
}

async function readChangedFiles() {
  try {
    const raw = await fs.readFile(CHANGED_FILES_PATH, 'utf-8');
    return classifyChangedFiles(parseChangedFiles(raw));
  } catch {
    return classifyChangedFiles([]);
  }
}

async function readProofSteps() {
  try {
    const raw = await fs.readFile(PROOF_STEPS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      trimStartSeconds: Number(parsed.trimStartSeconds || 0),
      steps: Array.isArray(parsed.steps) ? parsed.steps : [],
    };
  } catch {
    return { trimStartSeconds: 0, steps: [] };
  }
}

async function main() {
  const unit = await readUnitResults();
  const scope = await readChangedFiles();
  const proofSteps = await readProofSteps();

  let specs = [];
  let topLevelErrors = [];
  let reportedSkippedStat = 0;
  let e2eParseError = null;
  try {
    const raw = await fs.readFile(RESULTS_FILE, 'utf-8');
    const report = JSON.parse(raw);
    specs = flattenSpecs(report.suites);
    topLevelErrors = Array.isArray(report.errors) ? report.errors : [];
    reportedSkippedStat = Number(report.stats?.skipped || 0);
  } catch (err) {
    e2eParseError = err.message;
  }

  await fs.rm(PREVIEW_DIR, { recursive: true, force: true });
  await fs.rm(FAILURE_VIDEOS_DIR, { recursive: true, force: true });
  await fs.mkdir(VIDEOS_DIR, { recursive: true });
  await fs.mkdir(PREVIEW_DIR, { recursive: true });
  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });

  for (const entry of await listFilesSafe(VIDEOS_DIR, '.webm')) {
    await fs.rm(path.join(VIDEOS_DIR, entry), { force: true });
  }
  for (const entry of await listFilesSafe(VIDEOS_DIR, '.mp4')) {
    await fs.rm(path.join(VIDEOS_DIR, entry), { force: true });
  }

  const proofSpecs = specs.filter((s) => s.projectName === 'proof');
  const proofSpec =
    proofSpecs.find((s) => s.attachments.some((a) => a.name === 'video' && a.path)) ||
    [...specs].reverse().find((s) => s.attachments.some((a) => a.name === 'video' && a.path));

  let proofMedia = null;
  let previewGifMedia = null;
  const failureVideos = [];

  if (proofSpec) {
    const videoAttachment = proofSpec.attachments.find((a) => a.name === 'video' && a.path);
    if (videoAttachment) {
      const mp4Path = path.join(VIDEOS_DIR, 'proof.mp4');
      try {
        const meta = await transcodeToH264Mp4(videoAttachment.path, mp4Path, proofSteps.trimStartSeconds);
        proofMedia = {
          spec: proofSpec.title,
          file: 'videos/proof.mp4',
          trimmedStartSeconds: proofSteps.trimStartSeconds,
          ...meta,
        };
        const gifPath = path.join(PREVIEW_DIR, 'proof-preview.gif');
        const gifMeta = await buildSmoothPreviewGif(mp4Path, gifPath);
        previewGifMedia = { file: 'preview/proof-preview.gif', ...gifMeta };
      } catch (err) {
        console.error(`[evidence] failed to encode proof.mp4 / preview GIF: ${err.message}`);
      }
    }
  }

  for (let i = 0; i < specs.length; i += 1) {
    const spec = specs[i];
    if (spec.ok) continue;

    const failShot = spec.attachments.find((a) => a.name === 'screenshot' && a.path);
    if (failShot) {
      const targetName = `fail-${String(i + 1).padStart(2, '0')}-${slugify(spec.title)}.png`;
      try {
        await fs.copyFile(failShot.path, path.join(SCREENSHOTS_DIR, targetName));
      } catch (err) {
        console.warn(`[evidence] could not copy failure screenshot for "${spec.title}": ${err.message}`);
      }
    }

    if (spec !== proofSpec) {
      const failVideo = spec.attachments.find((a) => a.name === 'video' && a.path);
      if (failVideo) {
        await fs.mkdir(FAILURE_VIDEOS_DIR, { recursive: true });
        const targetName = `fail-${String(i + 1).padStart(2, '0')}-${slugify(spec.title)}.mp4`;
        try {
          await transcodeToH264Mp4(failVideo.path, path.join(FAILURE_VIDEOS_DIR, targetName));
          failureVideos.push({ spec: spec.title, file: `videos/failures/${targetName}` });
        } catch (err) {
          console.warn(`[evidence] could not encode failure video for "${spec.title}": ${err.message}`);
        }
      }
    }
  }

  const screenshots = await listFilesSafe(SCREENSHOTS_DIR, '.png');
  const e2eTotal = specs.length;
  const e2ePassed = specs.filter((s) => s.ok).length;
  const e2eSkipped = Math.max(specs.filter((s) => s.skipped).length, reportedSkippedStat);
  const e2eFailed = Math.max(0, e2eTotal - e2ePassed - specs.filter((s) => s.skipped).length);
  const e2eTotalMs = specs.reduce((sum, s) => sum + s.durationMs, 0);
  const e2eOk =
    !e2eParseError &&
    topLevelErrors.length === 0 &&
    e2eTotal > 0 &&
    e2ePassed > 0 &&
    e2eFailed === 0 &&
    e2eSkipped === 0;
  const unitOk = unit ? unit.ok : true;
  const verdict = unitOk && e2eOk ? 'PASS' : 'FAIL';

  // Remove raw scratch .webm files across the entire artifacts tree once transcoded to MP4.
  if (verdict === 'PASS') {
    await fs.rm(TEST_RESULTS_DIR, { recursive: true, force: true });
  } else {
    await removeWebmRecursive(TEST_RESULTS_DIR);
  }

  const mediaMeta = {
    proofVideo: proofMedia,
    proofSpecCount: proofSpecs.length,
    previewGif: previewGifMedia,
    steps: proofSteps.steps,
    failureVideos,
    screenshots: screenshots.map((f) => `screenshots/${f}`),
  };
  await fs.writeFile(MEDIA_META_FILE, JSON.stringify(mediaMeta, null, 2), 'utf-8');

  const unitSkippedNote =
    unit && (unit.skipped > 0 || unit.cancelled > 0 || unit.todo > 0)
      ? `, ${unit.skipped} skipped, ${unit.cancelled} cancelled, ${unit.todo} todo`
      : '';
  const unitSummaryLine = unit
    ? `**${unit.ok ? 'PASS' : 'FAIL'}** – **${unit.passed}/${unit.total} passed** (${unit.failed} failed${unitSkippedNote}, exit ${unit.exitCode}) in **${(unit.durationMs / 1000).toFixed(2)}s**`
    : UNIT_DISABLED
      ? '*(disabled in evidence.config.sh: UNIT_RUNNER=none and no SMOKE_CMD)*'
      : '*(not captured in standalone evidence run)*';

  const e2eSkippedNote = e2eSkipped > 0 ? `, ${e2eSkipped} skipped` : '';
  const e2eErrorNote = topLevelErrors.length > 0 ? `, ${topLevelErrors.length} suite errors` : '';
  const e2eSummaryLine = e2eParseError
    ? `**FAIL** – could not read Playwright results (${e2eParseError})`
    : `**${e2eOk ? 'PASS' : 'FAIL'}** – **${e2ePassed}/${e2eTotal} passed** (${e2eFailed} failed${e2eSkippedNote}${e2eErrorNote}) in **${(e2eTotalMs / 1000).toFixed(2)}s**`;

  // Reviewer-first Visual Proof section (direct video link + smooth 12fps GIF + full-resolution step screenshots)
  // GIF first: phones (T3 Code, mobile browsers) cannot play the MP4 link, so the preview must lead.
  const visualProofLines = ['## Visual Proof (1 Ticket = 1 Step-Paced Flow)'];
  if (previewGifMedia) {
    visualProofLines.push('', '![Level 1 Proof Preview](preview/proof-preview.gif)');
  }
  if (proofMedia) {
    visualProofLines.push(
      '',
      `- **Full Proof Video (H.264 MP4):** [Watch \`videos/proof.mp4\` (${proofMedia.durationSeconds}s, ${proofMedia.width}x${proofMedia.height}, ${formatBytes(proofMedia.sizeBytes)})](videos/proof.mp4)`
    );
  } else {
    visualProofLines.push('', '- **Full Proof Video:** *(none captured)*');
  }
  if (previewGifMedia) {
    visualProofLines.push(
      `- **Smooth Inline Preview GIF:** \`preview/proof-preview.gif\` (${previewGifMedia.width}x${previewGifMedia.height}, ${previewGifMedia.fps} fps, ${formatBytes(previewGifMedia.sizeBytes)})`
    );
  }

  if (proofSteps.steps.length > 0) {
    visualProofLines.push('', '### Step-by-Step Result Screenshots *(Full 1280×720 – click any image to zoom)*');
    for (const s of proofSteps.steps) {
      const leadLabel = typeof s.leadInSeconds === 'number' ? `lead ${s.leadInSeconds}s, ` : '';
      const gapLabel = typeof s.minActionGapSeconds === 'number' ? `min action gap ${s.minActionGapSeconds}s, ` : '';
      visualProofLines.push(
        '',
        `**Step ${s.step}/${s.total} – ${s.title}** *(${leadLabel}${gapLabel}hold ${s.endHoldSeconds}s, total ${s.durationSeconds}s)*`,
        `> **Verified:** ${s.assertion}`,
        '',
        `![Step ${s.step}/${s.total}: ${s.title}](${s.screenshot})`
      );
    }
  } else if (screenshots.length > 0) {
    visualProofLines.push('', '### Captured Screenshots');
    for (const f of screenshots) {
      visualProofLines.push('', `![${f}](screenshots/${f})`);
    }
  }

  if (failureVideos.length > 0) {
    visualProofLines.push(
      '',
      '### Regression Failure Videos',
      ...failureVideos.map((v) => `- \`${v.file}\` – ${v.spec}`)
    );
  }

  // Failure Details (always prominent at top when FAIL)
  const failedSpecs = specs.filter((s) => !s.ok);
  const failureLines = [];
  for (const s of failedSpecs) {
    failureLines.push(
      `- **${s.title} (${s.status}):** \`${s.errorMessage || (s.skipped ? 'Skipped tests are disallowed at Level 1' : 'Assertion failed (see Playwright logs)')}\``
    );
  }
  for (const err of topLevelErrors) {
    const msg = stripAnsi(err?.message || String(err)).split('\n')[0].trim();
    failureLines.push(`- **Playwright Suite Error:** \`${msg}\``);
  }
  const failureDetailsSection = failureLines.length
    ? ['## Failure Details', '', ...failureLines, ''].join('\n')
    : '';

  // Scope & Verification Integrity (always visible, never collapsed)
  const scopeLines = ['## Scope & Verification Integrity'];
  if (scope.verification.length > 0) {
    scopeLines.push(
      '- **Modified test / mock / sandbox files (inspect assertions carefully to confirm no checks were weakened):**',
      ...scope.verification.map((p) => `  - \`${p}\``)
    );
  } else {
    scopeLines.push('- **Test / mock / sandbox files:** Unchanged.');
  }
  if (scope.sensitive.length > 0) {
    scopeLines.push(
      '- **Sensitive paths touched (UI proof videos do NOT substitute for manual code/security review):**',
      ...scope.sensitive.map((p) => `  - \`${p}\``)
    );
  } else {
    scopeLines.push(`- **${SCOPE_SENSITIVE_LABEL}:** None detected.`);
  }

  // Detailed Test Tables inside collapsible <details> so the PR comment stays crisp and scannable
  const unitTableLines = unit
    ? [
        `### ${UNIT_LABEL}`,
        '',
        ...(unit.cases.length
          ? [
              '| Status | Test Case |',
              '|---|---|',
              ...unit.cases.map((c) => `| ${c.status} | ${escapeCell(c.title)} |`),
            ]
          : [`- The ${UNIT_LABEL} runner exited with code \`${unit.exitCode}\` and produced no test cases.`]),
        '',
      ]
    : [];

  const e2eRows = specs.length
    ? specs
        .map(
          (s) =>
            `| ${s.ok ? 'PASS' : s.skipped ? 'SKIP' : 'FAIL'} | ${escapeCell(s.projectName)} | ${escapeCell(s.title)} | ${(s.durationMs / 1000).toFixed(2)}s |`
        )
        .join('\n')
    : '| FAIL | – | *(no E2E scenarios executed)* | 0.00s |';

  const testDetailsSummary = `Automated Test Details – ${UNIT_LABEL} ${unit ? `${unit.passed}/${unit.total}` : 'n/a'}, E2E ${e2ePassed}/${e2eTotal}`;
  const testDetailsSection = [
    `<details${verdict === 'FAIL' ? ' open' : ''}>`,
    `<summary><strong>${testDetailsSummary}</strong></summary>`,
    '',
    ...unitTableLines,
    '### End-to-End Verification (Playwright)',
    '',
    '| Status | Suite | Scenario | Duration |',
    '|---|---|---|---|',
    e2eRows,
    '',
    '</details>',
  ].join('\n');

  const markdown = `# Level 1 Evidence Report – ${verdict}

- **${UNIT_LABEL}:** ${unitSummaryLine}
- **E2E Tests (Playwright):** ${e2eSummaryLine}
- **Environment:** Isolated Local Docker Compose Sandbox (${ENVIRONMENT_DESC ? `${ENVIRONMENT_DESC}, ` : ''}**0 prod secrets**)
- **Generated:** ${new Date().toISOString()}

${failureDetailsSection}${visualProofLines.join('\n')}

${scopeLines.join('\n')}

${testDetailsSection}
`;

  const reportPath = path.join(OUT_DIR, 'EVIDENCE.md');
  await fs.writeFile(reportPath, markdown, 'utf-8');
  console.log(
    `[evidence] wrote ${reportPath} (${verdict}: unit=${unit ? `${unit.passed}/${unit.total}` : 'n/a'}, e2e=${e2ePassed}/${e2eTotal}, steps=${proofSteps.steps.length}, video=${proofMedia ? `${proofMedia.durationSeconds}s ${proofMedia.codec}` : 'none'}, gif=${previewGifMedia ? `${previewGifMedia.fps}fps ${previewGifMedia.width}px` : 'none'})`
  );
}

main().catch((err) => {
  console.error('[evidence] failed to generate report:', err);
  process.exit(1);
});
