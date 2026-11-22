// managed by glass-factory kit v1.2.0 (8b5ada6), do not edit; change factory/evidence.config.sh or factory/evidence/tests/
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Human-readable Playwright proof session (Level 1 Evidence Mode).
 * - Enforces readable per-step pacing & end-state resting pauses (instead of arbitrary total duration)
 * - Uses genuine character-by-character typing (`pressSequentially`) and clear click rings
 * - Records `trimStartSeconds` after initial data loads so frame 1 never flashes an empty 0/0/0 state
 * - Captures full-resolution (1280x720) result screenshots & writes `proof-steps.json` for quality-gate.mjs
 */

// Viewer pacing inside a step: ring shown before each action, pause after it so the result can be read.
export const HIGHLIGHT_MS = 700;
export const ACTION_PAUSE_MS = 1000;

// Start/end time of every visible action, so finishStep can report the shortest gap between actions.
const actionLog = [];

async function trackAction(fn) {
  const start = Date.now();
  await fn();
  actionLog.push({ start, end: Date.now() });
}

export async function showStepBanner(page, stepLabel, description) {
  await page.evaluate(
    ({ stepLabel: label, description: desc }) => {
      let el = document.getElementById('factory-proof-banner');
      if (!el) {
        el = document.createElement('div');
        el.id = 'factory-proof-banner';
        el.setAttribute('data-factory-overlay', 'true');
        Object.assign(el.style, {
          position: 'fixed',
          left: '50%',
          top: '12px',
          transform: 'translateX(-50%)',
          zIndex: '2147483647',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '8px 18px',
          borderRadius: '999px',
          background: 'rgba(15, 23, 42, 0.96)',
          border: '2px solid rgba(56, 189, 248, 0.85)',
          boxShadow: '0 12px 32px rgba(0, 0, 0, 0.55)',
          color: '#f8fafc',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: '17px',
          fontWeight: '600',
          letterSpacing: '0.01em',
          pointerEvents: 'none',
          maxWidth: '94vw',
          whiteSpace: 'nowrap',
        });
        document.body.appendChild(el);
        // Reserve a caption strip so the banner never covers page content.
        document.documentElement.style.paddingTop = '64px';
      }

      el.replaceChildren();
      const badge = document.createElement('span');
      badge.textContent = label;
      Object.assign(badge.style, {
        background: '#0284c7',
        color: '#ffffff',
        padding: '4px 12px',
        borderRadius: '999px',
        fontSize: '14px',
        fontWeight: '800',
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
      });

      const text = document.createElement('span');
      text.textContent = desc;

      el.appendChild(badge);
      el.appendChild(text);
    },
    { stepLabel, description }
  );
}

export async function highlightLocator(page, locator, holdMs = HIGHLIGHT_MS) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) return;

  await page.evaluate(
    ({ x, y, width, height }) => {
      let ring = document.getElementById('factory-proof-ring');
      if (!ring) {
        ring = document.createElement('div');
        ring.id = 'factory-proof-ring';
        ring.setAttribute('data-factory-overlay', 'true');
        Object.assign(ring.style, {
          position: 'fixed',
          zIndex: '2147483646',
          border: '3px solid #38bdf8',
          borderRadius: '10px',
          background: 'rgba(56, 189, 248, 0.16)',
          boxShadow: '0 0 0 5px rgba(56, 189, 248, 0.28)',
          pointerEvents: 'none',
          transition: 'all 120ms ease-out',
        });
        document.body.appendChild(ring);
      }
      ring.style.left = `${Math.max(0, x - 5)}px`;
      ring.style.top = `${Math.max(0, y - 5)}px`;
      ring.style.width = `${width + 10}px`;
      ring.style.height = `${height + 10}px`;
      ring.style.opacity = '1';
    },
    box
  );

  await page.waitForTimeout(holdMs);

  await page.evaluate(() => {
    const ring = document.getElementById('factory-proof-ring');
    if (ring) ring.style.opacity = '0';
  });
}

