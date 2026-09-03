'use strict';
// Regex-source assertions for the auto-submit combo window: clicking a second
// command button within COMBO_SEND_DELAY_MS of the first folds it into the
// same pending comment instead of posting two separate ones, and each
// contributing button shows a pending/spinner state until the post clears (or
// a "click it again" send-now). content.js's main IIFE isn't vm-executed
// anywhere in this suite (see the comment atop content-helpers.test.js), so
// these assert the source shape, same as accessibility-attributes.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const contentJs = fs.readFileSync(path.resolve(__dirname, '..', 'content.js'), 'utf8');

test('fillComment defers to queueAutoSubmit when autoSubmit is enabled, threading the triggering button through', () => {
  assert.match(contentJs, /function fillComment\(cmdText, btn\) \{\s*\n\s*if \(config\.globalSettings\.autoSubmit\) \{\s*\n\s*queueAutoSubmit\(cmdText, btn\);/);
});

test('every fillComment call site passes a button reference', () => {
  // Excludes doc-comment mentions like "(see fillComment())." — only actual
  // calls, which always pass either "anchorBtn" or "btn".
  assert.match(contentJs, /if \(cmdText\) fillComment\(cmdText, anchorBtn\);/); // showTestJobPicker
  assert.match(contentJs, /fillComment\(cmdText, btn\);\s*\n\s*\}\s*\n\n\s*\/\*\*\s*\n\s*\* "Rehearse All"/); // handleCommandClick's plain path
  assert.match(contentJs, /if \(!confirm\(`Post "\$\{preview\}"\?`\)\) return;\s*\n\s*\}\s*\n\n\s*fillComment\(cmdText, btn\);\s*\n\s*\}/); // expandAndPostRehearseAll
  assert.match(contentJs, /fillComment\(cmdText, anchorBtn\);\s*\n\s*closePayloadPicker\(\);/); // showPayloadPicker
  assert.match(contentJs, /fillComment\(cmdText, anchorBtn\);\s*\n\s*closePopover\(\);/); // showInputPopover
});

test('queueAutoSubmit treats a click on an already-queued command as "send now" instead of queueing a duplicate line', () => {
  assert.match(contentJs, /if \(pendingComboTimer && pendingComboLines\.includes\(cmdText\)\) \{\s*\n\s*clearTimeout\(pendingComboTimer\);\s*\n\s*pendingComboTimer = null;\s*\n\s*submitPendingCombo\(\);\s*\n\s*return;\s*\n\s*\}/);
});

test('queued command lines are joined with newlines, matching Prow\'s per-line command regexes', () => {
  // e.g. lgtm.go: LGTMRe = regexp.MustCompile(`(?mi)^/lgtm(?: no-issue)?\s*$`) —
  // multiple commands only combine into one comment when each is on its own line.
  assert.match(contentJs, /pendingComboLines\.join\('\\n'\)/);
});

test('the auto-submit combo window is a named, non-trivial delay', () => {
  assert.match(contentJs, /const COMBO_SEND_DELAY_MS = 2000;/);
  assert.match(contentJs, /pendingComboTimer = setTimeout\(submitPendingCombo, COMBO_SEND_DELAY_MS\);/);
});

test('a button that queues a combo line gets marked pending/busy, and cleared once the post is done', () => {
  assert.match(contentJs, /btn\.classList\.add\('ghbcp-btn-pending'\);\s*\n\s*btn\.setAttribute\('aria-busy', 'true'\);/);
  assert.match(contentJs, /function clearPendingButtons\(buttons\) \{\s*\n\s*for \(const b of buttons\) \{\s*\n\s*b\.classList\.remove\('ghbcp-btn-pending'\);\s*\n\s*b\.removeAttribute\('aria-busy'\);/);
});

test('submitPendingCombo clears pending buttons immediately on failure, and via waitForPostToClear on success', () => {
  assert.match(contentJs, /showToast\('No comment box found', 'error'\);\s*\n\s*clearPendingButtons\(finalButtons\);/);
  assert.match(contentJs, /waitForPostToClear\(textarea, finalButtons, 20\);/);
  assert.match(contentJs, /showToast\(`Filled: \$\{finalText\} \(submit manually\)`, 'warning'\);\s*\n\s*clearPendingButtons\(finalButtons\);/);
});

test('waitForPostToClear polls for the textarea clearing (or disappearing) rather than assuming success', () => {
  assert.match(contentJs, /function waitForPostToClear\(textarea, buttons, attemptsLeft\) \{\s*\n\s*if \(!textarea\.isConnected \|\| textarea\.value === '' \|\| attemptsLeft <= 0\) \{\s*\n\s*clearPendingButtons\(buttons\);/);
});
