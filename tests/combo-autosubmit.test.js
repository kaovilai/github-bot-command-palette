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

// ---------------------------------------------------------------------------
// Mobile/touch compatibility for the combo path. addTapListener() and
// submitCommentForm() are declared outside content.js's IIFE (same reason as
// the helpers in content-helpers.test.js), so they can be extracted and
// exercised for real against a hand-rolled element/form stub.

const vm = require('node:vm');

const startMarker = 'const ACTIONS_RUN_JOB_HREF_RE';
const endMarker = '\n(async () => {';
const startIndex = contentJs.indexOf(startMarker);
const endIndex = contentJs.indexOf(endMarker);
assert.notEqual(startIndex, -1, `missing helper snippet start marker: ${startMarker}`);
assert.notEqual(endIndex, -1, `missing helper snippet end marker: ${endMarker}`);
assert.ok(startIndex < endIndex, 'helper snippet markers must be ordered');
const snippet = contentJs.slice(startIndex, endIndex);

/** Minimal EventTarget stub: records listeners and lets tests fire events. */
function makeEl() {
  const listeners = {};
  return {
    listeners,
    addEventListener(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    fire(type, props) {
      const e = Object.assign({
        type,
        defaultPrevented: false,
        propagationStopped: false,
        preventDefault() { e.defaultPrevented = true; },
        stopPropagation() { e.propagationStopped = true; }
      }, props || {});
      for (const fn of listeners[type] || []) fn(e);
      return e;
    }
  };
}

/** Load the extracted helpers in a fresh realm, optionally without PointerEvent. */
function loadHelpers({ pointerEvents = true } = {}) {
  const ctx = {
    Event: class { constructor(type, opts) { Object.assign(this, { type }, opts || {}); } }
  };
  if (pointerEvents) ctx.PointerEvent = function PointerEvent() {};
  vm.runInNewContext(snippet, ctx);
  assert.equal(typeof ctx.addTapListener, 'function', 'addTapListener should have been extracted');
  assert.equal(typeof ctx.submitCommentForm, 'function', 'submitCommentForm should have been extracted');
  return ctx;
}

test('addTapListener: a touch/pointer tap runs the handler once, and the click the browser synthesizes from it is swallowed', () => {
  const { addTapListener } = loadHelpers();
  const el = makeEl();
  let calls = 0;
  addTapListener(el, () => { calls++; });

  const up = el.fire('pointerup', { button: 0 });
  assert.equal(calls, 1);
  assert.equal(up.defaultPrevented, true);
  assert.equal(up.propagationStopped, true);

  // Same tap, second event: no duplicate handler run, but still swallowed so
  // GitHub's own handlers never see it either.
  const click = el.fire('click', { button: 0 });
  assert.equal(calls, 1, 'one tap must not run the handler twice');
  assert.equal(click.defaultPrevented, true);
  assert.equal(click.propagationStopped, true);
});

test('addTapListener: a plain click (mouse or keyboard activation) still runs the handler', () => {
  const { addTapListener } = loadHelpers();
  const el = makeEl();
  let calls = 0;
  addTapListener(el, () => { calls++; });
  el.fire('click', {});
  assert.equal(calls, 1);
});

test('addTapListener: successive pointer/touch activations are not de-duplicated', () => {
  const { addTapListener } = loadHelpers();
  const el = makeEl();
  let calls = 0;
  addTapListener(el, () => { calls++; });
  el.fire('pointerup', { button: 0 });
  el.fire('pointerup', { button: 0 });
  assert.equal(calls, 2, 'deliberate repeat taps must run the handler immediately');
});

test('addTapListener: secondary pointer buttons (right/middle click) are ignored and left alone', () => {
  const { addTapListener } = loadHelpers();
  const el = makeEl();
  let calls = 0;
  addTapListener(el, () => { calls++; });
  const e = el.fire('pointerup', { button: 2 });
  assert.equal(calls, 0);
  assert.equal(e.defaultPrevented, false);
});

test('addTapListener: falls back to touchend where PointerEvent is unimplemented', () => {
  const { addTapListener } = loadHelpers({ pointerEvents: false });
  const el = makeEl();
  let calls = 0;
  addTapListener(el, () => { calls++; });
  assert.equal(el.listeners.pointerup, undefined);
  el.fire('touchend', {});
  assert.equal(calls, 1);
  el.fire('click', {});
  assert.equal(calls, 1, 'the click synthesized from the same tap must not double-fire');
});

test('addTapListener: leaves nested native controls untouched when filtered out', () => {
  const { addTapListener } = loadHelpers();
  const el = makeEl();
  let calls = 0;
  addTapListener(el, () => { calls++; }, (e) => e.target !== 'checkbox');
  const pointer = el.fire('pointerup', { button: 0, target: 'checkbox' });
  const click = el.fire('click', { button: 0, target: 'checkbox' });
  assert.equal(calls, 0);
  assert.equal(pointer.defaultPrevented, false);
  assert.equal(click.defaultPrevented, false);
});

/** Textarea stub whose closest('form') resolves to `form` (or null). */
function makeTextarea(form) {
  return { value: '/lgtm', isConnected: true, closest: (sel) => (sel === 'form' ? form : null) };
}

test('submitCommentForm: dispatches a cancelable submit event, then requestSubmit() when nothing cancelled it', () => {
  const { submitCommentForm } = loadHelpers();
  const dispatched = [];
  let requestSubmits = 0;
  const form = {
    dispatchEvent(e) { dispatched.push(e); return true; },
    requestSubmit() { requestSubmits++; }
  };
  assert.equal(submitCommentForm(makeTextarea(form)), true);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].type, 'submit');
  assert.equal(dispatched[0].cancelable, true);
  assert.equal(dispatched[0].bubbles, true);
  assert.equal(requestSubmits, 1);
});

