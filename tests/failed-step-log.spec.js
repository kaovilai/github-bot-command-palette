// End-to-end check of the failed-check "view log" icon: hover preview and
// click modal, including the Claude failure-analysis report produced by the
// oadp analyze-e2e-failure step.
//
// The GitHub mergebox "Checks" section only renders for logged-in users, so
// the default test serves a fixture that reproduces that DOM (see
// tests/fixtures/pr-with-failed-check.html) for the real PR URL. The
// extension then runs its normal content-script + background-worker path and
// fetches the real GCS artifacts for a known failed oadp-operator run.
//
// Set GHBCP_LIVE_PR=1 (with a logged-in .test-profile) to run the same
// assertions against the live PR page instead.
const { test, expect, chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

const EXTENSION_PATH = path.resolve(__dirname, '..');

// openshift/oadp-operator#2493 — open PR whose latest
// pull-ci-openshift-oadp-operator-oadp-dev-5.0-virt-kdm-e2e-test-aws run
// failed; its analyze post-step wrote a failure-analysis.md report.
// If this PR's checks turn green, pick another open PR from
// https://gcs.ci.openshift.org/gcs/test-platform-results-public/pr-logs/pull/openshift_oadp-operator/
// whose newest e2e build has finished.json passed:false.
const PR_URL = 'https://github.com/openshift/oadp-operator/pull/2493';
const FAILED_CHECK = 'ci/prow/5.0-virt-kdm-e2e-test-aws';
const FAILED_STEP_LABEL = 'virt-kdm-e2e-test-aws/e2e/build-log.txt';

const FIXTURE_HTML = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'pr-with-failed-check.html'),
  'utf8'
);

async function launchWithExtension({ persistent = false } = {}) {
  // Fixture tests get a fresh throwaway profile: a reused persistent profile
  // can keep serving a stale cached copy of background.js (missing newly
  // added listeners) and would leak config written by other tests. The live
  // PR test passes `persistent: true` to reuse the logged-in `.test-profile`
  // (its Checks DOM only renders for authenticated users).
  const userDataDir = persistent
    ? path.join(__dirname, '..', '.test-profile')
    : fs.mkdtempSync(path.join(os.tmpdir(), 'ghbcp-log-view-'));
  // Headed when a display exists; otherwise Playwright's new-headless
  // "chromium" channel, which (unlike old headless) still loads extensions.
  const headed = !!process.env.DISPLAY;
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: !headed,
    ...(headed ? {} : { channel: 'chromium' }),
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });
  return { context, userDataDir, persistent };
}

async function closeAndCleanup(context, userDataDir, persistent = false) {
  await context.close();
  // Never delete the shared logged-in profile.
  if (!persistent) fs.rmSync(userDataDir, { recursive: true, force: true });
}

