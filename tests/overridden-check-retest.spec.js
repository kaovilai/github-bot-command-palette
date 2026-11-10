// End-to-end proof for previously /override'd checks.
//
// Prow's override plugin rewrites a failed status context to SUCCESS with the
// description "Overridden by <login>", so GitHub renders the row green. That
// used to make the job indistinguishable from a genuine pass: hidden by the
// default failed-only filter and buried in the Test picker. These assertions
// pin the two affordances that make such a job easy to run again once the
// base branch carries the fix:
//   1. the inline button on the check row says Retest (no second Override);
//   2. the Test picker badges/highlights the job and ranks it above a clean
//      pass, and both the badge and the order follow live DOM changes.
// The fixture reproduces the modern checks DOM. The test forces the picker's
// scrape fallback (presubmit source pointed at a nonexistent repo) so job
// order is the fixture's deterministic order, not whatever the real Prow
// YAML happens to list first.
const { test, expect, chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

const EXTENSION_PATH = path.resolve(__dirname, '..');
const PR_URL = 'https://github.com/openshift/oadp-operator/pull/2493';
const OVERRIDDEN_CHECK = 'ci/prow/5.0-virt-kdm-e2e-test-aws';
const PASSED_CHECK = 'ci/prow/5.0-e2e-test-aws';

const FIXTURE_HTML = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'pr-with-overridden-check.html'),
  'utf8'
);

async function launchWithExtension() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghbcp-overridden-'));
  const headed = !!process.env.DISPLAY;
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: !headed,
    ...(headed ? {} : { channel: 'chromium' }),
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });
  return { context, userDataDir };
}

/**
 * Point the presubmit lookup at a repo that does not exist and drop the cache,
 * so the picker falls back to scrapeCheckNames() and its order is the
 * fixture's. The extension's config lives in the service worker's storage.
 */
