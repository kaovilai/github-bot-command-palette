'use strict';
// Guards the self-hosted auto-update chain (see updates.xml + manifest.json):
//
//   manifest.json "key"      → stable extension ID for every install type
//   manifest.json "update_url" → hosted updates.xml
//   updates.xml <app appid>  → must equal the ID that key produces
//   updates.xml @version     → must equal manifest.json "version"
//   updates.xml @codebase    → the release-latest signed CRX
//
// A drift here fails silently in production: chrome (and chromium-web-store)
// would fetch the manifest and either ignore it (appid mismatch) or never see
// a newer version, so users would stop receiving updates with no error.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'manifest.json'), 'utf8'));
const updatesXml = fs.readFileSync(path.resolve(__dirname, '..', 'updates.xml'), 'utf8');

const CRX_URL = 'https://github.com/kaovilai/github-bot-command-palette/releases/latest/download/github-bot-command-palette.crx';
const UPDATE_XML_URL = 'https://raw.githubusercontent.com/kaovilai/github-bot-command-palette/main/updates.xml';

/** Chrome's ID: SHA-256 of the DER public key, first 16 bytes, nibbles → a-p. */
function extensionIdFromKey(base64Key) {
  const digest = crypto.createHash('sha256').update(Buffer.from(base64Key, 'base64')).digest();
  return [...digest.subarray(0, 16)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .split('')
    .map(c => String.fromCharCode(97 + parseInt(c, 16)))
    .join('');
}

// Scope attribute lookups to the element we care about — `version='1.0'` in
// the <?xml?> declaration would otherwise shadow <updatecheck version>.
const updatecheck = (/<updatecheck\b[^>]*>/.exec(updatesXml) || [''])[0];
const attr = (name, source = updatesXml) => {
  const m = new RegExp(`${name}=['"]([^'"]+)['"]`).exec(source);
  return m ? m[1] : null;
};

test('manifest declares a public key so every install shares one extension ID', () => {
  assert.equal(typeof manifest.key, 'string', 'manifest.json must carry "key"');
  assert.match(manifest.key, /^[A-Za-z0-9+/=]+$/, '"key" must be base64');
  assert.equal(extensionIdFromKey(manifest.key), 'ekdbcflnjpkfmcabblkkkojmeecjojeh',
    'extension ID changed — regenerate updates.xml appid and update the docs');
});

test('manifest points update_url at the hosted update manifest', () => {
  assert.equal(manifest.update_url, UPDATE_XML_URL,
    'update_url must be the raw updates.xml URL users\' browsers fetch');
});

test('updates.xml appid matches the ID derived from manifest key', () => {
  assert.equal(attr('appid'), extensionIdFromKey(manifest.key));
});

test('updates.xml version matches manifest.json version', () => {
  // Drift = users never see the release: the updater compares this version
  // against what is installed.
  assert.equal(attr('version', updatecheck), manifest.version,
    'bump updates.xml @version in the same commit as manifest.json "version"');
});

test('updates.xml serves the release-latest signed CRX', () => {
  assert.equal(attr('codebase', updatecheck), CRX_URL);
  assert.equal(attr('status', updatecheck), 'ok');
});

test('manifest version is a valid Chrome extension version', () => {
  // 1-4 dot-separated integers, 0-65535 each.
  assert.match(manifest.version, /^\d+(\.\d+){0,3}$/);
  for (const part of manifest.version.split('.')) {
    const n = Number(part);
    assert.ok(Number.isInteger(n) && n >= 0 && n <= 65535, `version segment out of range: ${part}`);
  }
});