export async function highlightAndClick(page, locator, { holdBeforeMs = HIGHLIGHT_MS, holdAfterMs = ACTION_PAUSE_MS } = {}) {
  await trackAction(async () => {
    await highlightLocator(page, locator, holdBeforeMs);
    await locator.click();
  });
  await page.waitForTimeout(holdAfterMs);
}

export async function highlightAndSelect(page, locator, value, { holdBeforeMs = HIGHLIGHT_MS, holdAfterMs = ACTION_PAUSE_MS } = {}) {
  await trackAction(async () => {
    await highlightLocator(page, locator, holdBeforeMs);
    await locator.selectOption(value);
  });
  await page.waitForTimeout(holdAfterMs);
}

export async function humanType(page, locator, value, { charDelayMs = 32, holdAfterMs = ACTION_PAUSE_MS } = {}) {
  await trackAction(async () => {
    await highlightLocator(page, locator);
    await locator.click();
    await locator.fill('');
    await locator.pressSequentially(value, { delay: charDelayMs });
  });
  await page.waitForTimeout(holdAfterMs);
}

export function createProofSession(page, { outDir, screenshotDir }) {
  const sessionStartMs = Date.now();
  let trimStartSeconds = 0;
  let activeStep = null;
  const completedSteps = [];
  actionLog.length = 0;

  return {
    /**
     * Call once after initial seeded data has finished loading so pre-load 0/0/0 frames are trimmed.
     */
    markReady() {
      const elapsedMs = Math.max(0, Date.now() - sessionStartMs - 80);
      trimStartSeconds = Number((elapsedMs / 1000).toFixed(2));
    },

    async beginStep(stepNumber, totalSteps, title, { leadInMs = 1000 } = {}) {
      const startedAtMs = Date.now();
      await showStepBanner(page, `Step ${stepNumber}/${totalSteps}`, title);
      if (leadInMs > 0) {
        await page.waitForTimeout(leadInMs);
      }
      const actualLeadMs = Date.now() - startedAtMs;
      activeStep = {
        step: stepNumber,
        total: totalSteps,
        title,
        startedAtMs,
        leadInSeconds: Number((actualLeadMs / 1000).toFixed(2)),
      };
    },

    async refreshBanner() {
      if (!activeStep) return;
      await showStepBanner(page, `Step ${activeStep.step}/${activeStep.total}`, activeStep.title);
    },

    async finishStep({ screenshotFile, assertion, minStepMs = 3000, holdEndMs = 1800 }) {
      if (!activeStep) {
        throw new Error('finishStep called without an active step');
      }

      const holdStartMs = Date.now();
      await page.waitForTimeout(holdEndMs);

      const elapsedSoFar = Date.now() - activeStep.startedAtMs;
      if (elapsedSoFar < minStepMs) {
        await page.waitForTimeout(minStepMs - elapsedSoFar);
      }

      const endHoldMs = Date.now() - holdStartMs;
      const totalStepMs = Date.now() - activeStep.startedAtMs;

      const stepActions = actionLog.filter((a) => a.start >= activeStep.startedAtMs);
      const actionGapsMs = stepActions.slice(1).map((a, i) => a.start - stepActions[i].end);
      const minActionGapSeconds = actionGapsMs.length
        ? Number((Math.min(...actionGapsMs) / 1000).toFixed(2))
        : null;

      await fs.mkdir(screenshotDir, { recursive: true });
      await page.screenshot({
        path: path.join(screenshotDir, screenshotFile),
        fullPage: true,
      });

      completedSteps.push({
        step: activeStep.step,
        total: activeStep.total,
        title: activeStep.title,
        assertion,
        screenshot: `screenshots/${screenshotFile}`,
        leadInSeconds: activeStep.leadInSeconds,
        actionCount: stepActions.length,
        minActionGapSeconds,
        durationSeconds: Number((totalStepMs / 1000).toFixed(2)),
        endHoldSeconds: Number((endHoldMs / 1000).toFixed(2)),
      });
      activeStep = null;
    },

    async saveMetadata() {
      const payload = {
        trimStartSeconds,
        steps: completedSteps,
      };
      await fs.writeFile(
        path.join(outDir, 'proof-steps.json'),
        JSON.stringify(payload, null, 2),
        'utf-8'
      );
      return payload;
    },
  };
}