async function assertLogViewWorks(page) {
  // The log icon renders next to the failed check row once the extension
  // scrapes the Checks section — and not next to the passing one.
  const icon = page.locator(`li[aria-label="${FAILED_CHECK}"] .ghbcp-log-icon`).first();
  await expect(icon).toBeVisible({ timeout: 45000 });
  await expect(page.locator('li[aria-label="ci/prow/5.0-e2e-test-aws"] .ghbcp-log-icon')).toHaveCount(0);

  // Hover → tooltip; the preview prefers the Claude failure analysis over
  // the raw log (the report begins "# … Failure Analysis").
  await icon.hover();
  const tooltip = page.locator('.ghbcp-hover-tooltip');
  await expect(tooltip).toBeVisible({ timeout: 10000 });
  await expect(tooltip).toContainText('Failure Analysis', { timeout: 30000 });
  await page.mouse.move(0, 0); // leave the icon, tooltip fades

  // Click → inline, scrollable panel of grep-matched error lines on the page.
  await icon.click();
  // The panel is inserted as its own row directly after the check row.
  const panel = page.locator(`li[aria-label="${FAILED_CHECK}"] + .ghbcp-log-inline-panel`);
  await expect(panel).toBeVisible({ timeout: 10000 });
  const panelTitle = panel.locator('.ghbcp-log-inline-title');
  await expect(panelTitle).toContainText('Failure log errors (', { timeout: 30000 });
  const panelBody = panel.locator('.ghbcp-log-inline-body');
  // Matched lines are rendered as "<line>: <text>".
  await expect(panelBody).toContainText(/^\d+: /m, { timeout: 30000 });
  await expect(panelBody).toContainText(/FAILED|failed|error|Error/);
  // The matched-lines view is capped and scrollable rather than pushing the
  // page down with the full 100 KB+ log.
  const box = await panelBody.evaluate(el => ({
    maxHeight: getComputedStyle(el).maxHeight,
    overflowY: getComputedStyle(el).overflowY
  }));
  expect(box.overflowY).toBe('auto');
  expect(box.maxHeight).not.toBe('none');

  // Clicking the icon again closes the panel (toggle).
  await icon.click();
  await expect(page.locator('.ghbcp-log-inline-panel')).toHaveCount(0);

  // Reopen and check the "Full log" button opens the modal with both the
  // analysis section and the raw step log.
  await icon.click();
  await expect(panel).toBeVisible({ timeout: 10000 });
  await panel.locator('.ghbcp-log-inline-btn', { hasText: 'Full log' }).click();
  const modal = page.locator('.ghbcp-text-modal-body');
  await expect(modal).toBeVisible({ timeout: 10000 });
  await expect(modal).toContainText('━━━ Claude failure analysis', { timeout: 30000 });
  await expect(modal).toContainText(`━━━ ${FAILED_STEP_LABEL}`, { timeout: 30000 });
  await page.locator('.ghbcp-text-modal-close').click();
  await expect(page.locator('.ghbcp-text-modal-overlay')).toHaveCount(0);
}

test('failed check row: hover previews analysis, click opens analysis + step log', async () => {
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
    await assertLogViewWorks(page);
  } finally {
    await closeAndCleanup(context, userDataDir);
  }
});

