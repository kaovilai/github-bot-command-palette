// Unit tests for pure functions in config-manager.js.
// Uses vm.runInContext to load the module with a minimal browser-stub environment
// so no real Chrome extension runtime or DOM is needed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const configManagerPath = path.resolve(__dirname, '..', 'config-manager.js');
const configManagerSrc = fs.readFileSync(configManagerPath, 'utf8');

// Minimal stubs so config-manager.js loads without errors.
const ctx = vm.createContext({
  window: {},
  crypto: { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) },
  document: {
    createElement: () => ({ textContent: '', innerHTML: '' })
  },
  chrome: {
    storage: {
      sync: {
        get: (_k, cb) => cb({}),
        set: (_o, cb) => cb && cb()
      }
    },
    runtime: { lastError: null }
  }
});

vm.runInContext(configManagerSrc, ctx);
const CM = ctx.window.GHBCP.ConfigManager;

// ── globMatch ────────────────────────────────────────────────────────────────

test('globMatch: wildcard * matches any string', () => {
  assert.ok(CM.globMatch('*', 'org/repo'));
  assert.ok(CM.globMatch('*', ''));
});

test('globMatch: exact pattern matches only that string', () => {
  assert.ok(CM.globMatch('openshift/release', 'openshift/release'));
  assert.ok(!CM.globMatch('openshift/release', 'openshift/other'));
});

test('globMatch: org/* pattern matches repos in that org', () => {
  assert.ok(CM.globMatch('org/*', 'org/repo-a'));
  assert.ok(CM.globMatch('org/*', 'org/repo-b'));
  assert.ok(!CM.globMatch('org/*', 'other/repo'));
});

test('globMatch: does not match partial strings', () => {
  assert.ok(!CM.globMatch('foo', 'foobar'));
  assert.ok(!CM.globMatch('foo', 'barfoo'));
});

// ── getMatchingProfiles ──────────────────────────────────────────────────────

function makeConfig(overrides = {}) {
  return {
    profiles: [
      { id: 'p1', name: 'Universal', enabled: true,  repoPatterns: ['*'],           globalCommands: [{ id: 'c1', command: '/lgtm' }], checkCommands: [], dynamicCommands: [] },
      { id: 'p2', name: 'Specific',  enabled: true,  repoPatterns: ['myorg/myrepo'], globalCommands: [{ id: 'c2', command: '/approve' }], checkCommands: [], dynamicCommands: [] },
      { id: 'p3', name: 'Disabled',  enabled: false, repoPatterns: ['*'],           globalCommands: [], checkCommands: [], dynamicCommands: [] },
    ],
    repoOverrides: [],
    ...overrides
  };
}

test('getMatchingProfiles: returns only enabled profiles matching the repo', () => {
  const config = makeConfig();
  const result = CM.getMatchingProfiles(config, 'other/repo');
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'p1');
});

test('getMatchingProfiles: includes profile whose repoPattern matches exactly', () => {
  const config = makeConfig();
  const result = CM.getMatchingProfiles(config, 'myorg/myrepo');
  assert.equal(result.length, 2);
  assert.ok(result.some(p => p.id === 'p1'));
  assert.ok(result.some(p => p.id === 'p2'));
});

test('getMatchingProfiles: respects repoOverrides.disabledProfiles', () => {
  const config = makeConfig({
    repoOverrides: [{ pattern: 'myorg/myrepo', disabledProfiles: ['p1'] }]
  });
  const result = CM.getMatchingProfiles(config, 'myorg/myrepo');
  assert.ok(!result.some(p => p.id === 'p1'), 'p1 should be disabled by override');
  assert.ok(result.some(p => p.id === 'p2'));
});

test('getMatchingProfiles: adds extra profiles via repoOverrides.extraProfiles', () => {
  const config = makeConfig({
    repoOverrides: [{ pattern: 'other/repo', extraProfiles: ['p2'] }]
  });
  // p2 only matches 'myorg/myrepo' by repoPattern, but override adds it to 'other/repo'
  const result = CM.getMatchingProfiles(config, 'other/repo');
  assert.ok(result.some(p => p.id === 'p1'));
  assert.ok(result.some(p => p.id === 'p2'));
});

// ── filterCommandsByPlugins ──────────────────────────────────────────────────

function makeProfiles() {
  return [
    {
      id: 'p1', name: 'P1',
      globalCommands: [
        { id: 'c1', command: '/lgtm' },
        { id: 'c2', command: '/hold' },
        { id: 'c3', command: '/no-known-plugin' }
      ],
      checkCommands: [
        { id: 'cc1', command: '/retest' }
      ],
      dynamicCommands: []
    }
  ];
}

// Stub the plugin map so /lgtm → 'approve', /hold → 'hold', /retest → 'trigger'
function withPluginMap(fn) {
  const prev = ctx.window.GHBCP.CommandToPlugin;
  ctx.window.GHBCP.CommandToPlugin = { '/lgtm': 'approve', '/hold': 'hold', '/retest': 'trigger' };
  try { fn(); } finally { ctx.window.GHBCP.CommandToPlugin = prev; }
}

test('filterCommandsByPlugins: mode=disabled returns profiles unchanged', () => {
  const profiles = makeProfiles();
  const result = CM.filterCommandsByPlugins(profiles, ['approve'], 'disabled');
  assert.deepEqual(result, profiles);
});

test('filterCommandsByPlugins: mode=filter removes commands whose plugin is not enabled', () => {
  withPluginMap(() => {
    const result = CM.filterCommandsByPlugins(makeProfiles(), ['approve'], 'filter');
    const cmds = result[0].globalCommands.map(c => c.command);
    assert.ok(cmds.includes('/lgtm'),  '/lgtm should be kept (approve enabled)');
    assert.ok(!cmds.includes('/hold'), '/hold should be removed (hold not enabled)');
    // /no-known-plugin has no plugin mapping — always kept
    assert.ok(cmds.includes('/no-known-plugin'), 'unmapped command should be kept');
  });
});

test('filterCommandsByPlugins: mode=filter also filters checkCommands', () => {
  withPluginMap(() => {
    const result = CM.filterCommandsByPlugins(makeProfiles(), ['approve'], 'filter');
    // /retest maps to 'trigger' which is not enabled
    assert.equal(result[0].checkCommands.length, 0);
  });
});

test('filterCommandsByPlugins: mode=indicate marks disabled commands with _pluginDisabled', () => {
  withPluginMap(() => {
    const result = CM.filterCommandsByPlugins(makeProfiles(), ['approve'], 'indicate');
    const cmdMap = Object.fromEntries(result[0].globalCommands.map(c => [c.command, c]));
    assert.equal(cmdMap['/lgtm']._pluginDisabled, false);
    assert.equal(cmdMap['/hold']._pluginDisabled, true);
    assert.equal(cmdMap['/no-known-plugin']._pluginDisabled, false, 'unmapped command never disabled');
  });
});

test('filterCommandsByPlugins: mode=indicate keeps all commands in the array', () => {
  withPluginMap(() => {
    const result = CM.filterCommandsByPlugins(makeProfiles(), ['approve'], 'indicate');
    assert.equal(result[0].globalCommands.length, 3);
  });
});
