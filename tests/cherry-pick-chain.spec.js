const { test, expect, chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const EXTENSION_PATH = path.resolve(__dirname, '..');
const SAMPLE_HTML = path.resolve(__dirname, '..', 'sample.html.sample');
// Any real github.com PR URL works for the routed page: the document is
// served from the saved sample fixture (so no GitHub login is needed), while
// the repo in the URL drives the extension's branch-list fetch against the
// real public GitHub API (service-worker fetches bypass page routing).
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
    test.setTimeout(120000);

    // Serve the saved PR-page fixture for the document request. GitHub's own
    // scripts are stripped first: the fixture is a post-render snapshot, and
    // letting GitHub's app boot would re-render the anonymous view and replace
    // the (logged-in) comment form with a sign-in prompt. CDN stylesheets
    // still load, and background (GitHub API) requests pass through untouched.
    const fixtureHtml = fs.readFileSync(SAMPLE_HTML, 'utf8')
      .replace(/<script[\s\S]*?<\/script>/gi, '');
    await context.route(PR_URL, route =>
      route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixtureHtml }));

    // chrome.storage is only reachable from extension contexts, so write the
    // test config through the service worker (same trick as the plugin-filter
    // spec in extension.spec.js).
    let sw = context.serviceWorkers()[0];
    if (!sw) {
      const trigger = await context.newPage();
      await trigger.goto('https://github.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      sw = context.serviceWorkers()[0];
      await trigger.close();
    }
    if (!sw) throw new Error('extension service worker never started');
    await sw.evaluate(cmd => {
      return new Promise(resolve => {
        const config = {
          version: 1,
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

    // Branch rows come from the real GitHub API for openshift/velero.
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
    // Same first two branches (list is cached per repo, so order is stable).
    for (const i of [0, 1]) {
      await items.nth(i).click();
    }
    // Visual artifact of the toggle in the picker footer (checked, 2 selected).
    await picker.screenshot({ path: path.join(__dirname, '..', 'test-results', 'chain-toggle.png') });
    await picker.locator('.ghbcp-job-picker-submit').click();
    await expect(textarea).toHaveValue(
      `/cherry-pick ${names[0]} ${names[1]}`, { timeout: 10000 });

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
  });
});