test('submitCommentForm: a cancelled submit event means GitHub took over — no second, native submit', () => {
  const { submitCommentForm } = loadHelpers();
  let requestSubmits = 0;
  const form = {
    dispatchEvent() { return false; }, // a listener called preventDefault()
    requestSubmit() { requestSubmits++; }
  };
  assert.equal(submitCommentForm(makeTextarea(form)), true);
  assert.equal(requestSubmits, 0, 'must not double-submit');
});

test('submitCommentForm: reports failure when the textarea has no owning form', () => {
  const { submitCommentForm } = loadHelpers();
  assert.equal(submitCommentForm(makeTextarea(null)), false);
});

test('submitCommentForm: uses native form.submit() when requestSubmit() is unavailable', () => {
  const { submitCommentForm } = loadHelpers();
  let submits = 0;
  const form = {
    dispatchEvent() { return true; },
    submit() { submits++; }
  };
  assert.equal(submitCommentForm(makeTextarea(form)), true);
  assert.equal(submits, 1);
});

test('submitCommentForm: reports failure when no native submit method exists', () => {
  const { submitCommentForm } = loadHelpers();
  const form = { dispatchEvent() { return true; } };
  assert.equal(submitCommentForm(makeTextarea(form)), false);
});

test('content-script action controls are bound through the touch-friendly addTapListener', () => {
  assert.match(contentJs, /addTapListener\(btn, \(\) => \{\s*\n\s*handleCommandClick\(command, context, btn\);/);
  assert.match(contentJs, /addTapListener\(cancelX, \(\) => \{\s*\n\s*cancelQueuedCommand\(cmdText, btn\);/);
  assert.match(contentJs, /addTapListener\(closeBtn, close\);/);
  assert.match(contentJs, /addTapListener\(icon, async \(\) => \{/);
  assert.match(contentJs, /addTapListener\(item, \(e\) => \{/);
  assert.match(contentJs, /addTapListener\(submitBtn, \(\) => \{/);
  assert.match(contentJs, /addTapListener\(postBtn, \(\) => \{/);
  assert.match(contentJs, /addTapListener\(refreshBtn, async \(\) => \{/);
});

test('submitPendingCombo falls back to form submission, gated on the comment still being unposted so it cannot double-post', () => {
  assert.match(contentJs, /if \(textarea\.isConnected && textarea\.value === finalText\) \{\s*\n\s*submitCommentForm\(textarea\);\s*\n\s*\}\s*\n\s*\}, SUBMIT_FALLBACK_DELAY_MS\);/);
  // …and when the submit button never showed up at all, submit the form directly.
  assert.match(contentJs, /\} else if \(submitCommentForm\(textarea\)\) \{\s*\n\s*showToast\(`Posted \$\{finalLines\.join\(' \+ '\)\}`, 'success'\);\s*\n\s*waitForPostToClear\(textarea, finalButtons, 20\);/);
});
