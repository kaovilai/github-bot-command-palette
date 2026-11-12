'use strict';
// Regression tests for collapsible command-bar sections.
//
// createCommandGroup() renders each section with a one-click collapse toggle
// (chevron + label button). The collapsed state persists across sessions via
// CM.setCollapsedGroups() under the group's stable key (profile id, or
// 'repo-overrides'), and every bar on the page that shows the same group key
// toggles in lockstep.
//
// Same vm-sandbox approach as check-buttons-race.test.js: the
// createCommandGroup() block is extracted from content.js and run against a
// fake DOM, with addTapListener stubbed to capture (not fire) handlers so
// tests can invoke the toggle deterministically.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');

const contentJs = fs.readFileSync(path.resolve(__dirname, '..', 'content.js'), 'utf8');

const startMarker = 'function createCommandGroup(';
const endMarker = '\n  /**\n   * Build the bar\'s utility row';
const startIdx = contentJs.indexOf(startMarker);
const endIdx = contentJs.indexOf(endMarker, startIdx);
assert.ok(startIdx !== -1 && endIdx !== -1,
  'expected to find createCommandGroup() followed by buildBarHeader()');
const snippet = contentJs.slice(startIdx, endIdx);

/**
 * Build a fake DOM plus the sandbox of closure stubs createCommandGroup()
 * needs. `collapsed` seeds the remembered-collapse set (the module state
 * inject() loads from storage).
 */
function buildSandbox(collapsed = []) {
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
      type: '',
      ...props,
      style: {},
      classList: {
        add: c => { if (!node.className.split(/\s+/).includes(c)) node.className += (node.className ? ' ' : '') + c; },
        remove: c => { node.className = node.className.split(/\s+/).filter(x => x !== c).join(' '); },
        contains: c => node.className.split(/\s+/).includes(c),
        toggle: (c, force) => {
          const want = force === undefined ? !node.className.split(/\s+/).includes(c) : force;
          if (want) node.classList.add(c); else node.classList.remove(c);
          return want;
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
      querySelector(sel) {
        return node.children.find(c => c.matches(sel)) || null;
      },
      querySelectorAll(sel) {
        return node.children.filter(c => c.matches(sel));
      },
      matches(sel) {
        // Support the selectors createCommandGroup and the tests use:
        // '.ghbcp-group-toggle', '.ghbcp-cmd-group[data-group-key="..."]'.
        const classMatch = sel.match(/^\.([\w-]+)$/);
        if (classMatch) return node.className.split(/\s+/).includes(classMatch[1]);
        const attrMatch = sel.match(/^\.([\w-]+)\[data-group-key="(.*)"\]$/);
        if (attrMatch) {
          return node.className.split(/\s+/).includes(attrMatch[1]) &&
            node.dataset.groupKey === attrMatch[2];
        }
        return false;
      },
      closest() { return null; },
      contains() { return false; },
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() { return true; },
      setAttribute(name, value) { node['attr:' + name] = String(value); },
      getAttribute(name) { return node['attr:' + name]; },
      focus() {}
    };
    liveEls.add(node);
    return node;
  }

  const document = {
    createElement: tag => el(tag.toUpperCase()),
    createDocumentFragment: () => el('#fragment'),
    // The toggle handler syncs every group sharing the key across all bars.
    querySelectorAll: sel => [...liveEls].filter(x => x.matches(sel)),
    querySelector: () => null
  };

  const savedCalls = [];
  const closeDialogCalls = [];
  const sandbox = {
    document,
    _ghbcpGroupIdCounter: 0,
    collapsedGroupKeys: new Set(collapsed),
    currentRepo: 'org/repo',
    getPRNumber: () => 1,
    createButton: () => el('BUTTON', { className: 'ghbcp-btn' }),
    addTapListener: (elm, handler) => { elm._tapHandler = handler; },
    CM: {
      setGroupCollapsed: (key, isCollapsed) => {
        savedCalls.push({ key, collapsed: isCollapsed });
        return Promise.resolve();
      }
    },
    CSS: { escape: s => s },
    closeOpenDialogs: () => { closeDialogCalls.push(1); },
    console: { error: () => {} }
  };
  vm.runInNewContext(snippet, sandbox);
  return { sandbox, document, savedCalls, closeDialogCalls };
}

