const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// ---------------------------------------------------------------------------
// Load config-manager.js into a sandboxed vm context so we can exercise it
// without a real browser or Chrome extension runtime.
// ---------------------------------------------------------------------------
const configManagerSrc = fs.readFileSync(
  path.resolve(__dirname, '..', 'config-manager.js'),
  'utf8'
);

function makeContext(commandToPlugin = {}) {
  const ctx = vm.createContext({
    window: {
      GHBCP: { CommandToPlugin: commandToPlugin }
    },
    crypto: {
      randomUUID: () => 'test-uuid-1234'
    },
    document: {
      createElement: () => ({
        set textContent(_) {},
        get innerHTML() { return ''; }
      })
    },
    chrome: {
      runtime: { id: 'fake-id', lastError: null },
      storage: {
        sync: {
          get: (_key, cb) => cb({}),
          set: (_obj, cb) => cb && cb()
        }
      }
    }
  });
  vm.runInContext(configManagerSrc, ctx);
  return ctx.window.GHBCP.ConfigManager;
}

// ---------------------------------------------------------------------------
// globMatch
// ---------------------------------------------------------------------------
test('globMatch: wildcard * matches any string', () => {
  const CM = makeContext();
  assert.equal(CM.globMatch('*', 'org/repo'), true);
  assert.equal(CM.globMatch('*', 'anything'), true);
});

test('globMatch: exact match', () => {
  const CM = makeContext();
  assert.equal(CM.globMatch('org/repo', 'org/repo'), true);
  assert.equal(CM.globMatch('org/repo', 'org/other'), false);
});

test('globMatch: org/* pattern matches repos in that org', () => {
  const CM = makeContext();
  assert.equal(CM.globMatch('org/*', 'org/repo'), true);
  assert.equal(CM.globMatch('org/*', 'org/another'), true);
  assert.equal(CM.globMatch('org/*', 'other/repo'), false);
});

test('globMatch: non-matching pattern returns false', () => {
  const CM = makeContext();
  assert.equal(CM.globMatch('myorg/myrepo', 'otherorg/myrepo'), false);
  assert.equal(CM.globMatch('a/b', 'a/c'), false);
});

// ---------------------------------------------------------------------------
// getMatchingProfiles
// ---------------------------------------------------------------------------
function makeConfig(overrides = {}) {
  return {
    profiles: [
      { id: 'p1', enabled: true,  repoPatterns: ['org/*'],   globalCommands: [], checkCommands: [] },
      { id: 'p2', enabled: true,  repoPatterns: ['org/repo'], globalCommands: [], checkCommands: [] },
      { id: 'p3', enabled: false, repoPatterns: ['org/*'],   globalCommands: [], checkCommands: [] },
      { id: 'p4', enabled: true,  repoPatterns: ['other/*'], globalCommands: [], checkCommands: [] }
    ],
    repoOverrides: [],
    ...overrides
  };
}

test('getMatchingProfiles: returns only enabled profiles whose patterns match', () => {
  const CM = makeContext();
  const config = makeConfig();
  const result = CM.getMatchingProfiles(config, 'org/repo');
  const ids = result.map(p => p.id);
  assert.ok(ids.includes('p1'), 'p1 should match via org/*');
  assert.ok(ids.includes('p2'), 'p2 should match via org/repo');
  assert.ok(!ids.includes('p3'), 'p3 is disabled and should be excluded');
  assert.ok(!ids.includes('p4'), 'p4 matches other/* not org/repo');
});

test('getMatchingProfiles: repoOverrides.disabledProfiles removes profiles', () => {
  const CM = makeContext();
  const config = makeConfig({
    repoOverrides: [{ pattern: 'org/repo', disabledProfiles: ['p1'] }]
  });
  const result = CM.getMatchingProfiles(config, 'org/repo');
  const ids = result.map(p => p.id);
  assert.ok(!ids.includes('p1'), 'p1 should be removed by override');
  assert.ok(ids.includes('p2'), 'p2 should still be present');
});

test('getMatchingProfiles: repoOverrides.extraProfiles adds profiles', () => {
  const CM = makeContext();
  const config = makeConfig({
    repoOverrides: [{ pattern: 'org/repo', extraProfiles: ['p4'] }]
  });
  const result = CM.getMatchingProfiles(config, 'org/repo');
  const ids = result.map(p => p.id);
  assert.ok(ids.includes('p4'), 'p4 should be added by extraProfiles override');
});

test('getMatchingProfiles: override applies only to matching repo', () => {
  const CM = makeContext();
  const config = makeConfig({
    repoOverrides: [{ pattern: 'org/repo', disabledProfiles: ['p1'] }]
  });
  // For a different repo the override should not apply
  const result = CM.getMatchingProfiles(config, 'org/other');
  const ids = result.map(p => p.id);
  assert.ok(ids.includes('p1'), 'p1 should remain for a repo not covered by the override');
});

// ---------------------------------------------------------------------------
// filterCommandsByPlugins
// ---------------------------------------------------------------------------
function makeProfiles(commands = []) {
  return [
    {
      id: 'prof1',
      globalCommands: commands,
      checkCommands: commands
    }
  ];
}

test('filterCommandsByPlugins: mode=disabled returns profiles unchanged', () => {
  const CM = makeContext({ '/lgtm': 'lgtm' });
  const profiles = makeProfiles([
    { command: '/lgtm', label: 'LGTM' },
    { command: '/hold', label: 'Hold' }
  ]);
  const result = CM.filterCommandsByPlugins(profiles, ['lgtm'], 'disabled');
  assert.equal(result, profiles, 'Should return the same reference when disabled');
});

test('filterCommandsByPlugins: mode=filter removes commands whose plugin is not enabled', () => {
  const CM = makeContext({ '/lgtm': 'lgtm', '/hold': 'hold' });
  const profiles = makeProfiles([
    { command: '/lgtm', label: 'LGTM' },
    { command: '/hold', label: 'Hold' }
  ]);
  const result = CM.filterCommandsByPlugins(profiles, ['lgtm'], 'filter');
  assert.equal(result[0].globalCommands.length, 1);
  assert.equal(result[0].globalCommands[0].command, '/lgtm');
});

test('filterCommandsByPlugins: mode=indicate marks disabled commands', () => {
  const CM = makeContext({ '/lgtm': 'lgtm', '/hold': 'hold' });
  const profiles = makeProfiles([
    { command: '/lgtm', label: 'LGTM' },
    { command: '/hold', label: 'Hold' }
  ]);
  const result = CM.filterCommandsByPlugins(profiles, ['lgtm'], 'indicate');
  const cmds = result[0].globalCommands;
  assert.equal(cmds.length, 2, 'Both commands should be kept');
  const lgtm = cmds.find(c => c.command === '/lgtm');
  const hold = cmds.find(c => c.command === '/hold');
  assert.equal(lgtm._pluginDisabled, false, '/lgtm is enabled so _pluginDisabled=false');
  assert.equal(hold._pluginDisabled, true, '/hold is not enabled so _pluginDisabled=true');
});

test('filterCommandsByPlugins: commands with no plugin mapping are always kept', () => {
  const CM = makeContext({ '/lgtm': 'lgtm' });
  const profiles = makeProfiles([
    { command: '/lgtm', label: 'LGTM' },
    { command: '/unknown', label: 'Unknown' }
  ]);
  const result = CM.filterCommandsByPlugins(profiles, ['lgtm'], 'filter');
  const cmds = result[0].globalCommands;
  assert.equal(cmds.length, 2, '/unknown has no plugin mapping and should always pass through');
});
