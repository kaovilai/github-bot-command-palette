const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const contentJsPath = path.resolve(__dirname, '..', 'content.js');
const contentJs = fs.readFileSync(contentJsPath, 'utf8');

const popupJsPath = path.resolve(__dirname, '..', 'popup.js');
const popupJs = fs.readFileSync(popupJsPath, 'utf8');

test('content script adds accessibility attributes for injected picker and popover UI', () => {
  assert.match(contentJs, /picker\.setAttribute\('role', 'dialog'\)/);
  assert.match(contentJs, /picker\.setAttribute\('aria-label', 'Select CI jobs to run'\)/);
  assert.match(contentJs, /searchInput\.setAttribute\('aria-label', 'Search CI jobs'\)/);
  assert.match(contentJs, /cb\.setAttribute\('aria-label', `\$\{job\.name\} \(\$\{job\.status \|\| 'unknown'\}\)`\)/);
  assert.match(contentJs, /dot\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(contentJs, /popover\.setAttribute\('role', 'dialog'\)/);
  assert.match(contentJs, /popover\.setAttribute\('aria-label', command\.label \|\| command\.command \|\| 'Command input'\)/);
  assert.match(contentJs, /input\.setAttribute\('aria-label', command\.inputPlaceholder \|\| 'Enter value'\)/);
  assert.match(contentJs, /cancelBtn\.setAttribute\('aria-label', 'Cancel'\)/);
});

test('content script makes toast announcements available to assistive tech', () => {
  assert.match(contentJs, /toast\.setAttribute\('role', 'alert'\)/);
  assert.match(contentJs, /toast\.setAttribute\('aria-live', 'polite'\)/);
});

test('popup.js defines an esc() HTML escape helper', () => {
  assert.match(popupJs, /function esc\(str\)/);
  assert.match(popupJs, /d\.textContent/);
  assert.match(popupJs, /return d\.innerHTML/);
});

test('popup.js uses esc() when inserting profile names into innerHTML', () => {
  assert.match(popupJs, /\$\{esc\(p\.name\)\}/);
});

test('popup.js uses esc() when inserting command text into innerHTML', () => {
  assert.match(popupJs, /\$\{esc\(c\.command\)\}/);
});
