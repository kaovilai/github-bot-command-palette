const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const contentJsPath = path.resolve(__dirname, '..', 'content.js');
const contentJs = fs.readFileSync(contentJsPath, 'utf8');

const popupJsPath = path.resolve(__dirname, '..', 'popup.js');
const popupJs = fs.readFileSync(popupJsPath, 'utf8');

test('content script adds accessibility attributes for injected picker and popover UI', () => {
  assert.match(contentJs, /picker\.setAttribute\('role', 'dialog'\)/);
  assert.match(contentJs, /picker\.setAttribute\('aria-label', 'Select CI jobs to run'\)/);
  assert.match(contentJs, /searchInput\.setAttribute\('aria-label', 'Search CI jobs'\)/);
  assert.match(contentJs, /cb\.setAttribute\('aria-label', `\$\{job\.name\} \(\$\{job\.status \|\| 'unknown'\}\)`\)/);
  assert.match(contentJs, /dot\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(contentJs, /popover\.setAttribute\('role', 'dialog'\)/);
  assert.match(contentJs, /popover\.setAttribute\('aria-label', command\.label \|\| command\.command \|\| 'Command input'\)/);
  assert.match(contentJs, /input\.setAttribute\('aria-label', command\.inputPlaceholder \|\| 'Enter value'\)/);
  assert.match(contentJs, /cancelBtn\.setAttribute\('aria-label', 'Cancel'\)/);
});

test('content script makes toast announcements available to assistive tech', () => {
  assert.match(contentJs, /toast\.setAttribute\('role', 'alert'\)/);
  assert.match(contentJs, /toast\.setAttribute\('aria-live', 'polite'\)/);
});

test('job picker count span has aria-live for screen reader announcements', () => {
  assert.match(contentJs, /countSpan\.setAttribute\('aria-live', 'polite'\)/);
  assert.match(contentJs, /countSpan\.setAttribute\('aria-atomic', 'true'\)/);
});

test('job picker list has role=list and items have role=listitem', () => {
  assert.match(contentJs, /list\.setAttribute\('role', 'list'\)/);
  assert.match(contentJs, /item\.setAttribute\('role', 'listitem'\)/);
});

test('popup.js uses CM.escapeHtml for HTML escaping', () => {
  assert.match(popupJs, /CM\.escapeHtml/);
});

test('popup.js uses esc() when inserting profile names into innerHTML', () => {
  assert.match(popupJs, /\$\{esc\(p\.name\)\}/);
});

test('popup.js uses esc() when inserting command text into innerHTML', () => {
  assert.match(popupJs, /\$\{esc\(c\.command\)\}/);
});

test('input popover has a keyboard focus trap', () => {
  assert.match(contentJs, /popover\.addEventListener\('keydown'.*Tab/s);
});

test('command bars have role=toolbar and aria-label', () => {
  // injectGlobalCommandBar and injectReviewDialogBar set role="toolbar"
  const toolbarRoleCount = (contentJs.match(/bar\.setAttribute\('role', 'toolbar'\)/g) || []).length;
  assert.ok(toolbarRoleCount >= 2, `Expected at least 2 bar role=toolbar, got ${toolbarRoleCount}`);
  const toolbarLabelCount = (contentJs.match(/bar\.setAttribute\('aria-label', 'Bot Commands'\)/g) || []).length;
  assert.ok(toolbarLabelCount >= 2, `Expected at least 2 bar aria-label, got ${toolbarLabelCount}`);
});

test('review toolbar has role=toolbar and aria-label', () => {
  assert.match(contentJs, /toolbar\.setAttribute\('role', 'toolbar'\)/);
  assert.match(contentJs, /toolbar\.setAttribute\('aria-label', 'Bot Commands'\)/);
});

test('scrapeCheckNames uses data-conclusion selectors for failed status in modern UI', () => {
  // Ensures the job picker reports accurate status even when GitHub uses
  // data-conclusion attributes instead of icon classes.
  assert.match(contentJs, /\[data-conclusion="failure"\]/);
  assert.match(contentJs, /\[data-conclusion="timed_out"\]/);
  assert.match(contentJs, /\[data-conclusion="action_required"\]/);
  assert.match(contentJs, /\[data-conclusion="pending"\]/);
});

test('shared selector constants are defined for checks section and legacy rows', () => {
  assert.match(contentJs, /const CHECKS_SECTION_SELECTOR/);
  assert.match(contentJs, /const LEGACY_CHECK_ROW_SELECTOR/);
});
