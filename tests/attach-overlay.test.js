'use strict';
// Unit tests for attachOverlay()'s stale-anchor handling.
//
// A dialog whose anchor button disappears or gets hidden while its job
// list is still being fetched (SPA re-injection replaces the command bar;
// the user collapses the section the anchor lives in) must not attach
// into a detached or display:none subtree — that renders an invisible
// dialog with dead buttons. It falls back to the command bar / body
// instead (same path as the keyboard shortcut).
//
// Same vm-sandbox approach as check-buttons-race.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');

const contentJs = fs.readFileSync(path.resolve(__dirname, '..', 'content.js'), 'utf8');

const startMarker = 'function attachOverlay(';
const endMarker = '\n  /**\n   * Show a self-dismissing toast notification.';
const startIdx = contentJs.indexOf(startMarker);
const endIdx = contentJs.indexOf(endMarker, startIdx);
assert.ok(startIdx !== -1 && endIdx !== -1,
  'expected to find attachOverlay() followed by showToast()');
const snippet = contentJs.slice(startIdx, endIdx);

function el(tagName, props = {}) {
  return {
    tagName,
    nodeType: 1,
    children: [],
    parentNode: null,
    className: '',
    // attachOverlay reads isConnected and offsetParent to decide whether
    // the anchor is still attached AND visible.
    isConnected: true,
    offsetParent: {},
    style: {},
    ...props,
    get parentElement() { return this.parentNode; },
    appendChild(child) { child.parentNode = this; this.children.push(child); },
    remove() {
      if (this.parentNode) {
        const i = this.parentNode.children.indexOf(this);
        if (i !== -1) this.parentNode.children.splice(i, 1);
      }
    },
    querySelector() { return null; }
  };
}

function buildSandbox({ anchor, bar } = {}) {
  const body = el('BODY');
  const document = {
    body,
    querySelector: sel => (sel === '.ghbcp-command-bar' ? (bar || null) : null)
  };
  const sandbox = { document };
  vm.runInNewContext(snippet, sandbox);
  return { sandbox, body };
}

test('attaches to the anchor parent when the anchor is connected and visible', () => {
  const anchorParent = el('DIV');
  const anchor = el('BUTTON');
  anchorParent.appendChild(anchor);
  const { sandbox } = buildSandbox({ anchor });
  const overlay = el('DIV');

  sandbox.attachOverlay(overlay, anchor);
  assert.equal(overlay.parentNode, anchorParent,
    'overlay should attach to the anchor parent');
  assert.equal(anchorParent.style.position, 'relative');
});

test('falls back to the command bar when the anchor is hidden (collapsed section)', () => {
  const anchorParent = el('DIV');
  const anchor = el('BUTTON');
  anchorParent.appendChild(anchor);
  anchor.offsetParent = null; // display:none subtree (collapsed section)
  const bar = el('DIV', { className: 'ghbcp-command-bar' });
  const { sandbox } = buildSandbox({ anchor, bar });
  const overlay = el('DIV');

  sandbox.attachOverlay(overlay, anchor);
  assert.equal(overlay.parentNode, bar,
    'a hidden anchor must fall back to the command bar');
  assert.equal(bar.style.position, 'relative');
});

test('falls back to the command bar when the anchor is detached (bar replaced by SPA re-inject)', () => {
  const anchorParent = el('DIV');
  const anchor = el('BUTTON');
  anchorParent.appendChild(anchor);
  anchor.isConnected = false; // removed from the document
  const bar = el('DIV', { className: 'ghbcp-command-bar' });
  const { sandbox } = buildSandbox({ anchor, bar });
  const overlay = el('DIV');

  sandbox.attachOverlay(overlay, anchor);
  assert.equal(overlay.parentNode, bar,
    'a detached anchor must fall back to the command bar');
});

test('falls back to body when there is no anchor and no command bar (keyboard shortcut)', () => {
  const { sandbox, body } = buildSandbox({});
  const overlay = el('DIV');

  sandbox.attachOverlay(overlay, null);
  assert.equal(overlay.parentNode, body,
    'the keyboard-shortcut path should attach to the body');
});
