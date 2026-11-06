const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const EXTENSION_PATH = path.resolve(__dirname, '..');
const SAMPLE_HTML = path.resolve(__dirname, '..', 'sample.html.sample');
// Any real github.com PR URL works for the routed page: the document is
// served from the saved sample fixture (so no GitHub login is needed). The
// repo in the URL would drive the extension's branch-list fetch (a
// service-worker fetch, which page routing cannot intercept) — this spec
// stubs that request inside the service worker so it needs no network.
const PR_URL = 'https://github.com/openshift/velero/pull/604';

// The universal profile's Cherry-pick command as of schema v14: a branch
// picker whose joinMode is 'choose', i.e. the picker's Chain-picks toggle
// decides per post between parallel and chained submission.
const CHERRY_PICK_COMMAND = {
  id: 'cmd-cherry-pick',
  label: 'Cherry-pick...',
  command: '/cherry-pick',
  description: 'Cherry-pick this PR to selected branches',
  style: 'neutral',
  requireConfirm: false,
  hasInput: false,
  hasJobPicker: true,
  hasPayloadPicker: false,
  jobPickerFilter: 'all',
  jobSource: 'branches',
  joinMode: 'choose',
  expandRehearsalJobs: false,
  inputPlaceholder: 'target branch',
  commandTemplate: '/cherry-pick {input}',
  shortcut: ''
};