test('live PR page (needs GHBCP_LIVE_PR=1 and a logged-in profile)', async () => {
  test.skip(!process.env.GHBCP_LIVE_PR, 'set GHBCP_LIVE_PR=1 with a logged-in .test-profile');
  test.setTimeout(180000);
  const { context, userDataDir, persistent } = await launchWithExtension({ persistent: true });
  try {
    const page = await context.newPage();
    await page.goto(PR_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await assertLogViewWorks(page);
  } finally {
    await closeAndCleanup(context, userDataDir, persistent);
  }
});

// Minimal valid config with the opt-in enabled (getConfig fills the rest of
// globalSettings from defaults; the universal profile keeps injection alive).
const LIVE_ENABLED_CONFIG = {
  version: 14,
  profiles: [{
    id: 'profile-test-universal',
    name: 'Universal (test)',
    description: '',
    enabled: true,
    repoPatterns: ['*'],
    globalCommands: [],
    checkCommands: [{ id: 'cmd-retest', label: 'Retest', command: '/retest', style: 'primary' }],
    dynamicCommands: []
  }],
  repoOverrides: [],
  pluginConfigSources: [],
  globalSettings: { enabled: true, liveUpdates: true, showOnlyFailedTests: true, pluginFilterMode: 'disabled' }
};

test('live updates opt-in: a cached logic document overrides grep patterns on the page', async () => {
  // Deterministic proof that refreshLiveLogic() applies overrides: seed the
  // background's live-logic cache with a controlled document (no network) and
  // assert the panel reflects it (custom pattern + cap => exactly one match).
  test.setTimeout(120000);
  const { context, userDataDir } = await launchWithExtension();
  try {
    let sw = context.serviceWorkers()[0];
    if (!sw) {
      const trigger = await context.newPage();
      await trigger.goto('https://github.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await trigger.waitForTimeout(2000);
      sw = context.serviceWorkers()[0];
      await trigger.close();
    }
    expect(sw).toBeTruthy();

    await sw.evaluate(async cfg => {
      await chrome.storage.sync.set({ ghbcp_config: cfg });
      await chrome.storage.local.set({
        ghbcp_live_logic_cache: {
          checkedAt: Date.now(),
          url: 'https://github.tig.pw/github-bot-command-palette/logic.json',
          etag: null,
          logic: { version: 4321, errorLinePatterns: ['FAILED'], maxErrorLines: 10 }
        }
      });
    }, LIVE_ENABLED_CONFIG);

    const page = await context.newPage();
    await page.route(PR_URL, route => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: FIXTURE_HTML,
    }));
    await page.goto(PR_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const icon = page.locator(`li[aria-label="${FAILED_CHECK}"] .ghbcp-log-icon`).first();
    await expect(icon).toBeVisible({ timeout: 45000 });
    await icon.click();
    const panel = page.locator(`li[aria-label="${FAILED_CHECK}"] + .ghbcp-log-inline-panel`);
    await expect(panel).toBeVisible({ timeout: 10000 });
    const title = panel.locator('.ghbcp-log-inline-title');
    await expect(title).toContainText('Failure log errors (', { timeout: 30000 });
    const bodyText = await panel.locator('.ghbcp-log-inline-body').textContent();
    const lines = bodyText.split('\n').filter(Boolean);
    // The custom pattern list replaced the built-in one: every rendered
    // error line matches /FAILED/ (defaults would include ERRO/panic/etc.).
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThanOrEqual(10); // custom cap
    for (const line of lines) expect(line).toMatch(/FAILED/i);
  } finally {
    await closeAndCleanup(context, userDataDir);
  }
});

test('live updates opt-in: background fetches the static-site logic and degrades cleanly', async () => {
  test.setTimeout(120000);
  const { context, userDataDir } = await launchWithExtension();
  try {
    let sw = context.serviceWorkers()[0];
    if (!sw) {
      const trigger = await context.newPage();
      await trigger.goto('https://github.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await trigger.waitForTimeout(2000);
      sw = context.serviceWorkers()[0];
      await trigger.close();
    }
    expect(sw).toBeTruthy();

    // Persist the opt-in before the page loads so inject() sees it.
    await sw.evaluate(cfg => chrome.storage.sync.set({ ghbcp_config: cfg }), LIVE_ENABLED_CONFIG);

    const page = await context.newPage();
    await page.route(PR_URL, route => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: FIXTURE_HTML,
    }));
    await page.goto(PR_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // The extension still injects normally with live updates enabled (the
    // static site is not deployed in this test run, so the fetch 404s and the
    // built-in defaults must keep working).
    await expect(page.locator(`li[aria-label="${FAILED_CHECK}"] .ghbcp-log-icon`)).toBeVisible({ timeout: 45000 });

    // The content script consumed the opt-in without any reload: the
    // background recorded a live-logic attempt for this page load.
    const status = await sw.evaluate(() => new Promise(resolve =>
      chrome.storage.local.get('ghbcp_live_logic_status', r => resolve(r.ghbcp_live_logic_status))
    ));
    expect(status && typeof status.requestedAt).toBe('number');

    // Exercise the real network path through the real message router: the
    // request to the Pages-hosted logic.json must be permitted by
    // host_permissions. The site may be deployed (success) or not yet
    // deployed (graceful error) — both must be well-formed. Deterministic
    // assertion for the failure path lives in the mocked unit tests.
    const extensionId = sw.url().split('/')[2];
    const extPage = await context.newPage();
    await extPage.goto(`chrome-extension://${extensionId}/settings.html`);
    const live = await extPage.evaluate(() =>
      chrome.runtime.sendMessage({ action: 'getLiveLogic', force: true, enabled: true })
    );
    expect(live.enabled).toBe(true);
    if (live.source === 'network' || live.source === 'not-modified' || live.source === 'cache') {
      expect(live.logic && typeof live.logic === 'object').toBe(true);
      expect(typeof live.logic.version).toBe('number');
    } else {
      expect(live.source).toBe('error');
      expect(typeof live.error).toBe('string');
    }
  } finally {
    await closeAndCleanup(context, userDataDir);
  }
});
