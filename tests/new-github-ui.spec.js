// End-to-end proof for the new (2025-2026) GitHub PR UI, where the whole
// Overview/Files page is a Primer React app:
//
//   * there is no `#new_comment_field`, no `.js-new-comment-form`, no
//     `.js-discussion` and no `.container-xl` — the composer is a bare
//     `form[aria-label="Add comment form"]` with a placeholder-only textarea;
//   * the Files tab URL is `/changes` (not `/files`) and the review form is a
//     slide-over `div[role="dialog"][aria-modal="true"]` titled
//     "Finish your review" with none of the legacy IDs;
//   * checks live in expandable `[role="group"]`s under the Merge status card
//     as `[role="listitem"]` rows, with inline status text instead of Primer
//     octicon classes.
//
// These fixtures reproduce that DOM for a real PR URL so the extension runs
// its normal content-script path. They pin the "usual places" a user submits
// review comments: the Overview composer and the review drawer.
const { test, expect, chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

const EXTENSION_PATH = path.resolve(__dirname, '..');
const OVERVIEW_URL = 'https://github.com/velero-io/velero/pull/10834';
const CHANGES_URL = 'https://github.com/velero-io/velero/pull/10834/changes';

const OVERVIEW_HTML = fs.readFileSync(path.join(__dirname, 'fixtures', 'pr-new-overview.html'), 'utf8');
const CHANGES_HTML = fs.readFileSync(path.join(__dirname, 'fixtures', 'pr-new-changes.html'), 'utf8');

async function launchWithExtension() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghbcp-new-ui-'));
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

test('self-hosted update chain: Chromium gives the fixed ID that updates.xml advertises', async () => {
  test.setTimeout(120000);
  const { context } = await launchWithExtension();
  try {
    const page = await context.newPage();
    await page.route(OVERVIEW_URL, route => route.fulfill({
      status: 200, contentType: 'text/html; charset=utf-8', body: OVERVIEW_HTML,
    }));
    await page.goto(OVERVIEW_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // The service worker URL carries the extension ID Chrome derived. With the
    // committed "key" this must be the same on every machine, and equal to the
    // appid in updates.xml — otherwise chromium-web-store never matches.
    let sw = context.serviceWorkers()[0];
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 30000 });
    const installedId = new URL(sw.url()).host;

    const expected = fs.readFileSync(path.join(__dirname, '..', 'updates.xml'), 'utf8')
      .match(/appid='([^']+)'/)[1];
    expect(installedId).toBe(expected);

    const manifest = await sw.evaluate(() => chrome.runtime.getManifest());
    expect(manifest.update_url).toBe(
      'https://raw.githubusercontent.com/kaovilai/github-bot-command-palette/main/updates.xml'
    );
    const xml = fs.readFileSync(path.join(__dirname, '..', 'updates.xml'), 'utf8');
    // Scope to <updatecheck>: the <?xml version='1.0'?> declaration would
    // otherwise match /version='...'/.
    const updatecheck = /<updatecheck\b[^>]*>/.exec(xml)[0];
    expect(manifest.version).toBe(updatecheck.match(/version='([^']+)'/)[1]);
  } finally {
    await context.close();
  }
});

