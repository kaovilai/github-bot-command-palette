// End-to-end proof for previously /override'd checks.
//
// Prow's override plugin rewrites a failed status context to SUCCESS with the
// description "Overridden by <login>", so GitHub renders the row green. That
// used to make the job indistinguishable from a genuine pass: hidden by the
// default failed-only filter and buried in the Test picker. These assertions
// pin the two affordances that make such a job easy to run again once the
// base branch carries the fix:
//   1. the inline button on the check row says Retest (no second Override);
//   2. the Test picker badges/highlights the job.
// The fixture reproduces the modern checks DOM; the extension runs its normal
// content-script path (background presubmit lookups may fail offline, in which
// case the picker falls back to the same scraped rows).
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

test('overridden check: inline Retest fills /test and the picker badges it', async () => {
  test.setTimeout(120000);
  const { context, userDataDir } = await launchWithExtension();
  try {
    const page = await context.newPage();
    await page.route(PR_URL, route => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: FIXTURE_HTML,
    }));
    await page.goto(PR_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

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

    // Clicking Retest fills the comment box with /test for that job.
    await retestBtn.click();
    await expect(page.locator('#new_comment_field')).toHaveValue(
      new RegExp(`^/test \\S*${OVERRIDDEN_CHECK.replace(/^ci\/prow\//, '')}\\s*$`),
      { timeout: 10000 }
    );

    // ── 2. Test picker highlight ───────────────────────────────────────────
    await page.locator('.ghbcp-command-bar button', { hasText: 'Test...' }).click();
    const picker = page.locator('.ghbcp-job-picker');
    await expect(picker).toBeVisible({ timeout: 10000 });

    const overriddenItem = picker.locator('.ghbcp-job-picker-item', { hasText: 'virt-kdm' }).first();
    await expect(overriddenItem).toHaveClass(/ghbcp-job-picker-item-overridden/);
    const badge = overriddenItem.locator('.ghbcp-job-badge-overridden');
    await expect(badge).toHaveText('Overridden');
    await expect(badge).toHaveAttribute('title', /Overridden by kaovilai/);

    // The genuine pass carries no badge, so the highlight is specific.
    const passedItem = picker.locator('.ghbcp-job-picker-item', { hasText: '5.0-e2e-test-aws' }).first();
    await expect(passedItem.locator('.ghbcp-job-badge-overridden')).toHaveCount(0);

    // Overridden ranks above genuinely passing jobs, so it sits earlier in
    // the list than the clean pass.
    const overriddenBox = await overriddenItem.boundingBox();
    const passedBox = await passedItem.boundingBox();
    expect(overriddenBox.y).toBeLessThan(passedBox.y);

    // ── 3. Live refresh while the picker is open ───────────────────────────
    // Prow re-renders check rows in place. Every override-detection input can
    // change independently, so the observer must cover childList (textContent
    // replacement), characterData (text node rewritten in place) and the
    // title/aria-label attributes. Each step below changes exactly one input
    // that the picker's badge depends on.
    const setRow = (description, ariaLabel) => page.evaluate(([text, label]) => {
      const row = document.querySelector('li[aria-label^="ci/prow/5.0-virt-kdm-e2e-test-aws"]');
      row.querySelector('span[class*="titleDescription"]').textContent = text;
      row.setAttribute('aria-label', label);
    }, [description, ariaLabel]);

    // Override removed → badge and highlight disappear.
    await setRow(' — Job succeeded.', 'ci/prow/5.0-virt-kdm-e2e-test-aws');
    await expect(badge).toHaveCount(0, { timeout: 5000 });

    // Description text node rewritten in place (characterData only, no
    // attribute or child-list change) → badge comes back.
    await page.evaluate(() => {
      const row = document.querySelector('li[aria-label^="ci/prow/5.0-virt-kdm-e2e-test-aws"]');
      row.querySelector('span[class*="titleDescription"]').lastChild.nodeValue = ' — Overridden by kaovilai';
    });
    await expect(badge).toBeVisible({ timeout: 5000 });

    // Description no longer carries the marker; only the row's aria-label
    // does (the third detection fallback) → badge stays correct.
    await setRow(' — Job succeeded.', 'ci/prow/5.0-virt-kdm-e2e-test-aws Overridden by kaovilai');
    await expect(badge).toBeVisible({ timeout: 5000 });
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
