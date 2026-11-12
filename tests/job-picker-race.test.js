'use strict';
// Regression tests for the double job-picker bug.
//
// showTestJobPicker() called closeOpenDialogs() at its very top, then awaited
// fetchFullRehearsalJobs()/fetchRepoBranches() (network round trips through
// the background worker) before creating and attaching the picker. A second
// click landing inside that await window also found nothing to close (the
// first picker wasn't in the DOM yet), so both calls attached their pickers.
// Both are absolutely positioned on the same anchor parent (top:100%;
// left:0), so they overlap pixel-perfectly and look like one dialog — until
// search filtering shrinks the top (focused) one and reveals the stale
// full-list picker underneath: "two windows" while typing in the search box.
//
// These tests extract showTestJobPicker() plus the dialog-close helpers from
// content.js and run them in a vm sandbox (same approach as
// check-buttons-race.test.js) with a fake DOM and a manually-released
// fetch gate, so the exact interleaving can be driven deterministically.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');

const contentJs = fs.readFileSync(path.resolve(__dirname, '..', 'content.js'), 'utf8');

// Slice 1: showTestJobPicker(), from its declaration to the JSDoc of the
// next function (shouldConfirm).
const pickerStart = contentJs.indexOf('async function showTestJobPicker(');
const pickerEnd = contentJs.indexOf('\n  /**\n   * Returns true when the user should be prompted', pickerStart);
assert.ok(pickerStart !== -1 && pickerEnd !== -1,
  'expected to find showTestJobPicker() followed by shouldConfirm()');

// Slice 2: createDialogCloser/closeExistingDialog/closeOpenDialogs, up to
// the PAYLOAD_FORMS comment that follows them.
const closerStart = contentJs.indexOf('function createDialogCloser(');
const closerEnd = contentJs.indexOf('\n  // Field layout per payload command', closerStart);
assert.ok(closerStart !== -1 && closerEnd !== -1,
  'expected to find the dialog-closer helpers followed by the payload-forms table');

const snippet = contentJs.slice(pickerStart, pickerEnd) + '\n' +
  contentJs.slice(closerStart, closerEnd);

const JOBS = [
  { name: 'pull-ci-org-repo-branch-unit', status: 'failed' },
  { name: 'pull-ci-org-repo-branch-e2e', status: 'pending' }
];

const COMMAND = {
  commandTemplate: '/pj-rehearse {input}',
  label: 'Rehearse',
  jobSource: 'rehearsals'
};

/**
 * Build a fake DOM (one anchor button with a parent container) plus the
 * sandbox of closure stubs showTestJobPicker() needs. Returns the sandbox
 * and handles for driving the fetch race.
 */
function buildSandbox() {
  // Registry of live elements so closeExistingDialog()'s class-based
  // querySelectorAll sweeps can find attached pickers.
  const liveEls = new Set();

  function el(tagName, props = {}) {
    const node = {
      tagName,
      nodeType: 1,
      children: [],
      parentNode: null,
      className: '',
      dataset: {},
      textContent: '',
      innerHTML: '',
      hidden: false,
      disabled: false,
      checked: false,
      title: '',
      type: '',
      placeholder: '',
      ...props,
      style: {},
      classList: {
        add: c => { node.className += (node.className ? ' ' : '') + c; },
        remove: c => {
          node.className = String(node.className)
            .split(/\s+/).filter(x => x !== c).join(' ');
        }
      },
      appendChild(child) { child.parentNode = node; node.children.push(child); },
      remove() {
        liveEls.delete(node);
        if (node.parentNode) {
          const i = node.parentNode.children.indexOf(node);
          if (i !== -1) node.parentNode.children.splice(i, 1);
        }
      },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      matches() { return false; },
      closest() { return null; },
      contains() { return false; },
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() { return true; },
      setAttribute() {},
      focus() {}
    };
    liveEls.add(node);
    return node;
  }

  const anchorBtn = el('BUTTON');
  const anchorParent = el('DIV');
  anchorParent.appendChild(anchorBtn);

  const document = {
    createElement: tag => el(tag.toUpperCase()),
    createTextNode: text => ({ nodeType: 3, textContent: text, parentNode: null }),
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
    activeElement: null,
    body: el('BODY')
  };
  // Real document.querySelectorAll only returns connected elements — a
  // picker built but not yet attached (between creation and attachOverlay)
  // must NOT match, or closeOpenDialogs() would close its own dialog.
  // Model that: only elements whose parentNode chain reaches document.body,
  // with the anchor parent rooted in a fake page body like a real page.
  document.body.appendChild(anchorParent);
  const isAttached = node => {
    for (let n = node; n; n = n.parentNode) {
      if (n === document.body) return true;
    }
    return false;
  };
  document.querySelectorAll = sel =>
    [...liveEls].filter(e => e.className === sel.replace(/^\./, '') && isAttached(e));

  // Manually-released per-call gates standing in for the network round trip
  // inside fetchFullRehearsalJobs() — the window in which a second click
  // races the first. Each showTestJobPicker() call parks on its own gate.
  const fetchGates = [];
  const fetchFullRehearsalJobs = () => {
    let release;
    const gate = new Promise(res => { release = res; });
    fetchGates.push({ release });
    return gate.then(() => JOBS);
  };

  const sandbox = {
    document,
    fetchFullRehearsalJobs,
    scrapeRehearsalNames: () => JOBS,
    fetchRepoBranches: () => Promise.resolve([]),
    showInputPopover: () => {},
    scrapeCheckNames: () => [],
    addTapListener: () => {},
    addFocusTrap: () => {},
    attachOverlay: (overlay, btn) => { btn.parentNode.appendChild(overlay); },
    showToast: () => {},
    matchesJobSearch: name => true,
    requestAnimationFrame: () => {},
    setTimeout,
    clearTimeout,
    console: { error: () => {} }
  };
  vm.runInNewContext(snippet, sandbox);

  // Release the fetch gate of the i-th showTestJobPicker() call.
  const releaseCall = i => fetchGates[i].release();
  return { sandbox, anchorBtn, anchorParent, releaseCall };
}

