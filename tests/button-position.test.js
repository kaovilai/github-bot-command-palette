'use strict';
// Source-shape assertions for the Button Position setting: it must actually
// do something. The select historically offered "Floating" and "Inline with
// checks" options that were never implemented — the bar was always injected
// above the comment box regardless — so the UI now offers only the two
// positions content.js really honors (above / below the comment box).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const contentJs = fs.readFileSync(path.resolve(__dirname, '..', 'content.js'), 'utf8');
const settingsJs = fs.readFileSync(path.resolve(__dirname, '..', 'settings.js'), 'utf8');
const settingsHtml = fs.readFileSync(path.resolve(__dirname, '..', 'settings.html'), 'utf8');

test('injectGlobalCommandBar honors the below-comment-box position', () => {
  assert.match(contentJs, /config\.globalSettings\.buttonPosition === 'below-comment-box'/);
  // Below = a sibling after the comment form container, not inside it, so the
  // bar never participates in the form's own layout.
  assert.match(contentJs, /container\.parentElement\.insertBefore\(bar, container\.nextSibling\)/);
  // Above (default) keeps the historical firstChild insertion.
  assert.match(contentJs, /container\.insertBefore\(bar, container\.firstChild\)/);
});

test('settings only offers button positions content.js implements', () => {
  assert.match(settingsHtml, /value="above-comment-box">Above comment box</);
  assert.match(settingsHtml, /value="below-comment-box">Below comment box</);
  // The never-implemented placebo options must not come back.
  assert.doesNotMatch(settingsHtml, /value="floating"/);
  assert.doesNotMatch(settingsHtml, /value="inline-checks"/);
});

test('settings normalizes unimplemented stored positions to the default', () => {
  // A stored 'floating'/'inline-checks' (or any junk) must not leave the
  // select blank — a blank value would be saved back as '' on the next
  // unrelated settings change.
  assert.match(settingsJs,
    /gs\.buttonPosition === 'below-comment-box' \? 'below-comment-box' : 'above-comment-box'/);
});
