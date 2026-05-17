/**
 * Unit tests for pure ConfigManager functions.
 * Uses vm.runInContext to execute config-manager.js with a minimal browser-like environment.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = fs.readFileSync(path.resolve(__dirname, '..', 'config-manager.js'), 'utf8');

function createCM(commandToPlugin = {}) {
  const win = { GHBCP: { CommandToPlugin: commandToPlugin } };
  win.window = win;
  const ctx = {
    window: win,
    crypto: { randomUUID: () => 'test-' + Math.random().toString(36).slice(2) }
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx.window.GHBCP.ConfigManager;
}

// ── globMatch ─────────────────────────────────────────────────────────────────

test('globMatch: wildcard * matches any repo', () => {
  const CM = createCM();
  assert.equal(CM.globMatch('*', 'org/repo'), true);
  assert.equal(CM.globMatch('*', 'any/thing'), true);
});

test('globMatch: exact match works', () => {
  const CM = createCM();
  assert.equal(CM.globMatch('openshift/release', 'openshift/release'), true);
  assert.equal(CM.globMatch('openshift/release', 'openshift/other'), false);
});

test('globMatch: org/* matches all repos in org', () => {
  const CM = createCM();
  assert.equal(CM.globMatch('openshift/*', 'openshift/release'), true);
  assert.equal(CM.globMatch('openshift/*', 'openshift/installer'), true);
  assert.equal(CM.globMatch('openshift/*', 'other/repo'), false);
});

test('globMatch: does not match partial segments', () => {
  const CM = createCM();
  assert.equal(CM.globMatch('open*', 'openshift/release'), false);
  assert.equal(CM.globMatch('open*', 'openshift'), true);
});

// ── getMatchingProfiles ───────────────────────────────────────────────────────

function makeMinimalConfig(profiles = [], repoOverrides = []) {
  return {
    version: 2,
    globalSettings: { enabled: true },
    profiles,
    repoOverrides
  };
}

test('getMatchingProfiles: returns profiles whose repoPatterns match', () => {
  const CM = createCM();
  const config = makeMinimalConfig([
    { id: 'p1', name: 'Universal', enabled: true, repoPatterns: ['*'], globalCommands: [], checkCommands: [], dynamicCommands: [] },
    { id: 'p2', name: 'Specific', enabled: true, repoPatterns: ['myorg/special'], globalCommands: [], checkCommands: [], dynamicCommands: [] }
  ]);

  const result = CM.getMatchingProfiles(config, 'myorg/other');
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'p1');
});

test('getMatchingProfiles: returns both when repo matches both patterns', () => {
  const CM = createCM();
  const config = makeMinimalConfig([
    { id: 'p1', name: 'Universal', enabled: true, repoPatterns: ['*'], globalCommands: [], checkCommands: [], dynamicCommands: [] },
    { id: 'p2', name: 'Specific', enabled: true, repoPatterns: ['myorg/special'], globalCommands: [], checkCommands: [], dynamicCommands: [] }
  ]);

  const result = CM.getMatchingProfiles(config, 'myorg/special');
  assert.equal(result.length, 2);
});

test('getMatchingProfiles: disabled profiles are excluded', () => {
  const CM = createCM();
  const config = makeMinimalConfig([
    { id: 'p1', name: 'Disabled', enabled: false, repoPatterns: ['*'], globalCommands: [], checkCommands: [], dynamicCommands: [] }
  ]);

  const result = CM.getMatchingProfiles(config, 'any/repo');
  assert.equal(result.length, 0);
});

test('getMatchingProfiles: repoOverride can disable a profile', () => {
  const CM = createCM();
  const config = makeMinimalConfig(
    [{ id: 'p1', name: 'Universal', enabled: true, repoPatterns: ['*'], globalCommands: [], checkCommands: [], dynamicCommands: [] }],
    [{ pattern: 'myorg/repo', disabledProfiles: ['p1'] }]
  );

  const result = CM.getMatchingProfiles(config, 'myorg/repo');
  assert.equal(result.length, 0);
});

// ── filterCommandsByPlugins ───────────────────────────────────────────────────

function makeProfile(id, commands) {
  return {
    id,
    name: id,
    enabled: true,
    repoPatterns: ['*'],
    globalCommands: commands,
    checkCommands: [],
    dynamicCommands: []
  };
}

test('filterCommandsByPlugins: mode=disabled returns profiles unchanged', () => {
  const CM = createCM({ '/lgtm': 'lgtm', '/approve': 'approve' });
  const profiles = [makeProfile('p1', [
    { id: 'c1', command: '/lgtm' },
    { id: 'c2', command: '/approve' }
  ])];

  const result = CM.filterCommandsByPlugins(profiles, ['lgtm'], 'disabled');
  assert.equal(result[0].globalCommands.length, 2);
});

test('filterCommandsByPlugins: mode=filter removes commands for disabled plugins', () => {
  const CM = createCM({ '/lgtm': 'lgtm', '/approve': 'approve' });
  const profiles = [makeProfile('p1', [
    { id: 'c1', command: '/lgtm' },
    { id: 'c2', command: '/approve' }
  ])];

  const result = CM.filterCommandsByPlugins(profiles, ['lgtm'], 'filter');
  assert.equal(result[0].globalCommands.length, 1);
  assert.equal(result[0].globalCommands[0].command, '/lgtm');
});

test('filterCommandsByPlugins: mode=indicate marks commands without removing them', () => {
  const CM = createCM({ '/lgtm': 'lgtm', '/approve': 'approve' });
  const profiles = [makeProfile('p1', [
    { id: 'c1', command: '/lgtm' },
    { id: 'c2', command: '/approve' }
  ])];

  const result = CM.filterCommandsByPlugins(profiles, ['lgtm'], 'indicate');
  assert.equal(result[0].globalCommands.length, 2);
  assert.equal(result[0].globalCommands[0]._pluginDisabled, false);
  assert.equal(result[0].globalCommands[1]._pluginDisabled, true);
});

test('filterCommandsByPlugins: commands with no plugin mapping are always kept', () => {
  const CM = createCM({});
  const profiles = [makeProfile('p1', [
    { id: 'c1', command: '/unknown-command' }
  ])];

  const result = CM.filterCommandsByPlugins(profiles, [], 'filter');
  assert.equal(result[0].globalCommands.length, 1);
});
