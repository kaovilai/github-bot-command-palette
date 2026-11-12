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

  // Stand-in checks section + recording MutationObserver, for the
  // live-status-observer cases (non-rehearsal job sources).
  const checksSection = el('DIV');
  document.querySelector = sel => (sel === '#checks' ? checksSection : null);
  const observerInstances = [];
  class RecordingMutationObserver {
    constructor(callback) { this.callback = callback; this.disconnectCalls = 0; observerInstances.push(this); }
    observe() {}
    disconnect() { this.disconnectCalls++; }
  }

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

  // Branch fetches gate the same way and resolve null (the rate-limit/
  // offline failure that triggers the free-form popover fallback).
  const branchGates = [];
  const fetchRepoBranches = () => {
    let release;
    const gate = new Promise(res => { release = res; });
    branchGates.push({ release });
    return gate.then(() => null);
  };
  const popoverCalls = [];

  const sandbox = {
    document,
    fetchFullRehearsalJobs,
    scrapeRehearsalNames: () => JOBS,
    fetchRepoBranches,
    showInputPopover: (...args) => { popoverCalls.push(args); },
    scrapeCheckNames: () => [],
    addTapListener: () => {},
    addFocusTrap: () => {},
    attachOverlay: (overlay, btn) => { btn.parentNode.appendChild(overlay); },
    showToast: () => {},
    matchesJobSearch: name => true,
    requestAnimationFrame: () => {},
    setTimeout,
    clearTimeout,
    // Module-level state the dialog-generation guard reads/mutates. The
    // snippet's `++dialogGeneration` and `dialogGeneration !== generation`
    // resolve to this sandbox property.
    dialogGeneration: 0,
    MutationObserver: RecordingMutationObserver,
    checksSectionSelector: () => '#checks',
    // Referenced (short-circuit-protected) by the usePresubmits branch.
    lastPresubmitJobs: null,
    console: { error: () => {} }
  };
  vm.runInNewContext(snippet, sandbox);

  // Release the fetch gate of the i-th showTestJobPicker() call.
  const releaseCall = i => fetchGates[i].release();
  return { sandbox, anchorBtn, anchorParent, releaseCall, observerInstances, branchGates, popoverCalls };
}

function attachedPickers(anchorParent) {
  return anchorParent.children.filter(c => c.className === 'ghbcp-job-picker');
}

test('overlapping showTestJobPicker() calls: the newest request wins, the stale one bails', async () => {
  const { sandbox, anchorBtn, anchorParent, releaseCall } = buildSandbox();

  // First click parks on the rehearsal-list fetch; the second click lands
  // inside that await window (the interleaving a slow fetch + impatient
  // double-click produces) and claims the newer dialog generation. When the
  // stale first call then resumes it must bail without attaching; the newer
  // call attaches the one surviving picker.
  const first = sandbox.showTestJobPicker(COMMAND, {}, anchorBtn);
  const second = sandbox.showTestJobPicker(COMMAND, {}, anchorBtn);
  releaseCall(0);
  await first;
  assert.equal(attachedPickers(anchorParent).length, 0,
    'a superseded (stale) continuation must not attach its picker');

  releaseCall(1);
  await second;
  const pickers = attachedPickers(anchorParent);
  assert.equal(pickers.length, 1,
    `expected exactly one attached .ghbcp-job-picker, found ${pickers.length}`);
  assert.ok(pickers[0].children.length > 0,
    'the surviving picker should contain UI, not be empty');
});