async function forceScrapeFallback(context) {
  let sw = context.serviceWorkers()[0];
  if (!sw) {
    const trigger = await context.newPage();
    await trigger.goto('https://github.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await trigger.waitForTimeout(1000);
    sw = context.serviceWorkers()[0];
    await trigger.close();
  }
  expect(sw).toBeTruthy();
  await sw.evaluate(async () => {
    const key = 'ghbcp_config';
    const stored = await chrome.storage.sync.get(key);
    const cfg = stored[key] || {};
    cfg.pluginConfigSources = [{
      name: 'offline (test)',
      enabled: true,
      configRepo: 'kaovilai/ghbcp-no-such-repo',
      branch: 'main',
      presubmitsBasePath: 'ci-operator/jobs',
      cacheTTLMinutes: 0,
    }];
    await chrome.storage.sync.set({ [key]: cfg });
    await chrome.storage.local.remove('ghbcp_presubmits_cache');
  });
}

test('overridden check: inline Retest fills /test and the picker badges it', async () => {
  test.setTimeout(180000);
  const { context, userDataDir } = await launchWithExtension();
  try {
    const page = await context.newPage();
    await page.route(PR_URL, route => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: FIXTURE_HTML,
    }));
    await page.goto(PR_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // First load seeds the default config (and its command bar).
    await expect(page.locator('.ghbcp-command-bar')).toBeVisible({ timeout: 60000 });

    await forceScrapeFallback(context);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await expect(page.locator('.ghbcp-command-bar')).toBeVisible({ timeout: 60000 });

    // The row's own context with the override marker removed.
    const CLEAN_LABEL = OVERRIDDEN_CHECK;
    // Rewrite the overridden row in place. Name-based lookup because the
    // aria-label itself is one of the mutated values. `null` leaves a field
    // untouched, so a step can change exactly one detection input.
    const setOverriddenRow = (description, ariaLabel) => page.evaluate(([text, label]) => {
      const row = [...document.querySelectorAll('section[aria-label="Checks"] li')]
        .find(li => {
          const name = li.querySelector('h4 a span');
          return name && name.textContent.trim() === 'ci/prow/5.0-virt-kdm-e2e-test-aws';
        });
      const desc = row.querySelector('span[class*="titleDescription"]');
      if (text !== null) desc.textContent = text;
      if (label !== null) row.setAttribute('aria-label', label);
    }, [description, ariaLabel]);
    const rowByName = page.locator('section[aria-label="Checks"] li', { hasText: OVERRIDDEN_CHECK });

    // ── 1. Inline row buttons ──────────────────────────────────────────────
    // The overridden row is green, yet must still get a Retest button because
    // the underlying job failed; a second Override makes no sense.
    const overriddenRow = page.locator(`li[aria-label^="${OVERRIDDEN_CHECK}"]`).first();
    const retestBtn = overriddenRow.locator('.ghbcp-check-btns button', { hasText: 'Retest' });
    await expect(retestBtn).toBeVisible({ timeout: 30000 });
    await expect(overriddenRow.locator('.ghbcp-check-btns button', { hasText: 'Override' })).toHaveCount(0);

    // A genuine pass gets no buttons at all (default failed-only filter).
    const passedRow = page.locator(`li[aria-label="${PASSED_CHECK}"]`).first();
    await expect(passedRow.locator('.ghbcp-check-btns')).toHaveCount(0);

    // ── 1b. Inline controls follow in-place override changes ───────────────
    // A row that stops being overridden becomes a plain pass, so its hidden
    // controls must go away; restoring the marker must bring Retest back —
    // without waiting for a navigation or a full page re-render.
    await setOverriddenRow(' — Job succeeded.', CLEAN_LABEL);
    await expect(rowByName.locator('.ghbcp-check-btns')).toHaveCount(0, { timeout: 10000 });
    await setOverriddenRow(' — Overridden by kaovilai', `${OVERRIDDEN_CHECK} Overridden by kaovilai`);
    await expect(rowByName.locator('.ghbcp-check-btns button', { hasText: 'Retest' }))
      .toBeVisible({ timeout: 10000 });

    // Clicking Retest fills the comment box with /test for that job.
    await retestBtn.click();
    await expect(page.locator('#new_comment_field')).toHaveValue(
      new RegExp(`^/test \\S*${OVERRIDDEN_CHECK.replace(/^ci\/prow\//, '')}\\s*$`),
      { timeout: 10000 }
    );

    // ── 2. Test picker highlight and rank ──────────────────────────────────
    await page.locator('.ghbcp-command-bar button', { hasText: 'Test...' }).click();
    const picker = page.locator('.ghbcp-job-picker');
    await expect(picker).toBeVisible({ timeout: 10000 });

    const overriddenItem = picker.locator('.ghbcp-job-picker-item', { hasText: 'virt-kdm' }).first();
    const passedItem = picker.locator('.ghbcp-job-picker-item', { hasText: '5.0-e2e-test-aws' }).first();
    const badge = overriddenItem.locator('.ghbcp-job-badge-overridden');
    const expectOrder = async (first, second) => {
      expect((await first.boundingBox()).y).toBeLessThan((await second.boundingBox()).y);
    };

    await expect(overriddenItem).toHaveClass(/ghbcp-job-picker-item-overridden/);
    await expect(badge).toHaveText('Overridden');
    await expect(badge).toHaveAttribute('title', /Overridden by kaovilai/);
    // The genuine pass carries no badge, so the highlight is specific.
    await expect(passedItem.locator('.ghbcp-job-badge-overridden')).toHaveCount(0);
    // Overridden ranks above the clean pass even though the fixture lists the
    // clean pass first — this is the override ranking, not source order.
    await expectOrder(overriddenItem, passedItem);

    // ── 3. Live refresh while the picker is open ───────────────────────────
    // Prow re-renders check rows in place. Every override-detection input can
    // change independently, so the observer must cover childList (textContent
    // replacement), characterData (text node rewritten in place) and the
    // title/aria-label attributes. Each step changes exactly one input and
    // asserts the resulting badge *and* rank, so a stale paint cannot pass.

    // Override removed → badge gone and the clean pass (listed first in the
    // fixture) now ranks above it.
    await setOverriddenRow(' — Job succeeded.', CLEAN_LABEL);
    await expect(badge).toHaveCount(0, { timeout: 5000 });
    await expectOrder(passedItem, overriddenItem);

    // Description text node rewritten in place (characterData only, no
    // attribute or child-list change) → badge and rank come back.
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('section[aria-label="Checks"] li')]
        .find(li => {
          const name = li.querySelector('h4 a span');
          return name && name.textContent.trim() === 'ci/prow/5.0-virt-kdm-e2e-test-aws';
        });
      row.querySelector('span[class*="titleDescription"]').lastChild.nodeValue = ' — Overridden by kaovilai';
    });
    await expect(badge).toBeVisible({ timeout: 5000 });
    await expectOrder(overriddenItem, passedItem);

    // Confirm the badge is gone again before the attribute-only step, so the
    // following assertion cannot be satisfied by the previous badge.
    await setOverriddenRow(' — Job succeeded.', CLEAN_LABEL);
    await expect(badge).toHaveCount(0, { timeout: 5000 });
    await expectOrder(passedItem, overriddenItem);

    // Only aria-label changes now (third detection fallback) → badge returns
    // and the override ranking applies again.
    await page.evaluate((label) => {
      [...document.querySelectorAll('section[aria-label="Checks"] li')]
        .find(li => {
          const name = li.querySelector('h4 a span');
          return name && name.textContent.trim() === 'ci/prow/5.0-virt-kdm-e2e-test-aws';
        })
        .setAttribute('aria-label', label);
    }, `${OVERRIDDEN_CHECK} Overridden by kaovilai`);
    await expect(badge).toBeVisible({ timeout: 5000 });
    await expectOrder(overriddenItem, passedItem);
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
