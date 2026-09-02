'use strict';
// Regex-source assertions for selectNativeApproveReview(): clicking /approve
// should also select GitHub's own "Finish your review" dialog's native
// Approve radio, not just post the /approve comment text. content.js's main
// IIFE isn't vm-executed anywhere in this suite (see the comment atop
// content-helpers.test.js), so these assert the source shape, same as
// accessibility-attributes.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const contentJs = fs.readFileSync(path.resolve(__dirname, '..', 'content.js'), 'utf8');

test('handleCommandClick selects the native Approve radio only for the /approve command', () => {
  assert.match(contentJs, /if \(command\.command === '\/approve'\) \{\s*\n\s*selectNativeApproveReview\(\);\s*\n\s*\}/);
});

test('selectNativeApproveReview targets the stable name/value pair, not the React-generated id', () => {
  // GitHub's review-event radios: <input name="reviewEvent" value="approve"|"comment"|"request changes">.
  // The `id` is a useId() value that changes every render, so it must not be used as the selector.
  assert.match(contentJs, /document\.querySelector\('input\[name="reviewEvent"\]\[value="approve"\]'\)/);
});

test('selectNativeApproveReview clicks the radio rather than assigning .checked directly', () => {
  // A direct .checked = true assignment wouldn't fire React's onChange for this
  // controlled radio, same reason fillComment() uses the native value setter
  // + dispatched events for the textarea instead of plain assignment.
  assert.match(contentJs, /if \(radio && !radio\.checked\) \{\s*\n\s*radio\.click\(\);/);
});