test('a stale picker continuation must not close a newer dialog opened mid-fetch', async () => {
  const { sandbox, anchorBtn, anchorParent, releaseCall } = buildSandbox();

  // The user clicks Rehearse (slow fetch), then opens a newer dialog (an
  // input popover — modeled here by the generation bump showInputPopover
  // performs) while the fetch is still in flight. The stale continuation
  // must neither close that newer dialog nor attach on top of it.
  const stale = sandbox.showTestJobPicker(COMMAND, {}, anchorBtn);

  // Stand-in for the newer dialog: a picker element already attached, plus
  // the generation claim showInputPopover()/showPayloadPicker() make.
  const newer = sandbox.document.createElement('DIV');
  newer.className = 'ghbcp-job-picker';
  anchorParent.appendChild(newer);
  sandbox.dialogGeneration++;

  releaseCall(0);
  await stale;
  const pickers = attachedPickers(anchorParent);
  assert.equal(pickers.length, 1,
    'the stale continuation must not attach a second picker');
  assert.equal(pickers[0], newer,
    'the newer dialog must survive untouched (not closed, not replaced)');
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

test('replacing a checks-backed picker disconnects the old picker\'s live-status observer', async () => {
  const { sandbox, anchorBtn, anchorParent, observerInstances } = buildSandbox();
  // No jobSource: the picker scrapes check names and (unlike the rehearsals
  // source) attaches a live-status MutationObserver on the checks section.
  const cmd = { commandTemplate: '/test {input}', label: 'Test' };

  await sandbox.showTestJobPicker(cmd, {}, anchorBtn);
  assert.equal(observerInstances.length, 1,
    'a checks-backed picker should have created a live-status observer');
  const oldObserver = observerInstances[0];

  await sandbox.showTestJobPicker(cmd, {}, anchorBtn);
  assert.equal(observerInstances.length, 2,
    'the replacement picker gets its own observer');
  assert.ok(oldObserver.disconnectCalls >= 1,
    'closing the old picker through closeOpenDialogs() must disconnect its observer');
  assert.equal(observerInstances[1].disconnectCalls, 0,
    'the new picker\'s observer must still be live');
  assert.equal(attachedPickers(anchorParent).length, 1);
});

test('a failed branch fetch falls back to the input popover only when not superseded', async () => {
  const { sandbox, anchorBtn, branchGates, popoverCalls } = buildSandbox();
  const cmd = { commandTemplate: '/cherry-pick {input}', label: 'Cherry-pick', jobSource: 'branches' };

  // Superseded mid-fetch (the user opened a newer dialog, e.g. a CC User
  // popover): the failed branch fetch must NOT open the fallback popover —
  // that would close the newer dialog and discard its typed input.
  const stale = sandbox.showTestJobPicker(cmd, {}, anchorBtn);
  sandbox.dialogGeneration++;
  branchGates[0].release();
  await stale;
  assert.equal(popoverCalls.length, 0,
    'a superseded branch-fetch continuation must not open the fallback popover');

  // Not superseded: the free-form fallback still opens.
  const fresh = sandbox.showTestJobPicker(cmd, {}, anchorBtn);
  branchGates[1].release();
  await fresh;
  assert.equal(popoverCalls.length, 1,
    'an un-superseded failed branch fetch must still fall back to free-form input');
});

// Navigation must supersede pending dialog requests: a job-list fetch that
// started on the previous PR page must not attach its picker (and post its
// command) on the newly navigated PR. The listener wiring lives outside the
// showTestJobPicker() slice, so it gets its own small slice here.
{
  const navStart = contentJs.indexOf('function supersedeDialogsOnNavigation()');
  const navEndMarker = "window.addEventListener('hashchange', debouncedInject);";
  const navEnd = contentJs.indexOf(navEndMarker, navStart);
  assert.ok(navStart !== -1 && navEnd !== -1,
    'expected to find the navigation-supersession listener wiring');
  const navSnippet = contentJs.slice(navStart, navEnd + navEndMarker.length);

  test('navigation events supersede pending dialog requests', () => {
    const docListeners = {};
    const winListeners = {};
    const sandbox = {
      document: { addEventListener: (ev, fn) => { (docListeners[ev] ||= []).push(fn); } },
      window: { addEventListener: (ev, fn) => { (winListeners[ev] ||= []).push(fn); } },
      dialogGeneration: 0,
      debouncedInject: () => {}
    };
    vm.runInNewContext(navSnippet, sandbox);

    for (const ev of ['turbo:load', 'pjax:end']) {
      assert.ok(docListeners[ev] && docListeners[ev].length >= 1,
        `${ev} must be wired on document`);
    }
    assert.ok(winListeners['popstate'] && winListeners['popstate'].length >= 1,
      'popstate must be wired on window');

    // Each navigation event must bump on its own — a single combined
    // assertion would pass even if only one of the three were wired to
    // the supersession handler.
    for (const [listeners, ev] of [
      [docListeners, 'turbo:load'],
      [docListeners, 'pjax:end'],
      [winListeners, 'popstate']
    ]) {
      const before = sandbox.dialogGeneration;
      listeners[ev].forEach(fn => fn());
      assert.ok(sandbox.dialogGeneration > before,
        `${ev} must bump dialogGeneration on its own`);
    }

    // hashchange (same-page anchor jumps — the PR does not change) must
    // only schedule re-injection, never supersede dialogs.
    const afterNav = sandbox.dialogGeneration;
    (winListeners['hashchange'] || []).forEach(fn => fn());
    assert.equal(sandbox.dialogGeneration, afterNav,
      'hashchange must not supersede pending dialogs');
  });
}

// The 60s settings poll must not clobber a fresher inject-published config
// with its older snapshot (could re-enable autoSubmit against a mid-session
// settings change). Slice: the poll callback body.
{
  const pollStart = contentJs.indexOf("if (document.visibilityState !== 'visible') return;");
  const pollEnd = contentJs.indexOf('}, 60 * 1000);', pollStart);
  assert.ok(pollStart !== -1 && pollEnd !== -1,
    'expected to find the settings-poll callback');
  const pollSnippet = '(async () => {\n' + contentJs.slice(pollStart, pollEnd) + '\n})()';

  function pollSandbox({ bumpDuringRead, storedConfig }) {
    const state = { config: { tag: 'fresh-inject-config', globalSettings: { enabled: true, liveUpdates: false } } };
    const injectCalls = [];
    const sandbox = {
      document: { visibilityState: 'visible' },
      injectGeneration: 7,
      config: state.config,
      appliedLiveLogicVersion: null,
      liveLogic: {},
      CM: {
        getConfig: () => new Promise(resolve => {
          // An inject pass runs while the poll's read is in flight.
          if (bumpDuringRead) sandbox.injectGeneration++;
          resolve(storedConfig || { tag: 'older-poll-config', globalSettings: { enabled: true, liveUpdates: false } });
        })
      },
      refreshLiveLogic: () => Promise.resolve(false),
      debouncedInject: () => { injectCalls.push(1); }
    };
    return { sandbox, state, injectCalls };
  }

  test('settings poll assigns its read when no inject raced it', async () => {
    const { sandbox, injectCalls } = pollSandbox({ bumpDuringRead: false });
    await vm.runInNewContext(pollSnippet, sandbox);
    assert.equal(sandbox.config.tag, 'older-poll-config',
      'with no racing inject, the poll read is the freshest and should publish');
    assert.equal(injectCalls.length, 1,
      'a changed config must trigger a re-render (drop stale controls/shortcuts)');
  });

  test('settings poll re-renders on config change, not on unchanged config', async () => {
    const unchanged = { tag: 'fresh-inject-config', globalSettings: { enabled: true, liveUpdates: false } };
    const { sandbox, injectCalls } = pollSandbox({ bumpDuringRead: false, storedConfig: unchanged });
    await vm.runInNewContext(pollSnippet, sandbox);
    assert.equal(injectCalls.length, 0,
      'an unchanged config must not trigger a re-render every minute');
  });

  test('settings poll must not clobber a fresher inject-published config', async () => {
    const { sandbox, state } = pollSandbox({ bumpDuringRead: true });
    await vm.runInNewContext(pollSnippet, sandbox);
    assert.equal(sandbox.config.tag, 'fresh-inject-config',
      'an older poll snapshot must not overwrite the newer inject config');
    assert.equal(state.config.tag, 'fresh-inject-config');
  });
}
