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

test('globMatch: ? matches exactly one character', () => {
  const CM = makeContext();
  assert.equal(CM.globMatch('org/?', 'org/a'), true);
  assert.equal(CM.globMatch('org/?', 'org/ab'), false, '? should not match two chars');
  assert.equal(CM.globMatch('org/?epo', 'org/repo'), true);
});

test('globMatch: . in pattern is treated as a literal dot, not a regex wildcard', () => {
  const CM = makeContext();
  // 'a.b' should only match 'a.b', not 'axb'
  assert.equal(CM.globMatch('a.b', 'a.b'), true);
  assert.equal(CM.globMatch('a.b', 'axb'), false, 'dot must be literal, not regex wildcard');
});

test('globMatch: regex special chars in pattern are treated as literals', () => {
  const CM = makeContext();
  // + and ( ) should not be treated as regex metacharacters
  assert.equal(CM.globMatch('a+b', 'a+b'), true);
  assert.equal(CM.globMatch('a+b', 'ab'), false);
  assert.equal(CM.globMatch('a(b)', 'a(b)'), true);
  assert.equal(CM.globMatch('a(b)', 'ab'), false);
});

// ---------------------------------------------------------------------------
// getOverrideContext
// ---------------------------------------------------------------------------
test('getOverrideContext: strips workflow prefix and event suffix', () => {
  const CM = makeContext();
  assert.equal(
    CM.getOverrideContext('Lint / Lint (ubuntu-latest) (pull_request)'),
    'Lint (ubuntu-latest)'
  );
});

test('getOverrideContext: strips only the workflow prefix when no event suffix', () => {
  const CM = makeContext();
  assert.equal(CM.getOverrideContext('Lint / Lint (ubuntu-latest)'), 'Lint (ubuntu-latest)');
  assert.equal(CM.getOverrideContext('CI / build'), 'build');
});

test('getOverrideContext: keeps matrix values that are not GitHub Actions events', () => {
  const CM = makeContext();
  // "(ubuntu-latest)" is a matrix value, not an event, so it must not be stripped.
  assert.equal(CM.getOverrideContext('Test / unit (ubuntu-latest)'), 'unit (ubuntu-latest)');
});

test('getOverrideContext: leaves Prow-style contexts unchanged', () => {
  const CM = makeContext();
  // Prow contexts use "/" without surrounding spaces.
  assert.equal(CM.getOverrideContext('ci/prow/e2e-aws'), 'ci/prow/e2e-aws');
  assert.equal(CM.getOverrideContext('tide'), 'tide');
  assert.equal(CM.getOverrideContext('license/snyk ( Hybrid Platforms )'), 'license/snyk ( Hybrid Platforms )');
});

test('getOverrideContext: preserves nested job names after the workflow prefix', () => {
  const CM = makeContext();
  // Only the leading workflow-name segment is removed; nested " / " is kept.
  assert.equal(CM.getOverrideContext('Workflow / build / test (pull_request)'), 'build / test');
});

test('getOverrideContext: handles non-string and empty input', () => {
  const CM = makeContext();
  assert.equal(CM.getOverrideContext(undefined), '');
  assert.equal(CM.getOverrideContext(null), '');
  assert.equal(CM.getOverrideContext('  Docs / spellcheck  '), 'spellcheck');
});

