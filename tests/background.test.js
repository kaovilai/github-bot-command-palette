'use strict';
// Unit tests for pure functions in background.js.
// These tests run entirely in Node — no browser or extension APIs needed.

const test = require('node:test');
const assert = require('node:assert/strict');

// ── Load js-yaml from the vendored IIFE bundle ───────────────────────────────
// The vendor bundle sets `var jsyaml = (...)()` — we run it in a vm context
// so the global is captured, then pass it to the background.js context.
const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');

const jsyamlSrc = fs.readFileSync(path.resolve(__dirname, '..', 'vendor', 'js-yaml.min.js'), 'utf8');
const jsyamlCtx = vm.createContext({});
vm.runInContext(jsyamlSrc, jsyamlCtx);
const jsyaml = jsyamlCtx.jsyaml;

// ── Extract the two pure functions under test ─────────────────────────────────
const backgroundSrc = fs.readFileSync(path.resolve(__dirname, '..', 'background.js'), 'utf8');

// Strip the chrome runtime listener and importScripts so Node can eval the rest
const stripped = backgroundSrc
  .replace(/importScripts\([^)]*\);?/g, '')
  .replace(/chrome\.runtime\.onMessage\.addListener[\s\S]*?\}\);/, '');

const ctx = { jsyaml, console };
vm.runInNewContext(stripped, ctx);

const { extractPlugins, buildConfigFileUrl } = ctx;

// ── extractPlugins ────────────────────────────────────────────────────────────

test('extractPlugins: empty YAML returns []', () => {
  const result = extractPlugins('', 'org/repo', 'org');
  assert.equal(result.length, 0);
});

test('extractPlugins: repo not in config returns []', () => {
  const yaml = 'plugins:\n  other/repo:\n    - approve\n';
  const result = extractPlugins(yaml, 'org/repo', 'org');
  assert.equal(result.length, 0);
});

test('extractPlugins: repo-level match (list format)', () => {
  const yaml = 'plugins:\n  org/repo:\n    - approve\n    - lgtm\n';
  const result = extractPlugins(yaml, 'org/repo', 'org');
  assert.ok(result.includes('approve'));
  assert.ok(result.includes('lgtm'));
});

test('extractPlugins: org-level fallback when repo key absent', () => {
  const yaml = 'plugins:\n  org:\n    - hold\n';
  const result = extractPlugins(yaml, 'org/repo', 'org');
  assert.ok(result.includes('hold'));
});

test('extractPlugins: nested object format (plugins.plugins)', () => {
  const yaml = 'plugins:\n  org/repo:\n    plugins:\n      - trigger\n';
  const result = extractPlugins(yaml, 'org/repo', 'org');
  assert.ok(result.includes('trigger'));
});

test('extractPlugins: repo-level entry takes precedence over org-level', () => {
  const yaml =
    'plugins:\n' +
    '  org/repo:\n' +
    '    - approve\n' +
    '  org:\n' +
    '    - lgtm\n';
  const result = extractPlugins(yaml, 'org/repo', 'org');
  assert.ok(result.includes('approve'));
  // org-level is only used as a fallback when repo key is absent; with both
  // present, only the repo key is read (parsed.plugins[fullRepo] is truthy).
  assert.ok(!result.includes('lgtm'));
});

test('extractPlugins: top-level section format', () => {
  const yaml = 'approve:\n  - repos:\n      - org/repo\n';
  const result = extractPlugins(yaml, 'org/repo', 'org');
  assert.ok(result.includes('approve'));
});

test('extractPlugins: top-level section org-level match', () => {
  const yaml = 'lgtm:\n  - repos:\n      - org\n';
  const result = extractPlugins(yaml, 'org/repo', 'org');
  assert.ok(result.includes('lgtm'));
});

test('extractPlugins: invalid YAML throws', () => {
  assert.throws(() => extractPlugins(': bad: yaml: [[[', 'org/repo', 'org'));
});

// ── buildConfigFileUrl ────────────────────────────────────────────────────────

test('buildConfigFileUrl: flat source produces correct blob URL', () => {
  const source = { format: 'flat', configRepo: 'org/config', branch: 'main', filePath: 'plugins.yaml' };
  const url = buildConfigFileUrl(source, 'org', 'repo');
  assert.equal(url, 'https://github.com/org/config/blob/main/plugins.yaml');
});

test('buildConfigFileUrl: sharded source produces correct path', () => {
  const source = { format: 'sharded', configRepo: 'org/config', branch: 'main', pathTemplate: 'config/' };
  const url = buildConfigFileUrl(source, 'myorg', 'myrepo');
  assert.equal(url, 'https://github.com/org/config/blob/main/config/myorg/myrepo/_pluginconfig.yaml');
});

test('buildConfigFileUrl: multiple trailing slashes in pathTemplate are stripped', () => {
  const source = { format: 'sharded', configRepo: 'org/config', branch: 'main', pathTemplate: 'config//' };
  const url = buildConfigFileUrl(source, 'myorg', 'myrepo');
  assert.ok(!url.includes('//config'), `URL should not contain double slash before org: ${url}`);
  assert.equal(url, 'https://github.com/org/config/blob/main/config/myorg/myrepo/_pluginconfig.yaml');
});
