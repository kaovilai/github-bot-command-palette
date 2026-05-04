const { test, chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const EXTENSION_PATH = path.resolve(__dirname, '..');
const PR_URL = 'https://github.com/openshift/openshift-velero-plugin/pull/395';
const SCREENSHOTS_DIR = path.resolve(__dirname, '..', 'screenshots');

test.describe('Screenshots', () => {
  let context;

  test.beforeAll(async () => {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    const userDataDir = path.join(__dirname, '..', '.test-profile');
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
      viewport: { width: 1440, height: 900 },
    });
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('command bar buttons', async () => {
    test.setTimeout(180000);
    const page = await context.newPage();
    await page.goto(PR_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for login if needed
    const commandBar = page.locator('.ghbcp-command-bar');
    let visible = await commandBar.isVisible({ timeout: 10000 }).catch(() => false);
    if (!visible) {
      console.log('Waiting for login (up to 2 min)...');
      await page.waitForSelector('.ghbcp-command-bar', { timeout: 120000 });
    }

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);

    // Ensure command bar visible
    await commandBar.waitFor({ state: 'visible', timeout: 15000 });

    // Screenshot: full command bar
    await commandBar.screenshot({ path: path.join(SCREENSHOTS_DIR, '01-command-bar.png') });

    // Screenshot: wider context showing bar above comment box
    const commentBox = page.locator('#new_comment_field');
    const boxVisible = await commentBox.isVisible({ timeout: 3000 }).catch(() => false);
    if (boxVisible) {
      await page.evaluate(() => {
        const el = document.querySelector('.ghbcp-command-bar');
        if (el) el.scrollIntoView({ block: 'center' });
      });
      await page.waitForTimeout(500);
      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, '02-command-bar-in-context.png'),
        clip: await getClipAroundElement(page, '.ghbcp-command-bar', 120),
      });
    }

    // Hover over a button to show tooltip
    const lgtmBtn = page.locator('.ghbcp-btn', { hasText: 'LGTM' }).first();
    const lgtmVisible = await lgtmBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (lgtmVisible) {
      await lgtmBtn.hover();
      await page.waitForTimeout(600);
      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, '03-button-tooltip.png'),
        clip: await getClipAroundElement(page, '.ghbcp-command-bar', 80),
      });
    }

    await page.close();
  });

  test('failed check rows with override button', async () => {
    test.setTimeout(60000);
    const page = await context.newPage();
    await page.goto(PR_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.ghbcp-command-bar', { timeout: 30000 });

    // Scroll to checks section
    await page.evaluate(() => {
      const el = document.querySelector('section[aria-label="Checks"], .merge-status-list, details[data-deferred-details-content-url*="checks"]');
      if (el) el.scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(1000);

    // Look for override buttons injected by the extension
    const overrideBtn = page.locator('.ghbcp-override-btn, .ghbcp-btn').first();
    const hasBtns = await overrideBtn.isVisible({ timeout: 5000 }).catch(() => false);

    // Look for check rows with extension buttons
    const checkRows = page.locator('.merge-status-item, li[aria-label]');
    const rowCount = await checkRows.count();
    console.log(`Check rows found: ${rowCount}`);

    if (rowCount > 0) {
      // Find a row with an extension button
      for (let i = 0; i < Math.min(rowCount, 10); i++) {
        const row = checkRows.nth(i);
        const hasBtn = await row.locator('.ghbcp-override-btn, .ghbcp-retest-inline-btn').isVisible({ timeout: 500 }).catch(() => false);
        if (hasBtn) {
          await row.scrollIntoView();
          await page.waitForTimeout(500);
          await row.screenshot({ path: path.join(SCREENSHOTS_DIR, '04-check-row-with-buttons.png') });
          break;
        }
      }
    }

    // Screenshot the checks area
    const checksArea = page.locator('.merge-status-list, section[aria-label="Checks"]').first();
    const checksVisible = await checksArea.isVisible({ timeout: 3000 }).catch(() => false);
    if (checksVisible) {
      await checksArea.scrollIntoView();
      await page.waitForTimeout(500);
      await checksArea.screenshot({ path: path.join(SCREENSHOTS_DIR, '05-checks-section.png') });
    }

    await page.close();
  });

  test('settings page', async () => {
    test.setTimeout(30000);
    const page = await context.newPage();

    // Get extension ID from service worker
    await page.goto('https://github.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    const sw = context.serviceWorkers()[0];
    let extId = null;
    if (sw) {
      extId = sw.url().match(/chrome-extension:\/\/([^/]+)/)?.[1];
    }

    if (extId) {
      await page.goto(`chrome-extension://${extId}/settings.html`, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '06-settings-page.png'), fullPage: true });

      // Scroll down to show more settings
      await page.evaluate(() => window.scrollTo(0, 400));
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '07-settings-page-scroll.png') });
    }

    await page.close();
  });

  test('popup', async () => {
    test.setTimeout(30000);
    const page = await context.newPage();
    await page.goto(PR_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.ghbcp-command-bar', { timeout: 30000 });

    const sw = context.serviceWorkers()[0];
    let extId = null;
    if (sw) {
      extId = sw.url().match(/chrome-extension:\/\/([^/]+)/)?.[1];
    }

    if (extId) {
      const popupPage = await context.newPage();
      await popupPage.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await popupPage.setViewportSize({ width: 320, height: 500 });
      await popupPage.waitForTimeout(1000);
      await popupPage.screenshot({ path: path.join(SCREENSHOTS_DIR, '08-popup.png') });
      await popupPage.close();
    }

    await page.close();
  });
});

async function getClipAroundElement(page, selector, padding = 60) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) return undefined;
  const vp = page.viewportSize();
  return {
    x: Math.max(0, box.x - padding),
    y: Math.max(0, box.y - padding),
    width: Math.min(vp.width, box.width + padding * 2),
    height: Math.min(vp.height, box.height + padding * 2),
  };
}
