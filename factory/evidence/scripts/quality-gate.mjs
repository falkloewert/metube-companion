// managed by glass-factory kit v1.2.0 (8b5ada6), do not edit; change factory/evidence.config.sh or factory/evidence/tests/
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { classifyChangedFiles, parseChangedFiles } from './scope-classifier.mjs';

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  let outDir = process.env.EVIDENCE_OUT || path.resolve('./artifacts');
  let strict = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--artifacts' && argv[i + 1]) {
      outDir = path.resolve(argv[i + 1]);
      i += 1;
    } else if (argv[i] === '--strict') {
      strict = true;
    }
  }
  return { outDir, strict };
}

async function listDirSafe(dir) {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

async function findFilesByExtRecursive(dir, ext, baseDir = dir, acc = []) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await findFilesByExtRecursive(full, ext, baseDir, acc);
      } else if (entry.name.endsWith(ext)) {
        acc.push(path.relative(baseDir, full));
      }
    }
  } catch {
    // Missing dir is fine.
  }
  return acc.sort();
}

async function statSafe(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
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

async function probeMedia(filePath) {
  const { stdout } = await execFileAsync(
    'ffprobe',
    [
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
    ],
    { maxBuffer: 5 * 1024 * 1024 }
  );
  const parsed = JSON.parse(stdout);
  const stream = parsed.streams?.[0] || {};
  const format = parsed.format || {};
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

function collectPlaywrightAudit(suites = [], acc = { total: 0, passed: 0, skipped: 0, failed: 0, proofSpecs: 0 }) {
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
        acc.total += 1;
        if (testRun?.projectName === 'proof') acc.proofSpecs += 1;
        if (isSkipped) acc.skipped += 1;
        else if (Boolean(spec.ok) && status === 'passed') acc.passed += 1;
        else acc.failed += 1;
      }
    }
    if (suite.suites?.length) {
      collectPlaywrightAudit(suite.suites, acc);
    }
  }
  return acc;
}

