'use strict';
// Source-shape assertions for the Theme setting: it must actually do
// something. The select offered auto/light/dark, but both extension pages
// (settings.html, popup.html) hardcoded prefers-color-scheme, so Light and
// Dark were placebos. The setting now sets data-theme on <html>, and both
// pages carry html[data-theme=…] variable blocks that outrank the media
// query.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const settingsJs = fs.readFileSync(path.resolve(__dirname, '..', 'settings.js'), 'utf8');
const popupJs = fs.readFileSync(path.resolve(__dirname, '..', 'popup.js'), 'utf8');
const settingsHtml = fs.readFileSync(path.resolve(__dirname, '..', 'settings.html'), 'utf8');
const popupHtml = fs.readFileSync(path.resolve(__dirname, '..', 'popup.html'), 'utf8');

test('settings page applies the Theme setting and follows its own changes live', () => {
  assert.match(settingsJs, /function applyThemeSetting\(theme\)/);
  // 'auto' (or junk) must clear the attribute, not set data-theme="auto".
  assert.match(settingsJs, /delete document\.documentElement\.dataset\.theme/);
  // Applied both on initial render and on every autosave (live preview).
  const renderCalls = settingsJs.match(/applyThemeSetting\(/g) || [];
  assert.ok(renderCalls.length >= 3,
    `expected applyThemeSetting() called at init, in renderGlobalSettings, and in the save path; found ${renderCalls.length}`);
});

test('popup applies the stored Theme setting at load', () => {
  assert.match(popupJs, /document\.documentElement\.dataset\.theme = value/);
  assert.match(popupJs, /delete document\.documentElement\.dataset\.theme/);
});

test('both extension pages carry data-theme CSS overrides that beat the OS preference', () => {
  for (const [name, html] of [['settings.html', settingsHtml], ['popup.html', popupHtml]]) {
    assert.ok(/html\[data-theme='dark'\]/.test(html), `${name} needs a dark data-theme override`);
    assert.ok(/html\[data-theme='light'\]/.test(html), `${name} needs a light data-theme override`);
    // The overrides must come after (or at least duplicate) the media query's
    // dark values — a light override listing dark values would be a bug.
    const lightBlock = html.match(/html\[data-theme='light'\]\s*\{([^}]*)\}/)[1];
    assert.ok(/--bg:\s*#ffffff/.test(lightBlock), `${name} light override must set the light --bg`);
    const darkBlock = html.match(/html\[data-theme='dark'\]\s*\{([^}]*)\}/)[1];
    assert.ok(/--bg:\s*#0d1117/.test(darkBlock), `${name} dark override must set the dark --bg`);
  }
});