test('new Overview: command bar tracks the Primer React comment composer', async () => {
  test.setTimeout(120000);
  const { context } = await launchWithExtension();
  try {
    const page = await context.newPage();
    await page.route(OVERVIEW_URL, route => route.fulfill({
      status: 200, contentType: 'text/html; charset=utf-8', body: OVERVIEW_HTML,
    }));
    await page.goto(OVERVIEW_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const bar = page.locator('.ghbcp-command-bar');
    await expect(bar).toBeVisible({ timeout: 60000 });

    // The bar must sit in the Comments panel, directly above the composer
    // form — not dumped at the top of <body> (the old fallback) and not
    // nested inside the form (where Enter/submit semantics live).
    const placement = await page.evaluate(() => {
      const b = document.querySelector('.ghbcp-command-bar');
      const form = document.querySelector('form[aria-label="Add comment form"]');
      if (!b || !form) return null;
      const section = form.closest('section');
      return {
        inSection: !!section && section.contains(b),
        precedesForm: !!(b.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING),
        insideForm: !!b.closest('form'),
      };
    });
    expect(placement).toEqual({ inSection: true, precedesForm: true, insideForm: false });

    // Clicking a command must fill the placeholder-only textarea.
    await bar.locator('button', { hasText: 'lgtm' }).first().click();
    await expect(page.locator('textarea[placeholder="Leave a comment"]')).toHaveValue(/\/lgtm/);
  } finally {
    await context.close();
  }
});

test('new Overview: per-check controls appear on grouped Merge status rows', async () => {
  test.setTimeout(120000);
  const { context } = await launchWithExtension();
  try {
    const page = await context.newPage();
    await page.route(OVERVIEW_URL, route => route.fulfill({
      status: 200, contentType: 'text/html; charset=utf-8', body: OVERVIEW_HTML,
    }));
    await page.goto(OVERVIEW_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await expect(page.locator('.ghbcp-command-bar')).toBeVisible({ timeout: 60000 });

    const prowRow = page.locator('[role="listitem"]', { hasText: 'ci/prow/unit-test' }).first();
    await expect(prowRow.locator('.ghbcp-check-btns')).toHaveCount(1, { timeout: 30000 });
    await expect(prowRow.locator('.ghbcp-check-btns button', { hasText: 'Test' })).toBeVisible();

    // tide is a meta-status, never gets controls.
    const tideRow = page.locator('[role="listitem"]', { hasText: 'tide' }).first();
    await expect(tideRow.locator('.ghbcp-check-btns')).toHaveCount(0);

    // A native Actions check (name has no "ci/", link is /actions/runs/…/job/…)
    // must still get a Rerun/Override control.
    const actionsRow = page.locator('[role="listitem"]', { hasText: 'unit-tests' }).first();
    await expect(actionsRow.locator('.ghbcp-check-btns')).toHaveCount(1, { timeout: 30000 });

    // Passing checks stay clean under the default failed-only filter.
    const passedRow = page.locator('[role="listitem"]', { hasText: 'ci/pipeline-gate' }).first();
    await expect(passedRow.locator('.ghbcp-check-btns')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('new Changes: review drawer gets the command bar', async () => {
  test.setTimeout(180000);
  const { context } = await launchWithExtension();
  try {
    const page = await context.newPage();
    await page.route(OVERVIEW_URL, route => route.fulfill({
      status: 200, contentType: 'text/html; charset=utf-8', body: OVERVIEW_HTML,
    }));
    await page.route(CHANGES_URL, route => route.fulfill({
      status: 200, contentType: 'text/html; charset=utf-8', body: CHANGES_HTML,
    }));

    // Real flow: land on the Overview (where Prow evidence exists), then go
    // to the Files tab. The Changes page renders no check rows or labels, so
    // without sticky Prow detection the /lgtm + /approve profile would be
    // filtered out exactly when the review drawer needs it.
    await page.goto(OVERVIEW_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await expect(page.locator('.ghbcp-command-bar')).toBeVisible({ timeout: 60000 });

    await page.goto(CHANGES_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const dialog = page.locator('div[role="dialog"][aria-modal="true"]');
    await expect(dialog).toBeVisible({ timeout: 30000 });

    // A bot-command surface must exist inside the drawer that owns the
    // review textarea.
    const drawerBar = dialog.locator('.ghbcp-command-bar, .ghbcp-review-toolbar');
    await expect(drawerBar.first()).toBeVisible({ timeout: 60000 });

    // Exactly one bot surface in the drawer — the compact review toolbar must
    // not stack on top of the dialog's full command bar.
    await expect(dialog.locator('.ghbcp-command-bar')).toHaveCount(1);
    await expect(dialog.locator('.ghbcp-review-toolbar')).toHaveCount(0);

    // No stray bar dumped at the top of the document.
    const bodyChild = await page.evaluate(() => {
      const first = document.body.firstElementChild;
      return !!(first && first.classList && first.classList.contains('ghbcp-command-bar'));
    });
    expect(bodyChild).toBe(false);

    // /lgtm must survive the navigation (sticky Prow detection) and the click
    // must fill the drawer's textarea.
    const lgtm = dialog.locator('.ghbcp-command-bar button', { hasText: 'LGTM' }).first();
    await expect(lgtm).toBeVisible({ timeout: 15000 });
    await lgtm.click();
    await expect(dialog.locator('textarea')).toHaveValue(/\/lgtm/);
  } finally {
    await context.close();
  }
});