function toggleButtonOf(group) {
  const toggle = group.children.find(c => c.className === 'ghbcp-group-toggle');
  assert.ok(toggle, 'group should contain a toggle button');
  return toggle;
}

function btnWrapOf(group) {
  return group.children.find(c => c.className === 'ghbcp-btn-wrap');
}

test('group renders a labelled collapse toggle, expanded by default', () => {
  const { sandbox } = buildSandbox();
  const group = sandbox.createCommandGroup('OpenShift Payload Testing', [{ command: '/payload' }], 'profile-payload-openshift');
  const toggle = toggleButtonOf(group);

  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(group.classList.contains('ghbcp-collapsed'), false);
  assert.ok(btnWrapOf(group), 'button wrap should exist');
  assert.ok(toggle.getAttribute('aria-controls'), 'toggle should reference the wrap id');
  const label = toggle.children.find(c => c.className === 'ghbcp-group-label');
  assert.equal(label.textContent, 'OpenShift Payload Testing');
  const chevron = toggle.children.find(c => c.className === 'ghbcp-group-chevron');
  assert.ok(chevron, 'chevron should exist');
  assert.equal(chevron.getAttribute('aria-hidden'), 'true');
});

test('a remembered key renders the group collapsed', () => {
  const { sandbox } = buildSandbox(['profile-payload-openshift']);
  const group = sandbox.createCommandGroup('OpenShift Payload Testing', [{ command: '/payload' }], 'profile-payload-openshift');
  assert.equal(group.classList.contains('ghbcp-collapsed'), true);
  assert.equal(toggleButtonOf(group).getAttribute('aria-expanded'), 'false');
});

test('clicking the toggle collapses, persists, and undoes on the next click', () => {
  const { sandbox, savedCalls, closeDialogCalls } = buildSandbox();
  const group = sandbox.createCommandGroup('OpenShift Payload Testing', [{ command: '/payload' }], 'profile-payload-openshift');
  const toggle = toggleButtonOf(group);

  toggle._tapHandler();
  assert.equal(group.classList.contains('ghbcp-collapsed'), true, 'first click collapses');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.deepEqual(savedCalls.at(-1), { key: 'profile-payload-openshift', collapsed: true },
    'collapse persisted for this group key only');
  assert.equal(closeDialogCalls.length, 1,
    'collapsing a section must close any dialog anchored inside it');

  toggle._tapHandler();
  assert.equal(group.classList.contains('ghbcp-collapsed'), false, 'second click expands');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(savedCalls.at(-1), { key: 'profile-payload-openshift', collapsed: false },
    'expand cleared this group key only');
  assert.equal(closeDialogCalls.length, 1,
    'expanding must not close dialogs');
});

test('toggling one group syncs every bar showing the same key', () => {
  const { sandbox } = buildSandbox();
  const bar1 = sandbox.createCommandGroup('OpenShift Payload Testing', [{ command: '/payload' }], 'profile-payload-openshift');
  const bar2 = sandbox.createCommandGroup('OpenShift Payload Testing', [{ command: '/payload' }], 'profile-payload-openshift');
  const other = sandbox.createCommandGroup('Tide/Prow — Universal', [{ command: '/lgtm' }], 'profile-tide-prow-universal');

  toggleButtonOf(bar1)._tapHandler();
  assert.equal(bar1.classList.contains('ghbcp-collapsed'), true);
  assert.equal(bar2.classList.contains('ghbcp-collapsed'), true,
    'the same group in another bar must collapse in lockstep');
  assert.equal(other.classList.contains('ghbcp-collapsed'), false,
    'groups with other keys must be untouched');
  assert.equal(toggleButtonOf(bar2).getAttribute('aria-expanded'), 'false');
});

test('groups without a key have no collapse behavior', () => {
  const { sandbox, savedCalls } = buildSandbox();
  const group = sandbox.createCommandGroup('Anonymous', [{ command: '/x' }]);
  const toggle = toggleButtonOf(group);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  // No key → no toggle handler was ever attached and nothing persists.
  assert.equal(toggle._tapHandler, undefined);
  assert.equal(savedCalls.length, 0);
});
