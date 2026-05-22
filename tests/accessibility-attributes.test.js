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
  // aria-atomic ensures the full toast message is announced at once (not word-by-word)
  assert.match(contentJs, /toast\.setAttribute\('aria-atomic', 'true'\)/);
});

test('success/warning toasts use role=status to avoid interrupting screen reader', () => {
  // role="alert" implies aria-live="assertive" and interrupts the current screen reader task.
  // role="status" implies aria-live="polite" and waits for the current task to finish.
  // Only error toasts should interrupt; success/warning toasts should use role="status".
  assert.match(contentJs, /toast\.setAttribute\('role', 'status'\)/);
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

test('job picker has a keyboard focus trap', () => {
  assert.match(contentJs, /addFocusTrap\(picker, searchInput\)/);
});

test('settings page edit buttons have aria-label', () => {
  const settingsJs = fs.readFileSync(path.resolve(__dirname, '..', 'settings.js'), 'utf8');
  assert.match(settingsJs, /aria-label="Edit profile \$\{esc\(p\.name\)\}"/);
  assert.match(settingsJs, /aria-label="Edit command \$\{esc\(c\.label\)\}"/);
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
  // cancelled and stale must be treated as pending (amber), not passed (green)
  assert.match(contentJs, /\[data-conclusion="cancelled"\]/);
  assert.match(contentJs, /\[data-conclusion="stale"\]/);
});

test('shared selector constants are defined for checks section and legacy rows', () => {
  assert.match(contentJs, /const CHECKS_SECTION_SELECTOR/);
  assert.match(contentJs, /const LEGACY_CHECK_ROW_SELECTOR/);
});

test('getCheckStatus helper is defined and used by both scrapeCheckNames and injectCheckButtons', () => {
  assert.match(contentJs, /function getCheckStatus\(element\)/);
  // scrapeCheckNames uses it
  assert.match(contentJs, /status: getCheckStatus\(item\)/);
  assert.match(contentJs, /status: getCheckStatus\(row\)/);
  // injectCheckButtons uses it
  assert.match(contentJs, /getCheckStatus\(row\) !== 'failed'/);
});

test('addFocusTrap includes all standard focusable elements', () => {
  // Should include a[href], select, textarea, and [tabindex] — not just input and button.
  assert.match(contentJs, /a\[href\].*button:not\(\[disabled\]\).*input:not\(\[disabled\]\).*select:not\(\[disabled\]\).*textarea:not\(\[disabled\]\).*\[tabindex\]:not\(\[tabindex="-1"\]\)/);
});

test('injectReviewToolbar receives and checks extraCommands for review commands', () => {
  // extraCommands (repo overrides) should also appear in the review toolbar
  // if they match /lgtm or /approve.
  assert.match(contentJs, /function injectReviewToolbar\(profiles, extraCommands\)/);
  assert.match(contentJs, /for.*const cmd of.*extraCommands.*\|\|.*\[\]\)/s);
});

test('injectReviewToolbar guards against null parentElement before DOM insertion', () => {
  // reviewForm.parentElement could theoretically be null for a detached DOM node;
  // the null guard prevents an uncaught TypeError that would silence the injection.
  assert.match(contentJs, /if \(reviewForm\.parentElement\)/);
});

test('injectReviewDialogBar guards against null textarea parentElement before DOM insertion', () => {
  // The fieldset branch already checks fieldset.parentElement; the else branch
  // must be consistent and guard textarea.parentElement the same way.
  assert.match(contentJs, /else if \(textarea\.parentElement\)/);
});

test('injectCheckButtons respects showOnlyFailedTests setting', () => {
  // When showOnlyFailedTests is true, only failed checks should get buttons.
  // When false, all checks should get buttons.
  // The gate must read config.globalSettings.showOnlyFailedTests, not be hardcoded.
  assert.match(contentJs, /config\.globalSettings\.showOnlyFailedTests && getCheckStatus\(row\) !== 'failed'/);
});

test('job picker dialog has aria-modal="true"', () => {
  assert.match(contentJs, /picker\.setAttribute\('aria-modal', 'true'\)/);
});

test('input popover dialog has aria-modal="true"', () => {
  assert.match(contentJs, /popover\.setAttribute\('aria-modal', 'true'\)/);
});

test('job picker close button has aria-label', () => {
  assert.match(contentJs, /closeBtn\.setAttribute\('aria-label', 'Close job picker'\)/);
});

test('job picker submit button has aria-label describing the action', () => {
  assert.match(contentJs, /submitBtn\.setAttribute\('aria-label', \(command\.label \|\| 'Run'\) \+ ' selected jobs'\)/);
});

test('job picker close button has type="button" to prevent accidental form submission', () => {
  // Without type="button", the default type is "submit" which can accidentally
  // submit any enclosing <form> element when clicked.
  assert.match(contentJs, /closeBtn\.type = 'button'/);
});

test('command groups have role=group and aria-labelledby for screen reader navigation', () => {
  assert.match(contentJs, /group\.setAttribute\('role', 'group'\)/);
  assert.match(contentJs, /group\.setAttribute\('aria-labelledby', groupLabelId\)/);
  assert.match(contentJs, /groupLabel\.id = groupLabelId/);
});

test('settings command editor saves jobSource and joinMode fields', () => {
  const settingsJs = fs.readFileSync(path.resolve(__dirname, '..', 'settings.js'), 'utf8');
  // Both fields must be read from the form and saved in the command object
  assert.match(settingsJs, /jobSource:\s*document\.getElementById\('cmd-jobsource'\)\.value/);
  assert.match(settingsJs, /joinMode:\s*document\.getElementById\('cmd-joinmode'\)\.value/);
});

test('settings command editor loads jobSource and joinMode into form fields', () => {
  const settingsJs = fs.readFileSync(path.resolve(__dirname, '..', 'settings.js'), 'utf8');
  assert.match(settingsJs, /getElementById\('cmd-jobsource'\)\.value\s*=\s*cmd\.jobSource/);
  assert.match(settingsJs, /getElementById\('cmd-joinmode'\)\.value\s*=\s*cmd\.joinMode/);
});

test('getCheckStatus maps cancelled and stale conclusions to pending (not passed)', () => {
  // cancelled = job manually stopped and may need re-run
  // stale = deadline exceeded without a result
  // Both are NOT clean pass states and should show as amber in the job picker.
  assert.match(contentJs, /\[data-conclusion="cancelled"\]/);
  assert.match(contentJs, /\[data-conclusion="stale"\]/);
  // Both must appear in the pending selector (same querySelector call as [data-conclusion="pending"])
  assert.match(contentJs, /\[data-conclusion="pending"\].*\[data-conclusion="cancelled"\].*\[data-conclusion="stale"\]|isPending.*cancelled.*stale/s);
});

test('SPA navigation event listeners are registered for GitHub turbo, pjax, popstate and hashchange', () => {
  // GitHub uses Turbo (formerly Turbolinks) and pjax for SPA navigation.
  // Without these listeners the extension fails to re-inject after page transitions.
  assert.match(contentJs, /document\.addEventListener\('turbo:load'/);
  assert.match(contentJs, /document\.addEventListener\('pjax:end'/);
  assert.match(contentJs, /window\.addEventListener\('popstate'/);
  assert.match(contentJs, /window\.addEventListener\('hashchange'/);
});

test('handleShortcut suppresses keyboard shortcuts when a GHBCP overlay is open', () => {
  // Prevents accidental slash-command posting while the user interacts with the
  // job-picker dialog or input popover that the extension itself rendered.
  assert.match(contentJs, /document\.querySelector\('.ghbcp-popover, .ghbcp-job-picker'\)/);
  assert.match(contentJs, /if.*document\.querySelector\('.ghbcp-popover, .ghbcp-job-picker'\).*return/s);
});

test('bar header robot icon has aria-hidden so screen readers skip it', () => {
  // The robot emoji (🤖) is decorative; screen readers should skip it.
  assert.match(contentJs, /aria-hidden="true">&#129302;/);
});

test('bar header refresh button has aria-label describing cache age', () => {
  // The refresh button (↻) is an icon-only button; it must have an aria-label
  // so screen reader users know what it does and how stale the cached data is.
  assert.match(contentJs, /refreshBtn\.setAttribute\('aria-label', `Refresh plugin config \(cached \$\{ago\} min ago\)`\)/);
});

test('bar header config link has aria-label', () => {
  // The config gear (⚙) is an icon-only link; it must have an aria-label.
  assert.match(contentJs, /configLink\.setAttribute\('aria-label', 'Edit plugin config on GitHub'\)/);
});

test('bar header config link gear icon has aria-hidden', () => {
  // The gear character is decorative; the accessible name comes from aria-label.
  assert.match(contentJs, /configLink\.innerHTML.*aria-hidden="true".*&#9881;/s);
});

test('popup.js profile toggle checkboxes have aria-label', () => {
  // Icon-free checkboxes must have an aria-label so screen reader users know
  // which profile they are toggling.
  assert.match(popupJs, /aria-label="Enable \$\{esc\(p\.name\)\}"/);
});

test('popup.js plugin config link has aria-label', () => {
  // The "Edit" link in the plugin status line must have an accessible name so
  // screen reader users are not presented with a bare "Edit" link without context.
  assert.match(popupJs, /aria-label="Edit plugin config on GitHub"/);
});

test('popup.html robot icon has aria-hidden so screen readers skip it', () => {
  // The robot emoji (🤖) in the popup header is decorative; screen readers
  // should skip it to avoid announcing "robot face" before the heading.
  const popupHtml = fs.readFileSync(path.resolve(__dirname, '..', 'popup.html'), 'utf8');
  assert.match(popupHtml, /aria-hidden="true">&#129302;</);
});

test('settings.html preset selector has aria-label for screen readers', () => {
  // The "Add from Preset..." <select> has no associated <label> element;
  // aria-label gives screen reader users the context they need.
  const settingsHtml = fs.readFileSync(path.resolve(__dirname, '..', 'settings.html'), 'utf8');
  assert.match(settingsHtml, /id="preset-select"[^>]*aria-label=|aria-label=[^>]*id="preset-select"/);
});

test('settings.html modal dialogs have role=dialog, aria-modal, and aria-labelledby', () => {
  // Without role="dialog" and aria-modal="true", screen readers do not treat
  // these overlays as modal dialogs and may allow the user to interact with
  // content behind them.  aria-labelledby gives each dialog an accessible name.
  const settingsHtml = fs.readFileSync(path.resolve(__dirname, '..', 'settings.html'), 'utf8');
  assert.match(settingsHtml, /id="source-modal-title".*role="dialog"|role="dialog"[^>]*aria-labelledby="source-modal-title"/s);
  assert.match(settingsHtml, /id="modal-title".*role="dialog"|role="dialog"[^>]*aria-labelledby="modal-title"/s);
  assert.match(settingsHtml, /id="cmd-modal-title".*role="dialog"|role="dialog"[^>]*aria-labelledby="cmd-modal-title"/s);
  // Each dialog must also have aria-modal="true"
  assert.ok(
    (settingsHtml.match(/role="dialog"[^>]*aria-modal="true"|aria-modal="true"[^>]*role="dialog"/g) || []).length >= 3,
    'Expected at least 3 modal dialogs with aria-modal="true"'
  );
});

