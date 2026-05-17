'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Load config-manager.js in a sandboxed context with minimal browser stubs.
const cmSource = fs.readFileSync(path.resolve(__dirname, '..', 'config-manager.js'), 'utf8');

function loadCM(pluginMap = {}) {
  const ctx = vm.createContext({
    window: { GHBCP: { CommandToPlugin: pluginMap } },
    crypto: { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) },
    document: {
      createElement: () => ({
        set textContent(v) { this._text = v == null ? '' : String(v); },
        get innerHTML() { return (this._text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
      })
    },
    chrome: {
      runtime: { id: 'fake-id', lastError: null },
      storage: { sync: { get: () => {}, set: () => {} } }
    }
  });
  vm.runInContext(cmSource, ctx);
  return ctx.window.GHBCP.ConfigManager;
}

// ── globMatch ────────────────────────────────────────────────────────────────

test('globMatch: wildcard * matches anything', () => {
  const CM = loadCM();
  assert.ok(CM.globMatch('*', 'org/repo'));
  assert.ok(CM.globMatch('*', 'anything'));
});

test('globMatch: exact pattern matches only exact string', () => {
  const CM = loadCM();
  assert.ok(CM.globMatch('org/repo', 'org/repo'));
  assert.ok(!CM.globMatch('org/repo', 'org/other'));
});

test('globMatch: org/* matches any repo in org', () => {
  const CM = loadCM();
  assert.ok(CM.globMatch('org/*', 'org/repo'));
  assert.ok(CM.globMatch('org/*', 'org/another'));
  assert.ok(!CM.globMatch('org/*', 'other/repo'));
});

test('globMatch: non-matching pattern returns false', () => {
  const CM = loadCM();
  assert.ok(!CM.globMatch('foo/bar', 'baz/qux'));
});

// ── getMatchingProfiles ──────────────────────────────────────────────────────

function makeConfig(profileOverrides = [], repoOverrides = []) {
  return {
    profiles: [
      { id: 'p1', name: 'Universal', enabled: true,  repoPatterns: ['*'],        globalCommands: [], checkCommands: [], dynamicCommands: [] },
      { id: 'p2', name: 'Specific',  enabled: true,  repoPatterns: ['myorg/*'],  globalCommands: [], checkCommands: [], dynamicCommands: [] },
      { id: 'p3', name: 'Disabled',  enabled: false, repoPatterns: ['*'],        globalCommands: [], checkCommands: [], dynamicCommands: [] }
    ],
    repoOverrides
  };
}

test('getMatchingProfiles: returns enabled profiles matching the repo', () => {
  const CM = loadCM();
  const config = makeConfig();
  const profiles = CM.getMatchingProfiles(config, 'myorg/myrepo');
  const ids = profiles.map(p => p.id);
  assert.ok(ids.includes('p1'), 'universal profile included');
  assert.ok(ids.includes('p2'), 'org-specific profile included');
  assert.ok(!ids.includes('p3'), 'disabled profile excluded');
});

test('getMatchingProfiles: respects repoOverrides.disabledProfiles', () => {
  const CM = loadCM();
  const config = makeConfig([], [{ pattern: 'myorg/*', disabledProfiles: ['p1'] }]);
  const profiles = CM.getMatchingProfiles(config, 'myorg/myrepo');
  const ids = profiles.map(p => p.id);
  assert.ok(!ids.includes('p1'), 'disabled-by-override profile excluded');
  assert.ok(ids.includes('p2'), 'other profile still included');
});

test('getMatchingProfiles: respects repoOverrides.extraProfiles for disabled profile', () => {
  const CM = loadCM();
  // p3 is disabled globally but added via extraProfiles for this repo
  const config = makeConfig([], [{ pattern: 'myorg/*', extraProfiles: ['p3'] }]);
  const profiles = CM.getMatchingProfiles(config, 'myorg/myrepo');
  const ids = profiles.map(p => p.id);
  assert.ok(ids.includes('p3'), 'extra profile included even though globally disabled');
});

// ── filterCommandsByPlugins ──────────────────────────────────────────────────

function makeProfiles(commands) {
  return [{ id: 'p1', name: 'Test', globalCommands: commands, checkCommands: [], dynamicCommands: [] }];
}

test('filterCommandsByPlugins: mode=disabled returns profiles unchanged', () => {
  const CM = loadCM({ approve: 'approve' });
  const profiles = makeProfiles([
    { id: 'c1', command: '/approve', label: 'Approve' }
  ]);
  const result = CM.filterCommandsByPlugins(profiles, [], 'disabled');
  assert.equal(result[0].globalCommands.length, 1);
});

test('filterCommandsByPlugins: mode=filter removes commands whose plugin is not enabled', () => {
  const CM = loadCM({ '/approve': 'approve', '/lgtm': 'lgtm' });
  const profiles = makeProfiles([
    { id: 'c1', command: '/approve', label: 'Approve' },
    { id: 'c2', command: '/lgtm',    label: 'LGTM'    }
  ]);
  const result = CM.filterCommandsByPlugins(profiles, ['approve'], 'filter');
  const cmds = result[0].globalCommands;
  assert.equal(cmds.length, 1);
  assert.equal(cmds[0].command, '/approve');
});

test('filterCommandsByPlugins: mode=filter keeps commands with no plugin mapping', () => {
  const CM = loadCM({});
  const profiles = makeProfiles([
    { id: 'c1', command: '/custom-command', label: 'Custom' }
  ]);
  const result = CM.filterCommandsByPlugins(profiles, [], 'filter');
  assert.equal(result[0].globalCommands.length, 1, 'unmapped command preserved');
});

test('filterCommandsByPlugins: mode=indicate marks disabled commands without removing them', () => {
  const CM = loadCM({ '/approve': 'approve', '/lgtm': 'lgtm' });
  const profiles = makeProfiles([
    { id: 'c1', command: '/approve', label: 'Approve' },
    { id: 'c2', command: '/lgtm',    label: 'LGTM'    }
  ]);
  const result = CM.filterCommandsByPlugins(profiles, ['approve'], 'indicate');
  const cmds = result[0].globalCommands;
  assert.equal(cmds.length, 2, 'both commands kept');
  assert.ok(!cmds[0]._pluginDisabled, 'enabled command not marked disabled');
  assert.ok(cmds[1]._pluginDisabled,  'disabled command marked _pluginDisabled');
});