test.describe('Cherry-pick picker: parallel vs chain', () => {
  let context;

  test.beforeAll(async () => {
    const userDataDir = path.join(__dirname, '..', '.test-profile-chain');
    // Headless requires the new headless mode — the only headless build that
    // loads extensions — selected via channel: 'chromium'.
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    });
  });

  test.afterAll(async () => {
    if (context) await context.close();
  });

  test('Chain picks toggle switches one-command-per-branch into a single chained command', async () => {
    test.setTimeout(180000);

    // Serve the saved PR-page fixture for the document request. A
    // `script-src 'none'` CSP keeps GitHub's own scripts from booting: the
    // fixture is a post-render snapshot, and letting GitHub's app run would
    // re-render the anonymous view and replace the (logged-in) comment form
    // with a sign-in prompt. Stylesheets still load (no default-src), the
    // fixture DOM stays byte-for-byte intact, and background (GitHub API)
    // requests pass through untouched.
    await context.route(PR_URL, route =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        headers: { 'content-security-policy': "script-src 'none'" },
        path: SAMPLE_HTML,
      }));

    // chrome.storage is only reachable from extension contexts, so write the
    // test config through the service worker (same trick as the plugin-filter
    // spec in extension.spec.js).
    let sw = context.serviceWorkers()[0];
    if (!sw) {
      // Register the waiter before navigating: domcontentloaded does not
      // guarantee the extension worker has started, so a single sample after
      // the fact can miss it. Sampling again after the wait closes the race
      // from both directions.
      const workerReady = context.waitForEvent('serviceworker', { timeout: 30000 });
      workerReady.catch(() => {}); // no unhandled rejection if the sample wins
      const trigger = await context.newPage();
      await trigger.goto('https://github.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      sw = context.serviceWorkers()[0] ?? await workerReady;
      await trigger.close();
    }
    if (!sw) throw new Error('extension service worker never started');
    await sw.evaluate(cmd => {
      return new Promise(resolve => {
        const config = {
          // Current schema version: a stored version below it gets migrated
          // on load, and older migration steps can replace built-in profiles
          // wholesale — silently discarding this command. Version 14 keeps
          // the stored profile exactly as written here.
          version: 14,
          profiles: [{
            id: 'profile-tide-prow-universal',
            name: 'Tide/Prow — Universal',
            description: 'Common Prow/Tide slash commands',
            enabled: true,
            repoPatterns: ['*'],
            globalCommands: [cmd],
            checkCommands: [],
            dynamicCommands: []
          }],
          repoOverrides: [],
          pluginConfigSources: [],
          globalSettings: {
            enabled: true,
            buttonPosition: 'above-comment-box',
            theme: 'auto',
            confirmBeforePost: false,
            showOnlyFailedTests: true,
            autoSubmit: false,
            pluginFilterMode: 'disabled',
            excludedRepos: [],
            prowAutoDetect: false
          }
        };
        chrome.storage.sync.set({ ghbcp_config: config }, resolve);
      });
    }, CHERRY_PICK_COMMAND);

    // Stub the branch-list request inside the service worker: page routes
    // cannot intercept extension background fetches, and the real
    // unauthenticated api.github.com call is rate-limit prone. Unrelated
    // requests still go to the network.
    await sw.evaluate(() => {
      const realFetch = self.fetch.bind(self);
      self.fetch = (url, init) => {
        if (String(url).startsWith('https://api.github.com/repos/openshift/velero/branches')) {
          return Promise.resolve(new Response(
            JSON.stringify([{ name: 'master' }, { name: 'release-4.16' }]),
            { status: 200, headers: { 'content-type': 'application/json' } }
          ));
        }
        return realFetch(url, init);
      };
    });

    const page = await context.newPage();
    await page.goto(PR_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const commandBar = page.locator('.ghbcp-command-bar');
    await expect(commandBar).toBeVisible({ timeout: 20000 });

    const cherryBtn = commandBar.locator('.ghbcp-btn', { hasText: 'Cherry-pick...' }).first();
    await expect(cherryBtn).toBeVisible({ timeout: 10000 });

    const textarea = page.locator('#new_comment_field').first();
    await expect(textarea).toBeVisible({ timeout: 10000 });

    // ── Round 1: toggle left unchecked → one command per branch (parallel) ──
    await cherryBtn.click();
    const picker = page.locator('.ghbcp-job-picker');
    await expect(picker).toBeVisible({ timeout: 15000 });

    // Branch rows come from the service-worker fetch stub installed above.
    const items = picker.locator('.ghbcp-job-picker-item');
    await expect(items.first()).toBeVisible({ timeout: 20000 });
    expect(await items.count()).toBeGreaterThan(1);

    // The toggle must exist, be a checkbox, and default to unchecked
    // (parallel — the extension's historical multi-select behavior).
    const chainToggle = picker.locator('.ghbcp-job-picker-chain input');
    await expect(chainToggle).toBeVisible();
    await expect(chainToggle).not.toBeChecked();
    expect(await picker.locator('.ghbcp-job-picker-chain').innerText()).toContain('Chain picks');

    const names = [];
    for (const i of [0, 1]) {
      const item = items.nth(i);
      names.push((await item.locator('.ghbcp-job-name').innerText()).trim());
      await item.click();
    }
    await picker.locator('.ghbcp-job-picker-submit').click();
    await expect(textarea).toHaveValue(
      `/cherry-pick ${names[0]}\n/cherry-pick ${names[1]}`, { timeout: 10000 });

    // ── Round 2: Chain picks checked → single space-joined command ──────────
    await textarea.fill('');
    await cherryBtn.click();
    await expect(picker).toBeVisible({ timeout: 15000 });
    await chainToggle.check();
    // Click in reverse display order: the chain must default to click order,
    // not branch-list order — a regression that seeds the chain from the
    // list would produce the same command either way with matching clicks.
    for (const i of [1, 0]) {
      await items.nth(i).click();
    }
    // Visual artifact of the toggle in the picker footer (checked, 2 selected).
    await picker.screenshot({ path: path.join(__dirname, '..', 'test-results', 'chain-toggle.png') });
    await picker.locator('.ghbcp-job-picker-submit').click();
    await expect(textarea).toHaveValue(
      `/cherry-pick ${names[1]} ${names[0]}`, { timeout: 10000 });

    // ── Round 3: chain order is editable — drag a row above another ─────────
    // The chain order defaults to click order; the Reorder button opens a
    // drag/arrow editor so the first branch (picked now) can be changed.
    await textarea.fill('');
    await cherryBtn.click();
    await expect(picker).toBeVisible({ timeout: 15000 });
    await chainToggle.check();
    for (const i of [0, 1]) {
      await items.nth(i).click();
    }

    const reorderBtn = picker.locator('.ghbcp-job-picker-reorder');
    await expect(reorderBtn).toBeVisible();
    await reorderBtn.click();

    const orderPanel = picker.locator('.ghbcp-job-picker-order');
    await expect(orderPanel).toBeVisible();
    const orderRows = orderPanel.locator('.ghbcp-job-picker-order-item');
    await expect(orderRows).toHaveCount(2);
    // Default = click order.
    await expect(orderRows.nth(0).locator('.ghbcp-job-name')).toHaveText(names[0]);
    await expect(orderRows.nth(1).locator('.ghbcp-job-name')).toHaveText(names[1]);
    // Grabber present on every row.
    await expect(orderRows.nth(0).locator('.ghbcp-job-picker-grabber')).toBeVisible();

    // Drag row 2 onto the upper half of row 1 → row 2 becomes first.
    await orderRows.nth(1).dragTo(orderRows.nth(0), { targetPosition: { x: 60, y: 4 } });
    await expect(orderRows.nth(0).locator('.ghbcp-job-name')).toHaveText(names[1]);
    await expect(orderRows.nth(1).locator('.ghbcp-job-name')).toHaveText(names[0]);
    await orderPanel.screenshot({ path: path.join(__dirname, '..', 'test-results', 'chain-reorder.png') });

    await picker.locator('.ghbcp-job-picker-submit').click();
    await expect(textarea).toHaveValue(
      `/cherry-pick ${names[1]} ${names[0]}`, { timeout: 10000 });

    // ── Round 4: ↑/↓ buttons reorder without a pointer drag (touch/keyboard) ─
    await textarea.fill('');
    await cherryBtn.click();
    await expect(picker).toBeVisible({ timeout: 15000 });
    await chainToggle.check();
    for (const i of [0, 1]) {
      await items.nth(i).click();
    }
    await reorderBtn.click();
    await expect(orderRows).toHaveCount(2);
    // Move the first row down one slot → second branch is picked first.
    await orderRows.nth(0).locator('.ghbcp-job-picker-order-move').last().click();
    await expect(orderRows.nth(0).locator('.ghbcp-job-name')).toHaveText(names[1]);
    await picker.locator('.ghbcp-job-picker-submit').click();
    await expect(textarea).toHaveValue(
      `/cherry-pick ${names[1]} ${names[0]}`, { timeout: 10000 });

    // ── Round 5: releasing over the dragged row itself keeps the order ──────
    // The dragged row slides under the pointer as it moves; its own dragover
    // must still accept the drop, or the browser marks the position invalid
    // and the release reverts the whole drag.
    await textarea.fill('');
    await cherryBtn.click();
    await expect(picker).toBeVisible({ timeout: 15000 });
    await chainToggle.check();
    for (const i of [0, 1]) {
      await items.nth(i).click();
    }
    await reorderBtn.click();
    await expect(orderRows).toHaveCount(2);
    await expect(orderRows.nth(0).locator('.ghbcp-job-name')).toHaveText(names[0]);

    const src = await orderRows.nth(1).boundingBox();
    const dst = await orderRows.nth(0).boundingBox();
    await page.mouse.move(src.x + 8, src.y + 4);
    await page.mouse.down();
    // Two moves over row 1's name span, top half: the first fires dragenter,
    // the second dragover — the event that does the live insert. (Headless
    // Chromium only fires dragover when the pointer moves again while over
    // the same element; a new element gets another dragenter.)
    await page.mouse.move(dst.x + 60, dst.y + 10);
    await page.mouse.move(dst.x + 65, dst.y + 12);
    await expect(orderRows.nth(0).locator('.ghbcp-job-name')).toHaveText(names[1]);
    // The dragged row now sits first, under the pointer. Pause over it —
    // another dragenter/dragover pair on its own name span — and release
    // there: its own dragover must keep the drop valid.
    const dragged = await orderRows.nth(0).boundingBox();
    await page.mouse.move(dragged.x + 60, dragged.y + 10);
    await page.mouse.move(dragged.x + 65, dragged.y + 12);
    await page.mouse.up();
    await expect(orderRows.nth(0).locator('.ghbcp-job-name')).toHaveText(names[1]);
    await expect(orderRows.nth(1).locator('.ghbcp-job-name')).toHaveText(names[0]);
    await picker.locator('.ghbcp-job-picker-submit').click();
    await expect(textarea).toHaveValue(
      `/cherry-pick ${names[1]} ${names[0]}`, { timeout: 10000 });

    // ── Round 6: dropping outside the order editor reverts the drag ─────────
    // Only a drop that ran an order row's drop handler may commit the
    // reordered chain. In a real browser the search input natively accepts
    // the dragged text (dropEffect stays non-none); headless Chromium
    // doesn't apply that native acceptance, so the test makes the input a
    // valid drop target itself to stand in for it.
    await textarea.fill('');
    await cherryBtn.click();
    await expect(picker).toBeVisible({ timeout: 15000 });
    await chainToggle.check();
    for (const i of [0, 1]) {
      await items.nth(i).click();
    }
    await reorderBtn.click();
    await expect(orderRows).toHaveCount(2);
    await page.evaluate(() => {
      const input = document.querySelector('.ghbcp-job-picker-search');
      input.addEventListener('dragover', e => e.preventDefault());
      input.addEventListener('drop', e => e.preventDefault());
    });

    const src2 = await orderRows.nth(0).boundingBox();
    const dst2 = await orderRows.nth(1).boundingBox();
    await page.mouse.move(src2.x + 8, src2.y + 4);
    await page.mouse.down();
    // Two moves over row 2's name span, bottom half → the dragged row moves
    // below it…
    await page.mouse.move(dst2.x + 60, dst2.y + 18);
    await page.mouse.move(dst2.x + 65, dst2.y + 20);
    await expect(orderRows.nth(0).locator('.ghbcp-job-name')).toHaveText(names[1]);
    // …then release over the search input, outside the order editor.
    const search = await picker.locator('.ghbcp-job-picker-search').boundingBox();
    await page.mouse.move(search.x + search.width / 2, search.y + search.height / 2);
    await page.mouse.up();
    // …the drag reverts to the click-order snapshot instead of committing.
    await expect(orderRows.nth(0).locator('.ghbcp-job-name')).toHaveText(names[0]);
    await expect(orderRows.nth(1).locator('.ghbcp-job-name')).toHaveText(names[1]);
    await picker.locator('.ghbcp-job-picker-submit').click();
    await expect(textarea).toHaveValue(
      `/cherry-pick ${names[0]} ${names[1]}`, { timeout: 10000 });
  });
});
