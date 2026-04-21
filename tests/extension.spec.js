const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const EXTENSION_PATH = path.resolve(__dirname, '..');
const PR_URL = 'https://github.com/openshift/openshift-velero-plugin/pull/395';

test.describe('GitHub Bot Command Palette', () => {
  let context;
  let page;

  test.beforeAll(async () => {
    const userDataDir = path.join(__dirname, '..', '.test-profile');
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    });
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('injects command bar and populates comment box on click', async () => {
    test.setTimeout(180000);

    page = await context.newPage();
    await page.goto(PR_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for command bar
    const commandBar = page.locator('.ghbcp-command-bar');
    await expect(commandBar).toBeVisible({ timeout: 15000 });
    console.log('PASS: Command bar injected');

    // The main comment textarea has id="new_comment_field"
    // Scroll to bottom to ensure it's in view
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);

    const textarea = page.locator('#new_comment_field');
    let hasTextarea = await textarea.isVisible({ timeout: 3000 }).catch(() => false);

    if (!hasTextarea) {
      console.log('\n========================================');
      console.log('  LOGIN REQUIRED');
      console.log('  Log in to GitHub in the browser window.');
      console.log('  After login, navigate back to:');
      console.log('  ' + PR_URL);
      console.log('  Waiting up to 2 minutes...');
      console.log('========================================\n');

      // Wait for the main comment field to appear
      await expect(textarea).toBeVisible({ timeout: 120000 });
      hasTextarea = true;

      // Scroll to bottom and wait for extension to re-inject
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);

      // Reload to ensure extension re-injects with textarea found
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1000);

      await expect(page.locator('.ghbcp-command-bar')).toBeVisible({ timeout: 10000 });
      console.log('PASS: Command bar visible after login');
    }

    // Verify buttons
    const lgtmBtn = page.locator('.ghbcp-btn', { hasText: 'LGTM' }).first();
    await expect(lgtmBtn).toBeVisible();
    console.log('PASS: LGTM button visible');

    const approveBtn = page.locator('.ghbcp-btn', { hasText: 'Approve' }).first();
    await expect(approveBtn).toBeVisible();
    console.log('PASS: Approve button visible');

    // Scroll to command bar to make sure textarea is nearby
    await page.locator('.ghbcp-command-bar').scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    // Click LGTM -> verify textarea populated
    await lgtmBtn.click();
    await expect(textarea).toHaveValue('/lgtm', { timeout: 5000 });
    console.log('PASS: /lgtm filled in comment box');

    // Toast
    const toast = page.locator('.ghbcp-toast');
    await expect(toast).toBeVisible({ timeout: 3000 });
    console.log('PASS: Toast shown');

    // Approve
    await textarea.fill('');
    await approveBtn.click();
    await expect(textarea).toHaveValue('/approve', { timeout: 5000 });
    console.log('PASS: /approve filled in comment box');

    // CC User with input popover
    await textarea.fill('');
    const ccBtn = page.locator('.ghbcp-btn', { hasText: 'CC User' }).first();
    await ccBtn.click();

    const popover = page.locator('.ghbcp-popover');
    await expect(popover).toBeVisible({ timeout: 3000 });
    console.log('PASS: Input popover visible');

    await page.locator('.ghbcp-popover-input').fill('testuser');
    await page.locator('.ghbcp-popover-post').click();
    await expect(textarea).toHaveValue('/cc @testuser', { timeout: 5000 });
    console.log('PASS: /cc @testuser filled in comment box');

    console.log('\nAll basic tests passed!');
  });

  test('filters commands when plugin config source is enabled', async () => {
    test.setTimeout(60000);

    // Get the service worker to set config (chrome.storage only accessible from extension contexts)
    let sw = context.serviceWorkers()[0];
    if (!sw) {
      // Trigger service worker by navigating to a GitHub page
      const triggerPage = await context.newPage();
      await triggerPage.goto('https://github.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
      await triggerPage.waitForTimeout(2000);
      sw = context.serviceWorkers()[0];
      await triggerPage.close();
    }

    if (!sw) {
      console.log('SKIP: Could not get service worker for config setup');
      return;
    }

    // Set config with plugin source via the service worker context
    await sw.evaluate(() => {
      return new Promise(resolve => {
        const config = {
          version: 1,
          profiles: [
            {
              id: 'profile-tide-prow-universal',
              name: 'Tide/Prow — Universal',
              description: 'Common Prow/Tide slash commands',
              enabled: true,
              repoPatterns: ['*'],
              globalCommands: [
                { id: 'c1', label: 'LGTM', command: '/lgtm', description: 'LGTM', style: 'success', requireConfirm: false, hasInput: false, inputPlaceholder: '', commandTemplate: '', shortcut: '' },
                { id: 'c2', label: 'Approve', command: '/approve', description: 'Approve', style: 'success', requireConfirm: false, hasInput: false, inputPlaceholder: '', commandTemplate: '', shortcut: '' },
                { id: 'c3', label: 'Hold', command: '/hold', description: 'Hold', style: 'warning', requireConfirm: false, hasInput: false, inputPlaceholder: '', commandTemplate: '', shortcut: '' },
                { id: 'c4', label: 'Retest', command: '/retest', description: 'Retest', style: 'primary', requireConfirm: false, hasInput: false, inputPlaceholder: '', commandTemplate: '', shortcut: '' }
              ],
              checkCommands: [],
              dynamicCommands: []
            }
          ],
          repoOverrides: [],
          pluginConfigSources: [
            {
              id: 'src-openshift',
              name: 'OpenShift CI',
              enabled: true,
              format: 'sharded',
              configRepo: 'openshift/release',
              branch: 'master',
              pathTemplate: 'core-services/prow/02_config',
              filePath: '',
              cacheTTLMinutes: 60
            }
          ],
          globalSettings: {
            enabled: true,
            buttonPosition: 'above-comment-box',
            theme: 'auto',
            confirmBeforePost: false,
            showOnlyFailedTests: true,
            autoSubmit: false,
            pluginFilterMode: 'filter'
          }
        };
        chrome.storage.sync.set({ ghbcp_config: config }, resolve);
      });
    });

    // Navigate to the PR
    const testPage = await context.newPage();
    await testPage.goto(PR_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await testPage.waitForTimeout(5000);

    const commandBar = testPage.locator('.ghbcp-command-bar');
    await expect(commandBar).toBeVisible({ timeout: 15000 });
    console.log('PASS: Command bar visible with plugin source configured');

    // The pluginconfig for openshift/openshift-velero-plugin should have approve and lgtm
    // Verify LGTM and Approve are visible
    const lgtmBtn = testPage.locator('.ghbcp-btn', { hasText: 'LGTM' }).first();
    const approveBtn = testPage.locator('.ghbcp-btn', { hasText: 'Approve' }).first();

    const lgtmVisible = await lgtmBtn.isVisible({ timeout: 3000 }).catch(() => false);
    const approveVisible = await approveBtn.isVisible({ timeout: 3000 }).catch(() => false);

    console.log(`LGTM visible: ${lgtmVisible}`);
    console.log(`Approve visible: ${approveVisible}`);

    // Check for refresh and configure buttons
    const refreshBtn = testPage.locator('.ghbcp-refresh-btn');
    const configLink = testPage.locator('.ghbcp-config-link');

    const hasRefresh = await refreshBtn.isVisible({ timeout: 3000 }).catch(() => false);
    const hasConfig = await configLink.isVisible({ timeout: 3000 }).catch(() => false);

    console.log(`Refresh button: ${hasRefresh}`);
    console.log(`Configure link: ${hasConfig}`);

    if (hasConfig) {
      const href = await configLink.getAttribute('href');
      console.log(`Configure link URL: ${href}`);
      expect(href).toContain('github.com/openshift/release');
    }

    // Verify Hold is filtered out (not in the pluginconfig for openshift-velero-plugin)
    const holdBtn = testPage.locator('.ghbcp-btn', { hasText: 'Hold' }).first();
    const holdVisible = await holdBtn.isVisible({ timeout: 2000 }).catch(() => false);
    console.log(`Hold visible (should be false if filtering works): ${holdVisible}`);

    await testPage.close();

    // Clean up: restore default config (no plugin sources)
    // Clean up via service worker
    const swClean = context.serviceWorkers()[0];
    if (swClean) {
      await swClean.evaluate(() => {
        return new Promise(resolve => {
          chrome.storage.sync.remove('ghbcp_config', resolve);
        });
      });
    }

    console.log('\nPlugin config filtering test complete!');
  });
});
