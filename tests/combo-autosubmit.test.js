'use strict';
// Regex-source assertions for the auto-submit combo window: clicking a second
// command button within COMBO_SEND_DELAY_MS of the first folds it into the
// same pending comment instead of posting two separate ones. content.js's
// main IIFE isn't vm-executed anywhere in this suite (see the comment atop
// content-helpers.test.js) — these assert the source shape, same as
// accessibility-attributes.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const contentJs = fs.readFileSync(path.resolve(__dirname, '..', 'content.js'), 'utf8');

test('fillComment defers to queueAutoSubmit when autoSubmit is enabled', () => {
  assert.match(contentJs, /function fillComment\(cmdText\) \{\s*\n\s*if \(config\.globalSettings\.autoSubmit\) \{\s*\n\s*queueAutoSubmit\(cmdText\);/);
});

test('queueAutoSubmit cancels the pending timer and folds a new command into the same buffer', () => {
  assert.match(contentJs, /if \(pendingComboTimer\) \{\s*\n\s*clearTimeout\(pendingComboTimer\);\s*\n\s*\} else \{\s*\n\s*pendingComboLines = \[\];\s*\n\s*\}/);
  // Duplicate clicks of the same command must not add a second identical line
  assert.match(contentJs, /if \(!pendingComboLines\.includes\(cmdText\)\) \{\s*\n\s*pendingComboLines\.push\(cmdText\);/);
});

test('queued command lines are joined with newlines, matching Prow\'s per-line command regexes', () => {
  // e.g. lgtm.go: LGTMRe = regexp.MustCompile(`(?mi)^/lgtm(?: no-issue)?\s*$`) —
  // multiple commands only combine into one comment when each is on its own line.
  assert.match(contentJs, /pendingComboLines\.join\('\\n'\)/);
});

test('the auto-submit combo window is a named, non-trivial delay', () => {
  assert.match(contentJs, /const COMBO_SEND_DELAY_MS = 2000;/);
  assert.match(contentJs, /setTimeout\(\(\) => \{\s*\n\s*pendingComboTimer = null;/);
});