test('DEFAULT_CONFIG: Override job-picker template quotes the context', () => {
  const CM = makeContext();
  const universal = CM.DEFAULT_CONFIG.profiles.find(p => p.id === 'profile-tide-prow-universal');
  const override = universal.globalCommands.find(c => c.command === '/override');
  // Prow contexts often contain spaces (e.g. "Lint (ubuntu-latest)"), so the
  // job-picker command must quote the inserted context.
  assert.equal(override.commandTemplate, '/override "{input}"');
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

test('getMatchingProfiles: extraProfiles adds a globally-disabled profile', () => {
  // A repo override can explicitly add a profile even when that profile has
  // enabled=false at the global level.  This is intentional: the override is an
  // explicit opt-in that should bypass the global enabled flag.
  const CM = makeContext();
  const config = makeConfig({
    repoOverrides: [{ pattern: 'org/repo', extraProfiles: ['p3'] }]
  });
  // p3 has enabled=false and repoPatterns=['org/*'] in makeConfig()
  const result = CM.getMatchingProfiles(config, 'org/repo');
  const ids = result.map(p => p.id);
  assert.ok(ids.includes('p3'), 'disabled profile p3 should be included when explicitly listed in extraProfiles');
});

test('getMatchingProfiles: extraProfiles silently ignores unknown profile IDs', () => {
  // If the override lists a profile ID that does not exist in config.profiles,
  // getMatchingProfiles should not throw and should return only the profiles
  // that were actually found.
  const CM = makeContext();
  const config = makeConfig({
    repoOverrides: [{ pattern: 'org/repo', extraProfiles: ['does-not-exist'] }]
  });
  assert.doesNotThrow(() => CM.getMatchingProfiles(config, 'org/repo'));
  const result = CM.getMatchingProfiles(config, 'org/repo');
  const ids = result.map(p => p.id);
  assert.ok(!ids.includes('does-not-exist'), 'unknown profile ID should be silently skipped');
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

test('migrateConfig: runs migration when stored config has no version field', async () => {
  // A config without a `version` field should be treated as older than any
  // versioned config and have migration run (adding missing built-in profiles).
  // Previously, `undefined < SCHEMA_VERSION` evaluated to `false` in JS
  // (NaN comparison), so migrateConfig was never called for unversioned configs.
  const CM = makeContextWithStorage(null);
  const unversionedConfig = {
    // version intentionally absent
    profiles: [],
    repoOverrides: [],
    globalSettings: CM.DEFAULT_CONFIG.globalSettings,
    pluginConfigSources: []
  };
  const CM2 = makeContextWithStorage(unversionedConfig);
  const config = await CM2.getConfig();
  assert.equal(config.version, CM.DEFAULT_CONFIG.version,
    'version should be bumped to schema version after migrating an unversioned config');
  assert.ok(config.profiles.length > 0,
    'built-in profiles should be added when migrating an unversioned config');
});

test('migrateConfig: preserves user-created custom (non-built-in) profiles', async () => {
  const CM = makeContextWithStorage(null);
  const v1config = {
    version: 1,
    profiles: [
      {
        id: 'user-custom-profile',
        name: 'My Custom Profile',
        enabled: true,
        repoPatterns: ['myorg/*'],
        globalCommands: [{ id: 'c1', label: 'Custom', command: '/custom', style: 'neutral' }],
        checkCommands: []
      }
    ],
    repoOverrides: [],
    globalSettings: CM.DEFAULT_CONFIG.globalSettings,
    pluginConfigSources: []
  };
  const CM2 = makeContextWithStorage(v1config);
  const config = await CM2.getConfig();
  const custom = config.profiles.find(p => p.id === 'user-custom-profile');
  assert.ok(custom, 'user-created custom profile should survive migration');
  assert.equal(custom.name, 'My Custom Profile');
  assert.equal(custom.globalCommands[0].command, '/custom');
});

// ---------------------------------------------------------------------------
// saveConfig
// ---------------------------------------------------------------------------
function makeContextWithCapturingSave() {
  let savedObj = null;
  const ctx = vm.createContext({
    window: { GHBCP: { CommandToPlugin: {} } },
    crypto: { randomUUID: () => 'test-uuid-1234' },
    document: { createElement: () => makeEscapingDiv() },
    chrome: {
      runtime: { id: 'fake-id', lastError: null },
      storage: {
        sync: {
          get: (_key, cb) => cb({}),
          set: (obj, cb) => { savedObj = obj; cb && cb(); }
        }
      }
    }
  });
  vm.runInContext(configManagerSrc, ctx);
  return { CM: ctx.window.GHBCP.ConfigManager, getSaved: () => savedObj };
}

test('saveConfig: persists config to storage under the correct key', async () => {
  const { CM, getSaved } = makeContextWithCapturingSave();
  const config = { version: 3, profiles: [], repoOverrides: [], globalSettings: {} };
  await CM.saveConfig(config);
  assert.ok(getSaved() !== null, 'storage.set should have been called');
  assert.deepEqual(getSaved()[CM.STORAGE_KEY], config);
});

test('saveConfig: rejects when chrome.runtime.lastError is set after set', async () => {
  const ctx = vm.createContext({
    window: { GHBCP: { CommandToPlugin: {} } },
    crypto: { randomUUID: () => 'test-uuid-1234' },
    document: { createElement: () => makeEscapingDiv() },
    chrome: {
      runtime: { id: 'fake-id', get lastError() { return { message: 'quota exceeded' }; } },
      storage: {
        sync: {
          get: (_key, cb) => cb({}),
          set: (_obj, cb) => cb && cb()
        }
      }
    }
  });
  vm.runInContext(configManagerSrc, ctx);
  const CM = ctx.window.GHBCP.ConfigManager;
  await assert.rejects(() => CM.saveConfig({ version: 3 }));
});

test('saveConfig: is a no-op when extension context is invalid', async () => {
  const ctx = vm.createContext({
    window: { GHBCP: { CommandToPlugin: {} } },
    crypto: { randomUUID: () => 'test-uuid-1234' },
    document: { createElement: () => makeEscapingDiv() },
    chrome: {
      runtime: { get id() { return undefined; } },
      storage: { sync: { get: (_k, cb) => cb({}), set: () => { throw new Error('should not be called'); } } }
    }
  });
  vm.runInContext(configManagerSrc, ctx);
  const CM = ctx.window.GHBCP.ConfigManager;
  await assert.doesNotReject(() => CM.saveConfig({ version: 3 }));
});

// ---------------------------------------------------------------------------
// resetToDefaults
// ---------------------------------------------------------------------------
test('resetToDefaults: returns DEFAULT_CONFIG and saves it to storage', async () => {
  const { CM, getSaved } = makeContextWithCapturingSave();
  const config = await CM.resetToDefaults();
  assert.equal(config.version, CM.DEFAULT_CONFIG.version, 'returned config has correct version');
  assert.ok(Array.isArray(config.profiles), 'returned config has profiles array');
  assert.ok(getSaved() !== null, 'storage.set should have been called');
  assert.equal(getSaved()[CM.STORAGE_KEY].version, CM.DEFAULT_CONFIG.version,
    'saved config version should match DEFAULT_CONFIG version');
});

test('resetToDefaults: saved config has the same version as the returned config', async () => {
  const { CM, getSaved } = makeContextWithCapturingSave();
  const config = await CM.resetToDefaults();
  assert.equal(
    getSaved()[CM.STORAGE_KEY].version,
    config.version,
    'saved config version should match returned config version'
  );
});

test('filterCommandsByPlugins: mode=filter also filters checkCommands', () => {
  const CM = makeContext({ '/lgtm': 'lgtm', '/hold': 'hold' });
  const profiles = makeProfiles([
    { command: '/lgtm', label: 'LGTM' },
    { command: '/hold', label: 'Hold' }
  ]);
  const result = CM.filterCommandsByPlugins(profiles, ['lgtm'], 'filter');
  assert.equal(result[0].checkCommands.length, 1,
    'checkCommands should also be filtered, not just globalCommands');
  assert.equal(result[0].checkCommands[0].command, '/lgtm');
});

test('filterCommandsByPlugins: mode=indicate also marks checkCommands', () => {
  const CM = makeContext({ '/lgtm': 'lgtm', '/hold': 'hold' });
  const profiles = makeProfiles([
    { command: '/lgtm', label: 'LGTM' },
    { command: '/hold', label: 'Hold' }
  ]);
  const result = CM.filterCommandsByPlugins(profiles, ['lgtm'], 'indicate');
  const checkCmds = result[0].checkCommands;
  assert.equal(checkCmds.length, 2, 'Both checkCommands should be kept in indicate mode');
  const lgtm = checkCmds.find(c => c.command === '/lgtm');
  const hold = checkCmds.find(c => c.command === '/hold');
  assert.equal(lgtm._pluginDisabled, false, '/lgtm checkCommand should not be disabled');
  assert.equal(hold._pluginDisabled, true, '/hold checkCommand should be marked disabled');
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

// ---------------------------------------------------------------------------
// createCommand
// ---------------------------------------------------------------------------
test('createCommand: returns object with required fields and defaults', () => {
  const CM = makeContext();
  const c = CM.createCommand('LGTM', '/lgtm', 'success');
  assert.equal(c.label, 'LGTM');
  assert.equal(c.command, '/lgtm');
  assert.equal(c.style, 'success');
  assert.equal(c.requireConfirm, false);
  assert.equal(c.hasInput, false);
  assert.equal(c.hasJobPicker, false);
  assert.equal(c.jobPickerFilter, 'all');
  assert.equal(c.joinMode, '');
  assert.equal(c.inputPlaceholder, '');
  assert.equal(c.commandTemplate, '');
  assert.equal(c.shortcut, '');
  assert.ok(typeof c.id === 'string' && c.id.length > 0, 'id should be a non-empty string');
});

test('createCommand: description defaults to the command string when not provided', () => {
  const CM = makeContext();
  const c = CM.createCommand('Label', '/label', 'neutral');
  assert.equal(c.description, '/label');
});

test('createCommand: opts override defaults', () => {
  const CM = makeContext();
  const c = CM.createCommand('Test', '/test', 'primary', {
    description: 'Run a CI job',
    shortcut: 'Alt+T',
    requireConfirm: true,
    hasJobPicker: true,
    commandTemplate: '/test {input}',
    jobPickerFilter: 'failed'
  });
  assert.equal(c.description, 'Run a CI job');
  assert.equal(c.shortcut, 'Alt+T');
  assert.equal(c.requireConfirm, true);
  assert.equal(c.hasJobPicker, true);
  assert.equal(c.commandTemplate, '/test {input}');
  assert.equal(c.jobPickerFilter, 'failed');
});

test('createCommand: style defaults to neutral when not provided', () => {
  const CM = makeContext();
  const c = CM.createCommand('Hold', '/hold', '');
  assert.equal(c.style, 'neutral');
});

// ---------------------------------------------------------------------------
// getMatchingProfiles / getExtraCommands: defensive against missing arrays
// ---------------------------------------------------------------------------
test('getMatchingProfiles: does not throw when config.repoOverrides is missing', () => {
  const CM = makeContext();
  const config = {
    profiles: [{ id: 'p1', name: 'P1', enabled: true, repoPatterns: ['*'], globalCommands: [], checkCommands: [] }]
    // repoOverrides intentionally absent
  };
  assert.doesNotThrow(() => CM.getMatchingProfiles(config, 'org/repo'));
  const result = CM.getMatchingProfiles(config, 'org/repo');
  assert.equal(result.length, 1);
});

test('getMatchingProfiles: does not throw when config.profiles is missing', () => {
  const CM = makeContext();
  const config = { repoOverrides: [] };
  assert.doesNotThrow(() => CM.getMatchingProfiles(config, 'org/repo'));
  const result = CM.getMatchingProfiles(config, 'org/repo');
  assert.equal(result.length, 0);
});

test('getExtraCommands: does not throw when config.repoOverrides is missing', () => {
  const CM = makeContext();
  const config = { profiles: [] };
  assert.doesNotThrow(() => CM.getExtraCommands(config, 'org/repo'));
  const result = CM.getExtraCommands(config, 'org/repo');
  assert.equal(result.length, 0);
});

// ---------------------------------------------------------------------------
// migrateConfig: custom (non-built-in) profiles are preserved
// ---------------------------------------------------------------------------
test('migrateConfig: custom profiles (not in BUILTIN_PROFILE_IDS) are preserved unchanged', async () => {
  const CM = makeContextWithStorage(null);
  const v1config = {
    version: 1,
    profiles: [
      {
        id: 'profile-custom-user',
        name: 'My Custom Profile',
        enabled: true,
        repoPatterns: ['myorg/*'],
        globalCommands: [{ id: 'c1', label: 'Custom', command: '/custom', style: 'neutral' }],
        checkCommands: [],
        dynamicCommands: []
      }
    ],
    repoOverrides: [],
    globalSettings: CM.DEFAULT_CONFIG.globalSettings,
    pluginConfigSources: []
  };
  const CM2 = makeContextWithStorage(v1config);
  const config = await CM2.getConfig();
  const custom = config.profiles.find(p => p.id === 'profile-custom-user');
  assert.ok(custom, 'custom profile should be preserved after migration');
  assert.equal(custom.name, 'My Custom Profile', 'custom profile name should be unchanged');
  assert.equal(custom.globalCommands.length, 1, 'custom profile commands should be preserved');
  assert.equal(custom.globalCommands[0].command, '/custom');
});

test('migrateConfig: migration adds built-in profiles without removing existing custom profiles', async () => {
  const CM = makeContextWithStorage(null);
  const v1config = {
    version: 1,
    profiles: [
      {
        id: 'profile-my-org-ci',
        name: 'My Org CI',
        enabled: true,
        repoPatterns: ['myorg/*'],
        globalCommands: [],
        checkCommands: [],
        dynamicCommands: []
      }
    ],
    repoOverrides: [],
    globalSettings: CM.DEFAULT_CONFIG.globalSettings,
    pluginConfigSources: []
  };
  const CM2 = makeContextWithStorage(v1config);
  const config = await CM2.getConfig();
  const custom = config.profiles.find(p => p.id === 'profile-my-org-ci');
  assert.ok(custom, 'custom profile should survive migration');
  const hasBuiltin = config.profiles.some(p => p.id === 'profile-tide-prow-universal');
  assert.ok(hasBuiltin, 'built-in profiles should be added alongside the custom profile');
});

// ---------------------------------------------------------------------------
// isRepoExcluded
// ---------------------------------------------------------------------------
test('isRepoExcluded: returns false when excludedRepos is empty', () => {
  const CM = makeContext();
  const config = { globalSettings: { excludedRepos: [] } };
  assert.equal(CM.isRepoExcluded(config, 'org/repo'), false);
});

test('isRepoExcluded: returns false when excludedRepos is missing', () => {
  const CM = makeContext();
  const config = { globalSettings: {} };
  assert.equal(CM.isRepoExcluded(config, 'org/repo'), false);
});

test('isRepoExcluded: exact match excludes repo', () => {
  const CM = makeContext();
  const config = { globalSettings: { excludedRepos: ['velero-io/velero'] } };
  assert.equal(CM.isRepoExcluded(config, 'velero-io/velero'), true);
  assert.equal(CM.isRepoExcluded(config, 'velero-io/other'), false);
});

test('isRepoExcluded: glob pattern excludes matching repos', () => {
  const CM = makeContext();
  const config = { globalSettings: { excludedRepos: ['some-org/*'] } };
  assert.equal(CM.isRepoExcluded(config, 'some-org/repo1'), true);
  assert.equal(CM.isRepoExcluded(config, 'some-org/repo2'), true);
  assert.equal(CM.isRepoExcluded(config, 'other-org/repo1'), false);
});

test('isRepoExcluded: multiple patterns checked', () => {
  const CM = makeContext();
  const config = { globalSettings: { excludedRepos: ['org-a/repo', 'org-b/*'] } };
  assert.equal(CM.isRepoExcluded(config, 'org-a/repo'), true);
  assert.equal(CM.isRepoExcluded(config, 'org-b/anything'), true);
  assert.equal(CM.isRepoExcluded(config, 'org-c/repo'), false);
});

test('migrateConfig: adds excludedRepos to globalSettings when missing', async () => {
  const v3config = {
    version: 3,
    profiles: [],
    repoOverrides: [],
    globalSettings: { enabled: true, confirmBeforePost: false, showOnlyFailedTests: true,
                      theme: 'auto', buttonPosition: 'above-comment-box', autoSubmit: false,
                      pluginFilterMode: 'filter' },
    pluginConfigSources: []
  };
  const CM = makeContextWithStorage(v3config);
  const config = await CM.getConfig();
  assert.ok(Array.isArray(config.globalSettings.excludedRepos), 'excludedRepos should be an array after migration');
  assert.equal(config.globalSettings.excludedRepos.length, 0);
});

// ---------------------------------------------------------------------------
// isProwProfile
// ---------------------------------------------------------------------------
test('isProwProfile: returns true for built-in Prow profile IDs', () => {
  const CM = makeContext();
  assert.equal(CM.isProwProfile('profile-tide-prow-universal'), true);
  assert.equal(CM.isProwProfile('profile-prow-openshift-release'), true);
});

test('isProwProfile: returns false for non-Prow profile IDs', () => {
  const CM = makeContext();
  assert.equal(CM.isProwProfile('profile-mergify'), false);
  assert.equal(CM.isProwProfile('profile-claude'), false);
  assert.equal(CM.isProwProfile('custom-profile'), false);
});

test('migrateConfig: adds prowAutoDetect to globalSettings when missing', async () => {
  const v4config = {
    version: 4,
    profiles: [],
    repoOverrides: [],
    globalSettings: { enabled: true, confirmBeforePost: false, showOnlyFailedTests: true,
                      theme: 'auto', buttonPosition: 'above-comment-box', autoSubmit: false,
                      pluginFilterMode: 'filter', excludedRepos: [] },
    pluginConfigSources: []
  };
  const CM = makeContextWithStorage(v4config);
  const config = await CM.getConfig();
  assert.equal(config.globalSettings.prowAutoDetect, true, 'prowAutoDetect should default to true after migration');
});

test('migrateConfig: backfills presubmitsBasePath on openshift/release sources', async () => {
  const v6config = {
    version: 6,
    profiles: [],
    repoOverrides: [],
    globalSettings: { enabled: true },
    pluginConfigSources: [
      { id: 's1', name: 'OpenShift CI', enabled: true, configRepo: 'openshift/release', branch: 'master' },
      { id: 's2', name: 'Other', enabled: true, configRepo: 'kubernetes/test-infra', branch: 'master' }
    ]
  };
  const CM = makeContextWithStorage(v6config);
  const config = await CM.getConfig();
  const os = config.pluginConfigSources.find(s => s.id === 's1');
  const other = config.pluginConfigSources.find(s => s.id === 's2');
  assert.equal(os.presubmitsBasePath, 'ci-operator/jobs', 'openshift/release source should be backfilled');
  assert.equal(other.presubmitsBasePath, undefined, 'non-openshift sources should be untouched');
});

test('migrateConfig: does not overwrite a custom presubmitsBasePath', async () => {
  const v6config = {
    version: 6,
    profiles: [],
    repoOverrides: [],
    globalSettings: { enabled: true },
    pluginConfigSources: [
      { id: 's1', enabled: true, configRepo: 'openshift/release', presubmitsBasePath: 'custom/path' }
    ]
  };
  const CM = makeContextWithStorage(v6config);
  const config = await CM.getConfig();
  assert.equal(config.pluginConfigSources[0].presubmitsBasePath, 'custom/path',
    'user-set presubmitsBasePath should be preserved by migration');
});

test('DEFAULT_CONFIG: Rehearse All expands to explicit job list with confirmation', () => {
  const CM = makeContextWithStorage(null);
  const profile = CM.DEFAULT_CONFIG.profiles.find(p => p.id === 'profile-prow-openshift-release');
  assert.ok(profile, 'openshift/release profile should exist');
  const rehearseAll = profile.globalCommands.find(c => c.label === 'Rehearse All');
  assert.ok(rehearseAll, 'Rehearse All command should exist');
  assert.equal(rehearseAll.expandRehearsalJobs, true);
  assert.equal(rehearseAll.requireConfirm, true);
  assert.equal(rehearseAll.command, '/pj-rehearse');
});

test('createCommand: expandRehearsalJobs defaults to false and is settable', () => {
  const CM = makeContextWithStorage(null);
  assert.equal(CM.createCommand('X', '/x', 'primary').expandRehearsalJobs, false);
  assert.equal(CM.createCommand('X', '/x', 'primary', { expandRehearsalJobs: true }).expandRehearsalJobs, true);
});

test('DEFAULT_CONFIG: Cherry-pick command uses the branch picker', () => {
  const CM = makeContextWithStorage(null);
  const profile = CM.DEFAULT_CONFIG.profiles.find(p => p.id === 'profile-tide-prow-universal');
  const cherryPick = profile.globalCommands.find(c => c.label === 'Cherry-pick...');
  assert.ok(cherryPick, 'Cherry-pick... command should exist in the universal Prow profile');
  assert.equal(cherryPick.hasJobPicker, true);
  assert.equal(cherryPick.jobSource, 'branches');
  assert.equal(cherryPick.commandTemplate, '/cherry-pick {input}');
});

test('DEFAULT_CONFIG: verified and jira commands exist in universal profile', () => {
  const CM = makeContextWithStorage(null);
  const profile = CM.DEFAULT_CONFIG.profiles.find(p => p.id === 'profile-tide-prow-universal');
  const commands = profile.globalCommands.map(c => c.command);
  for (const expected of ['/verified by', '/verified later', '/verified bypass', '/verified remove',
                          '/jira refresh', '/jira backport', '/jira cherrypick', '/cherrypick']) {
    assert.ok(commands.includes(expected), `${expected} should exist in universal profile`);
  }
});

test('DEFAULT_CONFIG: /jira backport joins branches with commas, /cherrypick with spaces', () => {
  const CM = makeContextWithStorage(null);
  const profile = CM.DEFAULT_CONFIG.profiles.find(p => p.id === 'profile-tide-prow-universal');
  const backport = profile.globalCommands.find(c => c.command === '/jira backport');
  assert.equal(backport.joinMode, 'single-command-comma');
  assert.equal(backport.jobSource, 'branches');
  const chain = profile.globalCommands.find(c => c.command === '/cherrypick');
  assert.equal(chain.joinMode, 'single-command');
  assert.equal(chain.jobSource, 'branches');
});

test('DEFAULT_CONFIG: payload profile targets openshift/* with all seven commands', () => {
  const CM = makeContextWithStorage(null);
  const profile = CM.DEFAULT_CONFIG.profiles.find(p => p.id === 'profile-payload-openshift');
  assert.ok(profile, 'payload profile should exist');
  assert.deepEqual([...profile.repoPatterns], ['openshift/*']);
  const commands = profile.globalCommands.map(c => c.command);
  assert.deepEqual([...commands].sort(), ['/payload', '/payload-abort', '/payload-aggregate',
    '/payload-aggregate-with-prs', '/payload-job', '/payload-job-with-prs', '/payload-with-prs'].sort());
  const inputCommands = ['/payload', '/payload-job', '/payload-aggregate',
    '/payload-with-prs', '/payload-job-with-prs', '/payload-aggregate-with-prs'];
  for (const name of inputCommands) {
    const c = profile.globalCommands.find(x => x.command === name);
    assert.equal(c.hasPayloadPicker, true, `${name} should open the payload picker`);
    assert.equal(c.hasInput, false, `${name} uses the structured picker, not free-form input`);
  }
  const abort = profile.globalCommands.find(c => c.command === '/payload-abort');
  assert.equal(abort.hasPayloadPicker, false, '/payload-abort posts directly');
  assert.equal(abort.hasInput, false, '/payload-abort takes no input');
  assert.equal(abort.requireConfirm, true);
});

test('DEFAULT_CONFIG: OpenShift labels profile has only /label commands', () => {
  const CM = makeContextWithStorage(null);
  const profile = CM.DEFAULT_CONFIG.profiles.find(p => p.id === 'profile-openshift-labels');
  assert.ok(profile, 'labels profile should exist');
  assert.deepEqual([...profile.repoPatterns], ['openshift/*', 'openshift-priv/*']);
  const labelCommands = profile.globalCommands.map(c => c.command);
  assert.deepEqual([...labelCommands].sort(), [
    '/label backport-risk-assessed',
    '/label cherry-pick-approved',
    '/label docs-approved',
    '/label jira/skip-dependent-bug-check',
    '/label px-approved',
    '/label qe-approved',
    '/label staff-eng-approved',
    '/label tide/merge-method-merge',
    '/label tide/merge-method-rebase',
    '/label tide/merge-method-squash'
  ]);
});

test('DEFAULT_CONFIG: /publicize is scoped to openshift-priv/* and requires confirm', () => {
  const CM = makeContextWithStorage(null);
  const profile = CM.DEFAULT_CONFIG.profiles.find(p => p.id === 'profile-openshift-priv');
  assert.ok(profile, 'openshift-priv profile should exist');
  assert.deepEqual([...profile.repoPatterns], ['openshift-priv/*']);
  const publicize = profile.globalCommands.find(c => c.command === '/publicize');
  assert.ok(publicize);
  assert.equal(publicize.requireConfirm, true);
  assert.equal(CM.globMatch('openshift-priv/*', 'openshift/origin'), false,
    'openshift-priv pattern must not match openshift org');
  assert.equal(CM.globMatch('openshift-priv/*', 'openshift-priv/origin'), true);
});

test('isProwProfile: new OpenShift profiles are Prow profiles (prowAutoDetect gating)', () => {
  const CM = makeContextWithStorage(null);
  for (const id of ['profile-payload-openshift', 'profile-openshift-labels',
                    'profile-openshift-priv', 'profile-openshift-specialized']) {
    assert.equal(CM.isProwProfile(id), true, `${id} should be a Prow profile`);
  }
});

test('DEFAULT_CONFIG: specialized profile exposes its OpenShift commands', () => {
  const CM = makeContextWithStorage(null);
  const profile = CM.DEFAULT_CONFIG.profiles.find(p => p.id === 'profile-openshift-specialized');
  assert.ok(profile, 'specialized profile should exist');
  assert.deepEqual([...profile.repoPatterns], ['openshift/*']);
  assert.deepEqual([...profile.globalCommands].map(c => c.command), [
    '/testwith',
    '/testwith abort',
    '/validate-backports',
    '/pipeline required'
  ]);
  assert.equal(profile.globalCommands.find(c => c.command === '/testwith abort').requireConfirm, true,
    'aborting in-flight jobs should require confirmation');
});
