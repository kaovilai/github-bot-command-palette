'use strict';
// Regression tests for the duplicate Test/Override buttons bug.
//
// injectCheckButtons() is async with a network await (rehearsal job-name
// resolution) between its cleanup phase (remove old .ghbcp-check-btns, clear
// data-ghbcp-injected flags) and its render phase (append new button
// containers). Nothing serialized the calls, so a second trigger landing
// inside that await window — SPA navigation, the global MutationObserver, or
// the 150ms check-row-state repaint — cleaned up nothing (the first call
// hadn't rendered yet) and then both calls rendered, stacking two button
// sets on every check row.
//
// These tests extract the injectCheckButtons() block from content.js and run
// it in a vm sandbox (same approach as content-helpers.test.js) with a fake
// DOM plus a manually-released resolver promise, so the exact interleaving
// can be driven deterministically.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');

const contentJs = fs.readFileSync(path.resolve(__dirname, '..', 'content.js'), 'utf8');

// Slice from the observer/profile state lets through the end of
// injectCheckButtons(). The block is self-contained once the closure
// dependencies it references are provided as sandbox globals.
const startMarker = 'let checkRowStateObserver = null;';
const endMarker = '\n  /**\n   * Inject a compact approve/LGTM toolbar';
const startIdx = contentJs.indexOf(startMarker);
const endIdx = contentJs.indexOf(endMarker, startIdx);
assert.ok(startIdx !== -1 && endIdx !== -1,
  'expected to find the injectCheckButtons() block between its state lets and injectReviewToolbar()');
const snippet = contentJs.slice(startIdx, endIdx);

const CHECK_NAME = 'ci/rehearse/org/repo/branch/pull-ci-org-repo-branch-unit';

/**
 * Build a fake DOM with one failed rehearsal check row, plus the sandbox of
 * closure stubs injectCheckButtons() needs. Returns the sandbox and handles
 * for driving the race.
 */
function buildSandbox() {
  // Registry of live elements so the cleanup phase's class-based
  // querySelectorAll sweeps can find injected button containers.
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
      href: undefined,
      ...props,
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
      closest() { return null; }
    };
    liveEls.add(node);
    return node;
  }

  const nameSpan = el('SPAN', { textContent: CHECK_NAME });
  const detailsLink = el('A', { href: 'https://github.com/org/repo/pull/1' });
  nameSpan.closest = () => detailsLink;

  const row = el('LI', { textContent: CHECK_NAME });
  row.querySelector = sel => (sel === 'h4 a span' ? nameSpan : null);

  const checksSection = el('DIV');
  checksSection.querySelectorAll = sel => (sel === 'li[aria-label]' ? [row] : []);

  const document = {
    createElement: tag => el(tag.toUpperCase()),
    querySelector: sel => (sel === '[data-checks]' ? checksSection : null),
    querySelectorAll: sel => {
      if (sel === '.ghbcp-check-btns') return [...liveEls].filter(e => e.className === 'ghbcp-check-btns');
      if (sel === '[data-ghbcp-injected]') return [...liveEls].filter(e => e.dataset.ghbcpInjected);
      return [];
    }
  };

  // Manually-released per-call gates standing in for the network round trip
  // inside resolveRehearsalJobNames() — the window in which overlapping
  // calls race. Each injectCheckButtons() call parks on its own gate, so
  // tests can order the resumes (e.g. let the newer pass finish rendering
  // before the stale one wakes up).
  const resolverGates = [];
  const resolveRehearsalJobNames = names => {
    let release;
    const gate = new Promise(res => { release = res; });
    resolverGates.push({ names, release });
    return gate.then(() => new Map(names.map(n => [n, { jobName: 'pull-ci-org-repo-branch-unit' }])));
  };

  const sandbox = {
    document,
    resolveRehearsalJobNames,
    observeCheckRowStates: () => {},
    checksSectionSelector: () => '[data-checks]',
    legacyCheckRowSelector: () => '.legacy-check-row',
    getCheckStatus: () => 'failed',
    getCheckOverriddenBy: () => null,
    matchPresubmitJob: () => null,
    isProwManagedCheck: () => true,
    isProwViewUrl: () => false,
    buildFailedStepLogIcon: () => el('BUTTON'),
    createButton: () => el('BUTTON', { className: 'ghbcp-btn' }),
    createRehearsalHintButton: () => el('BUTTON'),
    createRerunActionButton: () => el('BUTTON'),
    getPRNumber: () => 1,
    currentRepo: 'org/repo',
    config: { globalSettings: { showOnlyFailedTests: true } },
    CM: { isContextValid: () => true, getOverrideContext: n => n },
    clearTimeout,
    setTimeout,
    console: { error: () => {} }
  };
  vm.runInNewContext(snippet, sandbox);

  // Release the resolver gate of the i-th injectCheckButtons() call.
  const releaseCall = i => resolverGates[i].release();
  return { sandbox, row, releaseCall };
}

const PROFILES = [{ checkCommands: [{}] }];

function buttonSetsOn(row) {
  return row.children.filter(c => c.className === 'ghbcp-check-btns');
}

test('overlapping injectCheckButtons() calls render buttons exactly once', async () => {
  const { sandbox, row, releaseCall } = buildSandbox();

  // First pass: runs cleanup + collection synchronously, then parks on the
  // rehearsal resolver. Second pass starts inside that await window — the
  // interleaving produced by SPA navigation / MutationObserver re-triggers.
  const first = sandbox.injectCheckButtons(PROFILES);
  const second = sandbox.injectCheckButtons(PROFILES);
  releaseCall(0);
  releaseCall(1);
  await Promise.all([first, second]);

  const sets = buttonSetsOn(row);
  assert.equal(sets.length, 1,
    `expected exactly one .ghbcp-check-btns per check row, found ${sets.length}`);
  assert.ok(sets[0].children.length > 0, 'the surviving set should contain buttons, not be empty');
});

test('a stale pass must not render on top of a completed newer pass', async () => {
  const { sandbox, row, releaseCall } = buildSandbox();

  // Older pass parks on its resolver gate; newer pass starts, its gate is
  // released, and it fully renders BEFORE the stale pass wakes up.
  const stale = sandbox.injectCheckButtons(PROFILES);
  const fresh = sandbox.injectCheckButtons(PROFILES);
  releaseCall(1);
  await fresh;
  assert.equal(buttonSetsOn(row).length, 1,
    'newer pass should have rendered its button set');

  // Now the stale pass resumes after the newer one already rendered — it
  // must bail on its stale generation instead of stacking a second set.
  releaseCall(0);
  await stale;
  const sets = buttonSetsOn(row);
  assert.equal(sets.length, 1);
});

test('sequential (non-overlapping) injectCheckButtons() calls still refresh cleanly', async () => {
  const { sandbox, row, releaseCall } = buildSandbox();

  const first = sandbox.injectCheckButtons(PROFILES);
  releaseCall(0);
  await first;
  assert.equal(buttonSetsOn(row).length, 1);

  // A second pass after the first fully completed must replace, not stack.
  const second = sandbox.injectCheckButtons(PROFILES);
  releaseCall(1);
  await second;
  const sets = buttonSetsOn(row);
  assert.equal(sets.length, 1);
  assert.ok(sets[0].children.length > 0);
});
