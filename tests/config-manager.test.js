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

function makeEscapingDiv() {
  let _text = '';
  return {
    set textContent(v) { _text = v == null ? '' : String(v); },
    get innerHTML() {
      return _text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
  };
}

function makeContext(commandToPlugin = {}) {
  const ctx = vm.createContext({
    window: {
      GHBCP: { CommandToPlugin: commandToPlugin }
    },
    crypto: {
      randomUUID: () => 'test-uuid-1234'
    },
    document: {
      createElement: () => makeEscapingDiv()
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

// ---------------------------------------------------------------------------
// sanitizeCommand
// ---------------------------------------------------------------------------
test('sanitizeCommand: trims whitespace from a normal command', () => {
  const CM = makeContext();
  assert.equal(CM.sanitizeCommand('  /lgtm  '), '/lgtm');
});

test('sanitizeCommand: returns empty string for null', () => {
  const CM = makeContext();
  assert.equal(CM.sanitizeCommand(null), '');
});

test('sanitizeCommand: returns empty string for undefined', () => {
  const CM = makeContext();
  assert.equal(CM.sanitizeCommand(undefined), '');
});

test('sanitizeCommand: coerces non-string values to string', () => {
  const CM = makeContext();
  assert.equal(CM.sanitizeCommand(42), '42');
});

// ---------------------------------------------------------------------------
// getExtraCommands
// ---------------------------------------------------------------------------
test('getExtraCommands: returns extra commands from matching repo override', () => {
  const CM = makeContext();
  const extra = { id: 'x1', label: 'Extra', command: '/extra' };
  const config = {
    profiles: [],
    repoOverrides: [
      { pattern: 'org/repo', extraCommands: [extra] }
    ]
  };
  const result = CM.getExtraCommands(config, 'org/repo');
  assert.equal(result.length, 1);
  assert.equal(result[0].command, '/extra');
});

test('getExtraCommands: returns empty array when no overrides match', () => {
  const CM = makeContext();
  const config = {
    profiles: [],
    repoOverrides: [
      { pattern: 'other/repo', extraCommands: [{ id: 'x1', label: 'Extra', command: '/extra' }] }
    ]
  };
  const result = CM.getExtraCommands(config, 'org/repo');
  assert.equal(result.length, 0);
});

test('getExtraCommands: merges extra commands from multiple matching overrides', () => {
  const CM = makeContext();
  const config = {
    profiles: [],
    repoOverrides: [
      { pattern: 'org/*', extraCommands: [{ id: 'x1', label: 'A', command: '/a' }] },
      { pattern: 'org/repo', extraCommands: [{ id: 'x2', label: 'B', command: '/b' }] }
    ]
  };
  const result = CM.getExtraCommands(config, 'org/repo');
  assert.equal(result.length, 2);
  assert.ok(result.some(c => c.command === '/a'));
  assert.ok(result.some(c => c.command === '/b'));
});

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------
test('escapeHtml: escapes < and > characters', () => {
  const CM = makeContext();
  assert.equal(CM.escapeHtml('<b>bold</b>'), '&lt;b&gt;bold&lt;/b&gt;');
});

test('escapeHtml: escapes & character', () => {
  const CM = makeContext();
  assert.equal(CM.escapeHtml('foo & bar'), 'foo &amp; bar');
});

test('escapeHtml: escapes double-quote characters', () => {
  const CM = makeContext();
  assert.equal(CM.escapeHtml('"quoted"'), '&quot;quoted&quot;');
});

test('escapeHtml: returns empty string for null', () => {
  const CM = makeContext();
  assert.equal(CM.escapeHtml(null), '');
});

test('escapeHtml: returns empty string for undefined', () => {
  const CM = makeContext();
  assert.equal(CM.escapeHtml(undefined), '');
});

test('escapeHtml: coerces non-string to string before escaping', () => {
  const CM = makeContext();
  assert.equal(CM.escapeHtml(42), '42');
});

// ---------------------------------------------------------------------------
// getConfig
// ---------------------------------------------------------------------------
function makeContextWithStorage(storedValue, lastError = null) {
  const ctx = vm.createContext({
    window: {
      GHBCP: { CommandToPlugin: {} }
    },
    crypto: {
      randomUUID: () => 'test-uuid-1234'
    },
    document: {
      createElement: () => makeEscapingDiv()
    },
    chrome: {
      runtime: { id: 'fake-id', get lastError() { return lastError; } },
      storage: {
        sync: {
          get: (_key, cb) => cb(storedValue == null ? {} : { ghbcp_config: storedValue }),
          set: (_obj, cb) => cb && cb()
        }
      }
    }
  });
  vm.runInContext(configManagerSrc, ctx);
  return ctx.window.GHBCP.ConfigManager;
}

test('getConfig: returns DEFAULT_CONFIG when storage is empty', async () => {
  const CM = makeContextWithStorage(null);
  const config = await CM.getConfig();
  assert.equal(config.version, CM.DEFAULT_CONFIG.version);
  assert.ok(Array.isArray(config.profiles));
  assert.ok(config.profiles.length > 0);
});

test('getConfig: returns stored config when present and at current version', async () => {
  const CM = makeContextWithStorage(null);
  const defaults = JSON.parse(JSON.stringify(CM.DEFAULT_CONFIG));
  // Store a config at the current schema version
  const CM2 = makeContextWithStorage(defaults);
  const config = await CM2.getConfig();
  assert.equal(config.version, defaults.version);
});

test('getConfig: returns DEFAULT_CONFIG when chrome.runtime.lastError is set', async () => {
  const CM = makeContextWithStorage(null, { message: 'quota exceeded' });
  const config = await CM.getConfig();
  assert.equal(config.version, CM.DEFAULT_CONFIG.version);
  assert.ok(Array.isArray(config.profiles));
});

// ---------------------------------------------------------------------------
// migrateConfig (tested via getConfig with a v1 config stored)
// ---------------------------------------------------------------------------
test('migrateConfig: bumps version to current schema version', async () => {
  const CM = makeContextWithStorage(null);
  const v1config = {
    version: 1,
    profiles: [],
    repoOverrides: [],
    globalSettings: CM.DEFAULT_CONFIG.globalSettings,
    pluginConfigSources: []
  };
  const CM2 = makeContextWithStorage(v1config);
  const config = await CM2.getConfig();
  assert.equal(config.version, CM.DEFAULT_CONFIG.version, 'version should be bumped to schema version');
});

test('migrateConfig: sets _migrated flag so injection toast fires once', async () => {
  const CM = makeContextWithStorage(null);
  const v1config = {
    version: 1,
    profiles: [],
    repoOverrides: [],
    globalSettings: CM.DEFAULT_CONFIG.globalSettings,
    pluginConfigSources: []
  };
  const CM2 = makeContextWithStorage(v1config);
  const config = await CM2.getConfig();
  assert.equal(config._migrated, true);
});

test('migrateConfig: adds built-in profiles missing from stored config', async () => {
  const CM = makeContextWithStorage(null);
  const v1config = {
    version: 1,
    profiles: [],  // no profiles at all
    repoOverrides: [],
    globalSettings: CM.DEFAULT_CONFIG.globalSettings,
    pluginConfigSources: []
  };
  const CM2 = makeContextWithStorage(v1config);
  const config = await CM2.getConfig();
  assert.ok(config.profiles.length > 0, 'built-in profiles should be added during migration');
});

test('migrateConfig: preserves user-set enabled=false on a built-in profile', async () => {
  const CM = makeContextWithStorage(null);
  const v1config = {
    version: 1,
    profiles: [
      { id: 'profile-tide-prow-universal', enabled: false, repoPatterns: ['*'], globalCommands: [], checkCommands: [] }
    ],
    repoOverrides: [],
    globalSettings: CM.DEFAULT_CONFIG.globalSettings,
    pluginConfigSources: []
  };
  const CM2 = makeContextWithStorage(v1config);
  const config = await CM2.getConfig();
  const p = config.profiles.find(x => x.id === 'profile-tide-prow-universal');
  assert.ok(p, 'profile-tide-prow-universal should exist after migration');
  assert.equal(p.enabled, false, 'user-disabled profile should stay disabled after migration');
});

// ---------------------------------------------------------------------------
// getConfig: defensive defaults for partial/corrupted stored configs
// ---------------------------------------------------------------------------
test('getConfig: fills in missing globalSettings when stored config lacks it', async () => {
  const partial = {
    version: 2,
    profiles: [],
    repoOverrides: [],
    pluginConfigSources: []
    // globalSettings intentionally absent
  };
  const CM = makeContextWithStorage(partial);
  const config = await CM.getConfig();
  assert.ok(config.globalSettings, 'globalSettings should be present');
  assert.equal(typeof config.globalSettings.enabled, 'boolean', 'globalSettings.enabled should be a boolean');
});

test('getConfig: fills in missing repoOverrides when stored config lacks it', async () => {
  const partial = {
    version: 2,
    profiles: [],
    globalSettings: { enabled: true, confirmBeforePost: false, autoSubmit: false,
                      showOnlyFailedTests: true, theme: 'auto', buttonPosition: 'above-comment-box',
                      pluginFilterMode: 'filter' },
    pluginConfigSources: []
    // repoOverrides intentionally absent
  };
  const CM = makeContextWithStorage(partial);
  const config = await CM.getConfig();
  assert.ok(Array.isArray(config.repoOverrides), 'repoOverrides should be an array');
  assert.equal(config.repoOverrides.length, 0);
});

test('getConfig: fills in missing pluginConfigSources when stored config lacks it', async () => {
  const partial = {
    version: 2,
    profiles: [],
    globalSettings: { enabled: true, confirmBeforePost: false, autoSubmit: false,
                      showOnlyFailedTests: true, theme: 'auto', buttonPosition: 'above-comment-box',
                      pluginFilterMode: 'filter' },
    repoOverrides: []
    // pluginConfigSources intentionally absent
  };
  const CM = makeContextWithStorage(partial);
  const config = await CM.getConfig();
  assert.ok(Array.isArray(config.pluginConfigSources), 'pluginConfigSources should be an array');
  assert.equal(config.pluginConfigSources.length, 0);
});

test('getConfig: fills in individual missing globalSettings keys from defaults', async () => {
  // Simulate a stored config from an older version that has globalSettings but
  // is missing keys added in a later schema version (e.g. pluginFilterMode).
  const partial = {
    version: 3,
    profiles: [],
    repoOverrides: [],
    pluginConfigSources: [],
    globalSettings: { enabled: true, confirmBeforePost: false }
    // pluginFilterMode, autoSubmit, showOnlyFailedTests, theme, buttonPosition intentionally absent
  };
  const CM = makeContextWithStorage(partial);
  const config = await CM.getConfig();
  assert.equal(config.globalSettings.pluginFilterMode, CM.DEFAULT_CONFIG.globalSettings.pluginFilterMode,
    'missing pluginFilterMode should be filled with its default value');
  assert.equal(typeof config.globalSettings.autoSubmit, 'boolean',
    'missing autoSubmit should be filled in as a boolean');
  assert.equal(typeof config.globalSettings.showOnlyFailedTests, 'boolean',
    'missing showOnlyFailedTests should be filled in as a boolean');
  // User-set values must NOT be overwritten
  assert.equal(config.globalSettings.enabled, true, 'user-set enabled=true should be preserved');
  assert.equal(config.globalSettings.confirmBeforePost, false, 'user-set confirmBeforePost=false should be preserved');
});


test('globMatch: ? matches any single character', () => {
  const CM = makeContext();
  assert.equal(CM.globMatch('org/repo?', 'org/repos'), true);
  assert.equal(CM.globMatch('org/repo?', 'org/repox'), true);
  assert.equal(CM.globMatch('org/repo?', 'org/repo'), false, '? requires exactly one char');
  assert.equal(CM.globMatch('org/repo?', 'org/repoab'), false, '? matches only one char');
});

test('globMatch: ? does not act as a regex quantifier', () => {
  const CM = makeContext();
  // Without the fix, 'org/repo?' would match 'org/rep' (zero occurrences of 'o')
  assert.equal(CM.globMatch('org/repo?', 'org/rep'), false, '? should not make preceding char optional');
});

test('globMatch: literal dot in pattern is not treated as regex wildcard', () => {
  const CM = makeContext();
  assert.equal(CM.globMatch('my.org/repo', 'my.org/repo'), true);
  assert.equal(CM.globMatch('my.org/repo', 'myXorg/repo'), false, 'dot should be literal');
});

// ---------------------------------------------------------------------------
// filterCommandsByPlugins: profiles missing globalCommands/checkCommands
// ---------------------------------------------------------------------------
test('filterCommandsByPlugins: does not crash when profile has no globalCommands or checkCommands', () => {
  const CM = makeContext({ '/lgtm': 'lgtm' });
  // Profile missing both arrays (simulates an imported config with partial schema)
  const profiles = [{ id: 'p1', name: 'Test' }];
  assert.doesNotThrow(() => CM.filterCommandsByPlugins(profiles, ['lgtm'], 'filter'));
  assert.doesNotThrow(() => CM.filterCommandsByPlugins(profiles, ['lgtm'], 'indicate'));
});

test('filterCommandsByPlugins: mode=filter on profile with no commands returns empty arrays', () => {
  const CM = makeContext({ '/lgtm': 'lgtm' });
  const profiles = [{ id: 'p1', name: 'Test' }];
  const result = CM.filterCommandsByPlugins(profiles, ['lgtm'], 'filter');
  assert.ok(Array.isArray(result[0].globalCommands), 'globalCommands should be an array');
  assert.equal(result[0].globalCommands.length, 0);
  assert.ok(Array.isArray(result[0].checkCommands), 'checkCommands should be an array');
  assert.equal(result[0].checkCommands.length, 0);
});

// ---------------------------------------------------------------------------
// isContextValid
// ---------------------------------------------------------------------------
test('isContextValid: returns true when chrome.runtime.id is set', () => {
  const CM = makeContext();
  assert.equal(CM.isContextValid(), true);
});

test('isContextValid: returns false when chrome.runtime.id is falsy', () => {
  const ctx = vm.createContext({
    window: { GHBCP: {} },
    crypto: { randomUUID: () => 'test-uuid' },
    document: { createElement: () => makeEscapingDiv() },
    chrome: { runtime: { id: '', lastError: null }, storage: { sync: { get: (_k, cb) => cb({}), set: (_o, cb) => cb && cb() } } }
  });
  vm.runInContext(configManagerSrc, ctx);
  const CM = ctx.window.GHBCP.ConfigManager;
  assert.equal(CM.isContextValid(), false);
});

test('isContextValid: returns false when chrome.runtime throws', () => {
  const ctx = vm.createContext({
    window: { GHBCP: {} },
    crypto: { randomUUID: () => 'test-uuid' },
    document: { createElement: () => makeEscapingDiv() },
    chrome: {
      get runtime() { throw new Error('Extension context invalidated'); },
      storage: { sync: { get: (_k, cb) => cb({}), set: (_o, cb) => cb && cb() } }
    }
  });
  vm.runInContext(configManagerSrc, ctx);
  const CM = ctx.window.GHBCP.ConfigManager;
  assert.equal(CM.isContextValid(), false);
});

// ---------------------------------------------------------------------------
// saveConfig
// ---------------------------------------------------------------------------
test('saveConfig: writes config to chrome.storage.sync', async () => {
  let saved = null;
  const ctx = vm.createContext({
    window: { GHBCP: {} },
    crypto: { randomUUID: () => 'test-uuid' },
    document: { createElement: () => makeEscapingDiv() },
    chrome: {
      runtime: { id: 'fake-id', lastError: null },
      storage: {
        sync: {
          get: (_k, cb) => cb({}),
          set: (obj, cb) => { saved = obj; cb && cb(); }
        }
      }
    }
  });
  vm.runInContext(configManagerSrc, ctx);
  const CM = ctx.window.GHBCP.ConfigManager;
  const config = { version: 2, profiles: [], globalSettings: {}, repoOverrides: [], pluginConfigSources: [] };
  await CM.saveConfig(config);
  assert.deepEqual(saved[CM.STORAGE_KEY], config);
});

test('saveConfig: rejects when chrome.storage.sync.set fails', async () => {
  const ctx = vm.createContext({
    window: { GHBCP: {} },
    crypto: { randomUUID: () => 'test-uuid' },
    document: { createElement: () => makeEscapingDiv() },
    chrome: {
      runtime: { id: 'fake-id', get lastError() { return { message: 'quota exceeded' }; } },
      storage: {
        sync: {
          get: (_k, cb) => cb({}),
          set: (_obj, cb) => cb && cb()
        }
      }
    }
  });
  vm.runInContext(configManagerSrc, ctx);
  const CM = ctx.window.GHBCP.ConfigManager;
  const err = await CM.saveConfig({ version: 2, profiles: [] }).then(() => null, e => e);
  assert.ok(err && err.message === 'quota exceeded', 'should reject with lastError message');
});

test('saveConfig: no-ops (resolves) when context is invalid', async () => {
  const ctx = vm.createContext({
    window: { GHBCP: {} },
    crypto: { randomUUID: () => 'test-uuid' },
    document: { createElement: () => makeEscapingDiv() },
    chrome: { runtime: { id: '', lastError: null }, storage: { sync: { get: (_k, cb) => cb({}), set: (_o, cb) => cb && cb() } } }
  });
  vm.runInContext(configManagerSrc, ctx);
  const CM = ctx.window.GHBCP.ConfigManager;
  await assert.doesNotReject(() => CM.saveConfig({ version: 2 }));
});

// ---------------------------------------------------------------------------
// resetToDefaults
// ---------------------------------------------------------------------------
test('resetToDefaults: returns a config equal to DEFAULT_CONFIG', async () => {
  const CM = makeContext();
  const result = await CM.resetToDefaults();
  assert.equal(result.version, CM.DEFAULT_CONFIG.version);
  assert.ok(Array.isArray(result.profiles));
  assert.ok(result.globalSettings);
});

test('resetToDefaults: returned config is a deep copy (not the same reference as DEFAULT_CONFIG)', async () => {
  const CM = makeContext();
  const result = await CM.resetToDefaults();
  result.profiles.push({ id: 'extra' });
  assert.ok(!CM.DEFAULT_CONFIG.profiles.some(p => p.id === 'extra'), 'DEFAULT_CONFIG should not be mutated');
});