async function auditRawTestOutputs(outDir, { requireResults, failOnFailures }) {
  const issues = [];

  const resultsPath = path.join(outDir, 'results.json');
  if (await statSafe(resultsPath)) {
    try {
      const report = JSON.parse(await fs.readFile(resultsPath, 'utf-8'));
      const stats = collectPlaywrightAudit(report.suites || []);
      const topErrors = Array.isArray(report.errors) ? report.errors.length : 0;
      const reportedSkipped = Math.max(stats.skipped, Number(report.stats?.skipped || 0));

      if (reportedSkipped > 0) issues.push(`Playwright skipped ${reportedSkipped} test(s)`);
      if (failOnFailures) {
        if (topErrors > 0) issues.push(`Playwright reported ${topErrors} top-level suite error(s)`);
        if (stats.total === 0 || stats.passed === 0) issues.push('Playwright executed 0 passing tests');
        if (stats.failed > 0) issues.push(`Playwright had ${stats.failed} failing test(s)`);
        if (stats.proofSpecs > 1) {
          issues.push(`Expected 1 focused proof spec (1 Ticket = 1 Video), found ${stats.proofSpecs}`);
        }
      }
    } catch (err) {
      issues.push(`Invalid results.json: ${err.message}`);
    }
  } else if (requireResults) {
    issues.push('Missing Playwright results.json');
  }

  const tapPath = path.join(outDir, 'unit-tests.tap');
  if (await statSafe(tapPath)) {
    const tapRaw = await fs.readFile(tapPath, 'utf-8');
    let passCount = 0;
    let failCount = 0;
    let skipCount = 0;
    let cancelCount = 0;
    let todoCount = 0;
    for (const line of tapRaw.split(/\r?\n/)) {
      const m = line.match(/^#\s+(pass|fail|skipped|cancelled|todo)\s+(\d+)$/);
      if (!m) continue;
      const val = Number(m[2]);
      if (m[1] === 'pass') passCount = val;
      if (m[1] === 'fail') failCount = val;
      if (m[1] === 'skipped') skipCount = val;
      if (m[1] === 'cancelled') cancelCount = val;
      if (m[1] === 'todo') todoCount = val;
    }
    if (skipCount > 0) issues.push(`Unit tests skipped ${skipCount} case(s)`);
    if (cancelCount > 0) issues.push(`Unit tests cancelled ${cancelCount} case(s)`);
    if (todoCount > 0) issues.push(`Unit tests had ${todoCount} todo case(s)`);
    if (failOnFailures) {
      if (passCount === 0) issues.push('Unit tests had 0 passing cases');
      if (failCount > 0) issues.push(`Unit tests had ${failCount} failing case(s)`);
    }
  }

  return issues;
}

// Specs must import `test` from ../scripts/sandbox.mjs: a spec that imports Playwright directly runs
// without the reset and the network fence. Comments are stripped so documentation can mention the package.
const DIRECT_PLAYWRIGHT_IMPORT = /['"`](?:@playwright\/test|playwright|playwright-core)(?:\/[^'"`]*)?['"`]/;

async function findDirectPlaywrightImports(testsDir) {
  const offenders = [];
  async function walk(dir) {
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (/\.(mjs|cjs|js|mts|cts|ts)$/.test(entry.name)) {
        const code = (await fs.readFile(full, 'utf-8'))
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/.*$/gm, '$1');
        if (DIRECT_PLAYWRIGHT_IMPORT.test(code)) offenders.push(path.relative(testsDir, full));
      }
    }
  }
  await walk(testsDir);
  return offenders.sort();
}

async function main() {
  const { outDir, strict } = parseArgs(process.argv.slice(2));
  // Step-pacing rules (instead of rigid total duration caps)
  const minStepSeconds = Number(process.env.MIN_STEP_SECONDS || 2.8);
  const minStepLeadSeconds = Number(process.env.MIN_STEP_LEAD_SECONDS || 0.8);
  const minStepHoldSeconds = Number(process.env.MIN_STEP_HOLD_SECONDS || 1.4);
  const minActionGapSeconds = Number(process.env.MIN_ACTION_GAP_SECONDS || 0.8);
  const minSanitySeconds = Number(process.env.MIN_SANITY_SECONDS || 3);
  const maxSanitySeconds = Number(process.env.MAX_SANITY_SECONDS || 180);
  // Smooth, readable inline preview & full-resolution screenshot rules
  const minGifFps = Number(process.env.MIN_GIF_FPS || 10);
  const minGifWidth = Number(process.env.MIN_GIF_WIDTH || 800);
  const maxGifBytes = Number(process.env.MAX_PREVIEW_GIF_BYTES || 6 * 1024 * 1024);
  const minShotWidth = Number(process.env.MIN_SCREENSHOT_WIDTH || 1000);

  const reportPath = path.join(outDir, 'EVIDENCE.md');
  const videosDir = path.join(outDir, 'videos');
  const previewDir = path.join(outDir, 'preview');
  const proofStepsPath = path.join(outDir, 'proof-steps.json');
  const changedFilesPath = path.join(outDir, 'changed-files.txt');
  const gateOutPath = path.join(outDir, 'quality-gate.json');

  const checks = [];
  const addCheck = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail });

  // 1. Report exists and line 1 strictly declares PASS or FAIL (anchored at start of file, no /m bypass)
  let reportText = '';
  let reportVerdict = null;
  const reportStat = await statSafe(reportPath);
  if (reportStat && reportStat.size > 0) {
    reportText = await fs.readFile(reportPath, 'utf-8');
    const headerMatch = reportText.match(/^# Level 1 Evidence Report – (PASS|FAIL)\r?\n/);
    if (headerMatch) {
      reportVerdict = headerMatch[1];
      addCheck('report_exists', true, `EVIDENCE.md present (${reportStat.size} bytes, verdict=${reportVerdict})`);
    } else {
      addCheck('report_exists', false, 'EVIDENCE.md line 1 must strictly match "# Level 1 Evidence Report – PASS|FAIL"');
    }
  } else {
    addCheck('report_exists', false, 'Missing or empty EVIDENCE.md');
  }

  const isTestFailureReport = reportVerdict === 'FAIL';
  const enforceFullMediaGate = strict || !isTestFailureReport;

  // 2. Sensitive / verification file disclosure check (always enforced)
  let changedRaw = '';
  try {
    changedRaw = await fs.readFile(changedFilesPath, 'utf-8');
  } catch {
    changedRaw = '';
  }
  const scope = classifyChangedFiles(parseChangedFiles(changedRaw));
  if (scope.sensitive.length > 0 || scope.verification.length > 0) {
    const hasHeading = reportText.includes('## Scope & Verification Integrity');
    const missingSensitive = scope.sensitive.filter((p) => !reportText.includes(`\`${p}\``));
    const missingVerification = scope.verification.filter((p) => !reportText.includes(`\`${p}\``));
    const ok = hasHeading && missingSensitive.length === 0 && missingVerification.length === 0;
    addCheck(
      'sensitive_scope_disclosed',
      ok,
      ok
        ? `Disclosed ${scope.sensitive.length} sensitive and ${scope.verification.length} verification paths`
        : `Missing disclosure in EVIDENCE.md (heading=${hasHeading}, missingSensitive=${missingSensitive.join(',') || 'none'}, missingVerification=${missingVerification.join(',') || 'none'})`
    );
  } else {
    addCheck('sensitive_scope_disclosed', true, 'No sensitive or verification paths in changed-files.txt');
  }

  // 2b. Every spec goes through the sandbox fixture (always enforced)
  const directImports = await findDirectPlaywrightImports(path.resolve(process.env.TESTS_DIR || './tests'));
  addCheck(
    'specs_use_sandbox_fixture',
    directImports.length === 0,
    directImports.length === 0
      ? 'All specs import test from scripts/sandbox.mjs (reset + network fence active)'
      : `Specs import Playwright directly and bypass the sandbox fixture: ${directImports.join(', ')}`
  );

  // 3. Anti-fake-green check: ALWAYS disallow skipped/cancelled/todo tests
  const testIssues = await auditRawTestOutputs(outDir, {
    requireResults: enforceFullMediaGate,
    failOnFailures: enforceFullMediaGate,
  });
  addCheck(
    'no_skipped_or_error_tests',
    testIssues.length === 0,
    testIssues.length === 0
      ? 'All unit and Playwright E2E checks executed cleanly with 0 skipped/cancelled/error cases'
      : testIssues.join('; ')
  );

  if (enforceFullMediaGate) {
    // 4. Exactly 1 proof MP4 AND 0 raw .webm files ANYWHERE in the uploaded artifacts tree
    const videoEntries = await listDirSafe(videosDir);
    const mp4Files = videoEntries.filter((f) => f.endsWith('.mp4'));
    const allWebmFiles = await findFilesByExtRecursive(outDir, '.webm');

    const singleMp4Ok = mp4Files.length === 1 && allWebmFiles.length === 0;
    addCheck(
      'single_proof_mp4_no_webm_anywhere',
      singleMp4Ok,
      singleMp4Ok
        ? `Exactly 1 proof MP4 (${mp4Files[0]}), 0 raw .webm files across entire artifacts tree`
        : `Expected 1 .mp4 in videos/ and 0 .webm anywhere (mp4=${mp4Files.join(',') || 'none'}, webm=${allWebmFiles.join(',') || 'none'})`
    );

    // 5. Codec/pixel-format guard via direct ffprobe inspection
    let mp4Meta = null;
    if (mp4Files.length === 1) {
      const mp4Path = path.join(videosDir, mp4Files[0]);
      try {
        mp4Meta = await probeMedia(mp4Path);
        const codecOk = mp4Meta.codec === 'h264' && mp4Meta.pixFmt === 'yuv420p';
        addCheck(
          'video_codec_h264',
          codecOk,
          codecOk
            ? `H.264 / yuv420p (${mp4Meta.width}x${mp4Meta.height}, ${mp4Meta.durationSeconds}s, ${mp4Meta.sizeBytes} bytes)`
            : `Expected h264/yuv420p for Safari/iOS/Slack compatibility, got ${mp4Meta.codec}/${mp4Meta.pixFmt}`
        );
      } catch (err) {
        addCheck('video_codec_h264', false, `ffprobe failed on ${mp4Files[0]}: ${err.message}`);
      }
    } else {
      addCheck('video_codec_h264', false, 'No single .mp4 proof video available to probe');
    }

    // 6. Step-pacing readability guard (governs per-step readability & resting hold instead of rigid total seconds)
    const pacingIssues = [];
    let stepList = [];
    if (mp4Meta) {
      if (mp4Meta.durationSeconds < minSanitySeconds || mp4Meta.durationSeconds > maxSanitySeconds) {
        pacingIssues.push(
          `Video duration ${mp4Meta.durationSeconds}s outside sanity bounds [${minSanitySeconds}s, ${maxSanitySeconds}s]`
        );
      }
    } else {
      pacingIssues.push('No probed MP4 duration available');
    }

    if (await statSafe(proofStepsPath)) {
      try {
        const parsedSteps = JSON.parse(await fs.readFile(proofStepsPath, 'utf-8'));
        stepList = Array.isArray(parsedSteps.steps) ? parsedSteps.steps : [];
        if (stepList.length === 0) {
          pacingIssues.push('proof-steps.json contains 0 recorded steps');
        }
        for (const s of stepList) {
          const lead = Number(s.leadInSeconds || 0);
          const dur = Number(s.durationSeconds || 0);
          const hold = Number(s.endHoldSeconds || 0);
          if (s.minActionGapSeconds != null && Number(s.minActionGapSeconds) < minActionGapSeconds) {
            pacingIssues.push(`Step ${s.step} actions too close together (${s.minActionGapSeconds}s < ${minActionGapSeconds}s)`);
          }
          if (lead < minStepLeadSeconds) {
            pacingIssues.push(`Step ${s.step} banner lead-in too fast (${lead}s < ${minStepLeadSeconds}s)`);
          }
          if (dur < minStepSeconds) {
            pacingIssues.push(`Step ${s.step} too fast (${dur}s < ${minStepSeconds}s)`);
          }
          if (hold < minStepHoldSeconds) {
            pacingIssues.push(`Step ${s.step} end-state hold too short (${hold}s < ${minStepHoldSeconds}s)`);
          }
        }
      } catch (err) {
        pacingIssues.push(`Invalid proof-steps.json: ${err.message}`);
      }
    } else {
      pacingIssues.push('Missing proof-steps.json (per-step pacing timestamps required)');
    }

    const minObservedLead = stepList.length ? Math.min(...stepList.map((s) => Number(s.leadInSeconds || 0))) : 0;
    const minObservedStep = stepList.length ? Math.min(...stepList.map((s) => Number(s.durationSeconds || 0))) : 0;
    const actionGaps = stepList.map((s) => s.minActionGapSeconds).filter((g) => g != null).map(Number);
    const minObservedGap = actionGaps.length ? Math.min(...actionGaps) : 'n/a';
    const minObservedHold = stepList.length ? Math.min(...stepList.map((s) => Number(s.endHoldSeconds || 0))) : 0;
    addCheck(
      'step_pacing_readable',
      pacingIssues.length === 0,
      pacingIssues.length === 0
        ? `${stepList.length} paced steps (min lead ${minObservedLead}s >= ${minStepLeadSeconds}s, min action gap ${minObservedGap}s >= ${minActionGapSeconds}s, min step ${minObservedStep}s >= ${minStepSeconds}s, min end hold ${minObservedHold}s >= ${minStepHoldSeconds}s, total ${mp4Meta.durationSeconds}s)`
        : pacingIssues.join('; ')
    );

    // 7. Inline preview quality: smooth high-res GIF (>=10fps, >=800px) + full-res (>=1000px) step screenshots embedded
    const previewIssues = [];
    const gifPath = path.join(previewDir, 'proof-preview.gif');
    const gifStat = await statSafe(gifPath);
    let gifMeta = null;
    if (!gifStat || gifStat.size === 0) {
      previewIssues.push('Missing or empty preview/proof-preview.gif');
    } else {
      if (gifStat.size > maxGifBytes) {
        previewIssues.push(`preview/proof-preview.gif too large (${gifStat.size} B > ${maxGifBytes} B)`);
      }
      try {
        gifMeta = await probeMedia(gifPath);
        if (gifMeta.fps < minGifFps) {
          previewIssues.push(`GIF too choppy (${gifMeta.fps} fps < ${minGifFps} fps)`);
        }
        if (gifMeta.width < minGifWidth) {
          previewIssues.push(`GIF too narrow (${gifMeta.width}px < ${minGifWidth}px)`);
        }
      } catch (err) {
        previewIssues.push(`ffprobe failed on proof-preview.gif: ${err.message}`);
      }
    }

    if (!reportText.includes('(preview/proof-preview.gif)') || !reportText.includes('(videos/proof.mp4)')) {
      previewIssues.push('EVIDENCE.md must embed preview/proof-preview.gif and link videos/proof.mp4');
    }

    if (stepList.length === 0) {
      previewIssues.push('No step screenshots listed in proof-steps.json');
    } else {
      for (const s of stepList) {
        const shotRel = String(s.screenshot || '');
        const shotFull = path.join(outDir, shotRel);
        const shotStat = await statSafe(shotFull);
        if (!shotStat || shotStat.size === 0) {
          previewIssues.push(`Missing step screenshot ${shotRel}`);
          continue;
        }
        try {
          const shotMeta = await probeMedia(shotFull);
          if (shotMeta.width < minShotWidth) {
            previewIssues.push(`${shotRel} too low-res for zoom (${shotMeta.width}px < ${minShotWidth}px)`);
          }
        } catch (err) {
          previewIssues.push(`ffprobe failed on ${shotRel}: ${err.message}`);
        }
        if (!reportText.includes(`(${shotRel})`)) {
          previewIssues.push(`EVIDENCE.md does not embed ${shotRel}`);
        }
      }
    }

    addCheck(
      'inline_preview_quality',
      previewIssues.length === 0,
      previewIssues.length === 0
        ? `GIF ${gifMeta.width}x${gifMeta.height} @ ${gifMeta.fps}fps (${gifStat.size} B) + ${stepList.length} full-res (>=${minShotWidth}px) step screenshots + direct MP4 link embedded`
        : previewIssues.join('; ')
    );
  }

  const allOk = checks.every((c) => c.ok);
  const mode = enforceFullMediaGate ? 'strict' : 'test-failure-diagnostic';
  const result = { ok: allOk, mode, checks };

  await fs.writeFile(gateOutPath, JSON.stringify(result, null, 2), 'utf-8');

  for (const check of checks) {
    const tag = check.ok ? '[QUALITY-GATE PASS]' : '[QUALITY-GATE FAIL]';
    console.log(`${tag} ${check.id}: ${check.detail}`);
  }

  if (!allOk) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[QUALITY-GATE ERROR]', err);
  process.exit(1);
});