function attachedPickers(anchorParent) {
  return anchorParent.children.filter(c => c.className === 'ghbcp-job-picker');
}

test('overlapping showTestJobPicker() calls attach exactly one picker', async () => {
  const { sandbox, anchorBtn, anchorParent, releaseCall } = buildSandbox();

  // First click parks on the rehearsal-list fetch; the second click lands
  // inside that await window (the interleaving a slow fetch + impatient
  // double-click produces). The first picker attaches, then the second call
  // resumes — it must close the first picker before attaching its own.
  const first = sandbox.showTestJobPicker(COMMAND, {}, anchorBtn);
  const second = sandbox.showTestJobPicker(COMMAND, {}, anchorBtn);
  releaseCall(0);
  await first;
  assert.equal(attachedPickers(anchorParent).length, 1,
    'first call should have attached its picker');

  releaseCall(1);
  await second;
  const pickers = attachedPickers(anchorParent);
  assert.equal(pickers.length, 1,
    `expected exactly one attached .ghbcp-job-picker, found ${pickers.length}`);
  assert.ok(pickers[0].children.length > 0,
    'the surviving picker should contain UI, not be empty');
});

test('both calls attaching after the fetch still leave one picker', async () => {
  const { sandbox, anchorBtn, anchorParent, releaseCall } = buildSandbox();

  // Variant interleaving: both gates released back-to-back before either
  // continuation runs. The first attaches, the second must sweep it.
  const first = sandbox.showTestJobPicker(COMMAND, {}, anchorBtn);
  const second = sandbox.showTestJobPicker(COMMAND, {}, anchorBtn);
  releaseCall(0);
  releaseCall(1);
  await Promise.all([first, second]);

  assert.equal(attachedPickers(anchorParent).length, 1);
});

test('sequential (non-overlapping) showTestJobPicker() calls replace, not stack', async () => {
  const { sandbox, anchorBtn, anchorParent, releaseCall } = buildSandbox();

  const first = sandbox.showTestJobPicker(COMMAND, {}, anchorBtn);
  releaseCall(0);
  await first;
  assert.equal(attachedPickers(anchorParent).length, 1);

  const second = sandbox.showTestJobPicker(COMMAND, {}, anchorBtn);
  releaseCall(1);
  await second;
  assert.equal(attachedPickers(anchorParent).length, 1);
});

test('closeExistingDialog() removes every stacked picker, not just the first', () => {
  const { sandbox, anchorParent } = buildSandbox();

  // Simulate pre-existing stacking (e.g. from an older race): two picker
  // elements in the anchor parent without registered close functions, so
  // the fallback element-removal path runs for each.
  const document = sandbox.document;
  for (let i = 0; i < 2; i++) {
    const stale = document.createElement('DIV');
    stale.className = 'ghbcp-job-picker';
    anchorParent.appendChild(stale);
  }
  assert.equal(attachedPickers(anchorParent).length, 2);

  sandbox.closeOpenDialogs();
  assert.equal(attachedPickers(anchorParent).length, 0,
    'all stacked pickers should have been swept');
});
