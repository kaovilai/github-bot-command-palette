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

/**
 * Build a stored v13 universal profile: the v14 default rewound to its v13
 * shape — the plain branch picker (joinMode '', v13 description) plus the
 * separate "Cherry-pick Chain..." entry that v14 removed. Shaped like a real
 * stored object (cmd() always wrote a joinMode string), not a v14 default
 * with fields deleted.
 */
function buildStoredV13Profile(CM) {
  const profile = JSON.parse(JSON.stringify(
    CM.DEFAULT_CONFIG.profiles.find(p => p.id === 'profile-tide-prow-universal')));
  const plain = profile.globalCommands.find(c => c.label === 'Cherry-pick...');
  plain.joinMode = ''; // v13's plain branch picker had no chain toggle
  plain.description = 'Cherry-pick this PR to selected branches'; // v13 text
  profile.globalCommands.push({
    id: 'cmd-old-chain',
    label: 'Cherry-pick Chain...',
    command: '/cherrypick',
    description: 'Serial cherry-pick chain: first branch now, remaining branches hop after each merge',
    style: 'neutral',
    requireConfirm: false,
    hasInput: false,
    hasJobPicker: true,
    hasPayloadPicker: false,
    jobPickerFilter: 'all',
    jobSource: 'branches',
    joinMode: 'single-command',
    expandRehearsalJobs: false,
    inputPlaceholder: 'branch1 branch2',
    commandTemplate: '/cherrypick {input}',
    shortcut: ''
  });
  return profile;
}

test('migrateConfig: v13 config upgrades to the choose-mode Cherry-pick command', async () => {
  // Schema v14 merged the separate "Cherry-pick Chain..." button into
  // "Cherry-pick..." with joinMode 'choose' — the picker's Chain picks
  // toggle now decides parallel vs sequential chain per post. A stored v13
  // config carrying both old entries must come out with only the merged one.
  const CM = makeContextWithStorage(null);
  const v13Profile = buildStoredV13Profile(CM);
  const CM2 = makeContextWithStorage({
    version: 13,
    profiles: [v13Profile],
    repoOverrides: [],
    globalSettings: CM.DEFAULT_CONFIG.globalSettings,
    pluginConfigSources: []
  });
  const config = await CM2.getConfig();
  assert.equal(config.version, CM.DEFAULT_CONFIG.version, 'version should be bumped past 13');
  const profile = config.profiles.find(p => p.id === 'profile-tide-prow-universal');
  const cherryPick = profile.globalCommands.find(c => c.label === 'Cherry-pick...');
  assert.ok(cherryPick, 'merged Cherry-pick... command should exist after migration');
  assert.equal(cherryPick.joinMode, 'choose');
  assert.ok(!profile.globalCommands.some(c => c.command === '/cherrypick'),
    'old Cherry-pick Chain... entry should be dropped by the v14 merge');
});

test('migrateConfig: v13 keeps saved edits to built-in profiles', async () => {
  // The settings editor edits built-in profiles in place, so the v13 → v14
  // step must not refresh them wholesale: saved name/description/patterns,
  // edited commands, and added commands all survive — only the Cherry-pick
  // merge (drop the Chain entry, default the picker to 'choose') applies.
  const CM = makeContextWithStorage(null);
  const v13Profile = buildStoredV13Profile(CM);
  v13Profile.name = 'My Prow commands';
  v13Profile.description = 'tweaked by me';
  v13Profile.repoPatterns = ['openshift/*'];
  const cc = v13Profile.globalCommands.find(c => c.command === '/cc');
  cc.label = 'Ping User';
  v13Profile.globalCommands.push({
    id: 'cmd-my-own', label: 'Hold', command: '/hold', description: 'Hold merge',
    style: 'warning', requireConfirm: false, hasInput: false, hasJobPicker: false,
    hasPayloadPicker: false, jobPickerFilter: 'all', jobSource: '', joinMode: '',
    expandRehearsalJobs: false, inputPlaceholder: '', commandTemplate: '', shortcut: ''
  });
  const CM2 = makeContextWithStorage({
    version: 13,
    profiles: [v13Profile],
    repoOverrides: [],
    globalSettings: CM.DEFAULT_CONFIG.globalSettings,
    pluginConfigSources: []
  });
  const config = await CM2.getConfig();
  const profile = config.profiles.find(p => p.id === 'profile-tide-prow-universal');
  assert.equal(profile.name, 'My Prow commands', 'edited profile name should survive');
  assert.equal(profile.description, 'tweaked by me', 'edited profile description should survive');
  assert.deepEqual(profile.repoPatterns, ['openshift/*'], 'edited repoPatterns should survive');
  assert.ok(profile.globalCommands.some(c => c.label === 'Ping User'),
    'edited built-in command should survive');
  assert.ok(profile.globalCommands.some(c => c.id === 'cmd-my-own'),
    'command added to the built-in profile should survive');
  const cherryPick = profile.globalCommands.find(c => c.command === '/cherry-pick');
  assert.equal(cherryPick.joinMode, 'choose', 'default v13 joinMode still upgrades to choose');
  assert.ok(!profile.globalCommands.some(c => c.command === '/cherrypick'),
    'old Cherry-pick Chain... entry should still be dropped');
});

test('migrateConfig: v13 keeps a customized Cherry-pick joinMode', async () => {
  // A user who set their own joinMode on the branch picker (e.g. always
  // chain) must not have it overwritten with the new 'choose' default.
  const CM = makeContextWithStorage(null);
  const v13Profile = buildStoredV13Profile(CM);
  v13Profile.globalCommands.find(c => c.command === '/cherry-pick').joinMode = 'single-command';
  const CM2 = makeContextWithStorage({
    version: 13,
    profiles: [v13Profile],
    repoOverrides: [],
    globalSettings: CM.DEFAULT_CONFIG.globalSettings,
    pluginConfigSources: []
  });
  const config = await CM2.getConfig();
  const profile = config.profiles.find(p => p.id === 'profile-tide-prow-universal');
  const cherryPick = profile.globalCommands.find(c => c.command === '/cherry-pick');
  assert.equal(cherryPick.joinMode, 'single-command',
    'customized joinMode should survive the v13 → v14 migration');
});

test('migrateConfig: v13 keeps a user-added /cherrypick in other built-in profiles', async () => {
  // The v14 Chain-entry removal must apply only to the universal profile
  // (the only built-in whose v13 default carried it). A /cherrypick command
  // the user added to an unrelated built-in profile is their own config and
  // must survive the migration.
  const CM = makeContextWithStorage(null);
  const v13Profile = buildStoredV13Profile(CM);
  const releaseProfile = JSON.parse(JSON.stringify(
    CM.DEFAULT_CONFIG.profiles.find(p => p.id === 'profile-prow-openshift-release')));
  releaseProfile.globalCommands.push({
    id: 'cmd-my-chain', label: 'My Chain', command: '/cherrypick',
    description: 'user-added chain command', style: 'neutral', requireConfirm: false,
    hasInput: false, hasJobPicker: true, hasPayloadPicker: false, jobPickerFilter: 'all',
    jobSource: 'branches', joinMode: 'single-command', expandRehearsalJobs: false,
    inputPlaceholder: 'branch1 branch2', commandTemplate: '/cherrypick {input}', shortcut: ''
  });
  const CM2 = makeContextWithStorage({
    version: 13,
    profiles: [v13Profile, releaseProfile],
    repoOverrides: [],
    globalSettings: CM.DEFAULT_CONFIG.globalSettings,
    pluginConfigSources: []
  });
  const config = await CM2.getConfig();
  const universal = config.profiles.find(p => p.id === 'profile-tide-prow-universal');
  assert.ok(!universal.globalCommands.some(c => c.command === '/cherrypick'),
    "the universal profile's old Chain entry should still be dropped");
  const release = config.profiles.find(p => p.id === 'profile-prow-openshift-release');
  assert.ok(release.globalCommands.some(c => c.id === 'cmd-my-chain'),
    'user-added /cherrypick in another built-in profile should survive');
});

test('migrateConfig: v13 keeps the Chain entry when no replacement exists', async () => {
  // A user who deleted the plain /cherry-pick picker but kept the Chain
  // button has no merged replacement — removing the Chain entry would leave
  // them without any cherry-pick action, so it must stay.
  const CM = makeContextWithStorage(null);
  const v13Profile = buildStoredV13Profile(CM);
  v13Profile.globalCommands = v13Profile.globalCommands
    .filter(c => c.command !== '/cherry-pick');
  const CM2 = makeContextWithStorage({
    version: 13,
    profiles: [v13Profile],
    repoOverrides: [],
    globalSettings: CM.DEFAULT_CONFIG.globalSettings,
    pluginConfigSources: []
  });
  const config = await CM2.getConfig();
  const profile = config.profiles.find(p => p.id === 'profile-tide-prow-universal');
  assert.ok(profile.globalCommands.some(c => c.command === '/cherrypick'),
    'the Chain entry should survive when the /cherry-pick replacement is absent');
});

test('migrateConfig: v13 keeps the Chain entry when the replacement picker is disabled', async () => {
  // The settings editor exposes a "Has job picker" toggle: a user can turn
  // the /cherry-pick command into a free-text command while keeping it. That
  // is not a usable replacement for the Chain branch picker, so the Chain
  // entry must survive (and the free-text command must not be upgraded).
  const CM = makeContextWithStorage(null);
  const v13Profile = buildStoredV13Profile(CM);
  const plain = v13Profile.globalCommands.find(c => c.command === '/cherry-pick');
  plain.hasJobPicker = false;
  plain.jobSource = '';
  const CM2 = makeContextWithStorage({
    version: 13,
    profiles: [v13Profile],
    repoOverrides: [],
    globalSettings: CM.DEFAULT_CONFIG.globalSettings,
    pluginConfigSources: []
  });
  const config = await CM2.getConfig();
  const profile = config.profiles.find(p => p.id === 'profile-tide-prow-universal');
  assert.ok(profile.globalCommands.some(c => c.command === '/cherrypick' && c.hasJobPicker),
    'the Chain branch picker should survive when the replacement is not a picker');
  const after = profile.globalCommands.find(c => c.command === '/cherry-pick');
  assert.equal(after.joinMode, '', 'non-picker replacement should not be upgraded to choose');
});

test('migrateConfig: v13 keeps a non-picker user-added /cherrypick command', async () => {
  // Only the legacy Chain entry — a /cherrypick branch picker — is dropped.
  // A user-added /cherrypick that is not a branch picker (e.g. a free-text
  // variant) is their own config and must survive the merge.
  const CM = makeContextWithStorage(null);
  const v13Profile = buildStoredV13Profile(CM);
  v13Profile.globalCommands.push({
    id: 'cmd-my-text-chain', label: 'Quick chain', command: '/cherrypick',
    description: 'user-added free-text chain', style: 'neutral', requireConfirm: false,
    hasInput: true, hasJobPicker: false, hasPayloadPicker: false, jobPickerFilter: 'all',
    jobSource: '', joinMode: '', expandRehearsalJobs: false,
    inputPlaceholder: 'branches', commandTemplate: '/cherrypick {input}', shortcut: ''
  });
  const CM2 = makeContextWithStorage({
    version: 13,
    profiles: [v13Profile],
    repoOverrides: [],
    globalSettings: CM.DEFAULT_CONFIG.globalSettings,
    pluginConfigSources: []
  });
  const config = await CM2.getConfig();
  const profile = config.profiles.find(p => p.id === 'profile-tide-prow-universal');
  assert.ok(profile.globalCommands.some(c => c.id === 'cmd-my-text-chain'),
    'non-picker user-added /cherrypick should survive the merge');
  assert.ok(!profile.globalCommands.some(c => c.command === '/cherrypick' && c.hasJobPicker),
    'the legacy Chain branch picker should still be dropped');
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

// Rebuild the config from what saveConfig wrote, whether it stored it inline
// or sharded across `<key>_part_<n>` keys (configs over the 8 KB sync item cap).
function reassembleSaved(saved, key) {
  const head = saved[key];
  if (!head || typeof head._chunks !== 'number') return head;
  let json = '';
  for (let i = 0; i < head._chunks; i++) json += saved[key + '_part_' + i];
  return JSON.parse(json);
}

test('saveConfig: persists config to storage under the correct key', async () => {
  const { CM, getSaved } = makeContextWithCapturingSave();
  const config = { version: 3, profiles: [], repoOverrides: [], globalSettings: {} };
  await CM.saveConfig(config);
  assert.ok(getSaved() !== null, 'storage.set should have been called');
  assert.deepEqual(getSaved()[CM.STORAGE_KEY], config);
});

// A stateful chrome.storage.sync stub that enforces the real 8192-byte per-item
// quota (key + JSON value), so tests catch configs a real browser would reject.
function makeContextWithQuotaStorage() {
  const store = {};
  const ctx = vm.createContext({
    window: { GHBCP: { CommandToPlugin: {} } },
    crypto: { randomUUID: () => 'test-uuid-1234' },
    document: { createElement: () => makeEscapingDiv() },
    chrome: {
      runtime: { id: 'fake-id', lastError: null },
      storage: {
        sync: {
          get: (keys, cb) => {
            const list = Array.isArray(keys) ? keys : [keys];
            const out = {};
            for (const k of list) if (k in store) out[k] = JSON.parse(JSON.stringify(store[k]));
            cb(out);
          },
          set: (items, cb) => {
            for (const [k, v] of Object.entries(items)) {
              if (k.length + JSON.stringify(v).length > 8192) {
                ctx.chrome.runtime.lastError = { message: 'Resource::kQuotaBytesPerItem quota exceeded' };
                cb(); ctx.chrome.runtime.lastError = null;
                return;
              }
            }
            for (const [k, v] of Object.entries(items)) store[k] = JSON.parse(JSON.stringify(v));
            cb();
          },
          remove: (keys, cb) => { for (const k of [].concat(keys)) delete store[k]; cb && cb(); }
        }
      }
    }
  });
  vm.runInContext(configManagerSrc, ctx);
  return { CM: ctx.window.GHBCP.ConfigManager, store };
}

test('saveConfig: default-size config (>8 KB) saves under the per-item sync quota and round-trips', async () => {
  const { CM, store } = makeContextWithQuotaStorage();
  const config = JSON.parse(JSON.stringify(CM.DEFAULT_CONFIG));
  assert.ok(JSON.stringify(config).length > 8192, 'precondition: config exceeds one sync item');
  await CM.saveConfig(config);
  assert.ok(Object.keys(store).length > 1, 'config should be sharded across several keys');
  const loaded = await CM.getConfig({ strict: true });
  assert.equal(JSON.stringify(loaded.profiles), JSON.stringify(config.profiles));
  assert.equal(loaded.globalSettings.autoSubmit, false);
});

test('saveConfig: autoSubmit toggled on a sharded config persists across getConfig', async () => {
  const { CM } = makeContextWithQuotaStorage();
  const config = await CM.getConfig({ strict: true });
  config.globalSettings.autoSubmit = true;
  await CM.saveConfig(config);
  const reloaded = await CM.getConfig({ strict: true });
  assert.equal(reloaded.globalSettings.autoSubmit, true);
});

test('saveConfig: small config keeps the legacy single-key format', async () => {
  const { CM, store } = makeContextWithQuotaStorage();
  await CM.saveConfig({ version: 13, profiles: [], repoOverrides: [], globalSettings: {} });
  assert.deepEqual(Object.keys(store), [CM.STORAGE_KEY]);
  assert.equal(typeof store[CM.STORAGE_KEY]._chunks, 'undefined');
});

test('saveConfig: shrinking from sharded to inline removes stale chunk keys', async () => {
  const { CM, store } = makeContextWithQuotaStorage();
  await CM.saveConfig(JSON.parse(JSON.stringify(CM.DEFAULT_CONFIG)));
  assert.ok(Object.keys(store).length > 1);
  await CM.saveConfig({ version: 13, profiles: [], repoOverrides: [], globalSettings: {} });
  assert.deepEqual(Object.keys(store), [CM.STORAGE_KEY]);
});

test('getConfig({strict}): rejects when a stored chunk is missing', async () => {
  const { CM, store } = makeContextWithQuotaStorage();
  await CM.saveConfig(JSON.parse(JSON.stringify(CM.DEFAULT_CONFIG)));
  delete store[CM.STORAGE_KEY + '_part_1'];
  await assert.rejects(() => CM.getConfig({ strict: true }), /incomplete/);
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
// getGithubToken / saveGithubToken / clearGithubToken
// ---------------------------------------------------------------------------
// These use chrome.storage.local (device-scoped), deliberately separate from
// the chrome.storage.sync config blob the tests above exercise.
function makeContextWithLocalStorage(storedToken, lastError = null) {
  let saved = null;
  let removedKey = null;
  const ctx = vm.createContext({
    window: { GHBCP: { CommandToPlugin: {} } },
    crypto: { randomUUID: () => 'test-uuid-1234' },
    document: { createElement: () => makeEscapingDiv() },
    chrome: {
      runtime: { id: 'fake-id', get lastError() { return lastError; } },
      storage: {
        local: {
          get: (key, cb) => cb(storedToken == null ? {} : { [key]: storedToken }),
          set: (obj, cb) => { saved = obj; cb && cb(); },
          remove: (key, cb) => { removedKey = key; cb && cb(); }
        }
      }
    }
  });
  vm.runInContext(configManagerSrc, ctx);
  return {
    CM: ctx.window.GHBCP.ConfigManager,
    getSaved: () => saved,
    getRemovedKey: () => removedKey
  };
}

test('getGithubToken: returns null when nothing is stored', async () => {
  const { CM } = makeContextWithLocalStorage(null);
  assert.equal(await CM.getGithubToken(), null);
});

test('getGithubToken: returns the stored token', async () => {
  const { CM } = makeContextWithLocalStorage('ghp_test123');
  assert.equal(await CM.getGithubToken(), 'ghp_test123');
});

test('getGithubToken: returns null when chrome.runtime.lastError is set', async () => {
  const { CM } = makeContextWithLocalStorage('ghp_test123', { message: 'quota exceeded' });
  assert.equal(await CM.getGithubToken(), null);
});

test('saveGithubToken: persists to chrome.storage.local under its own key, not the synced config blob', async () => {
  const { CM, getSaved } = makeContextWithLocalStorage(null);
  await CM.saveGithubToken('ghp_newtoken');
  const saved = getSaved();
  assert.ok(saved, 'storage.local.set should have been called');
  assert.equal(Object.keys(saved).includes(CM.STORAGE_KEY), false,
    'the token must not be saved under the synced config storage key');
  assert.equal(Object.values(saved)[0], 'ghp_newtoken');
});

test('saveGithubToken: rejects when chrome.runtime.lastError is set after set', async () => {
  const { CM } = makeContextWithLocalStorage(null, { message: 'quota exceeded' });
  await assert.rejects(() => CM.saveGithubToken('ghp_x'));
});

test('clearGithubToken: removes the stored token key', async () => {
  const { CM, getRemovedKey } = makeContextWithLocalStorage('ghp_test123');
  await CM.clearGithubToken();
  assert.ok(getRemovedKey(), 'storage.local.remove should have been called with a key');
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
  assert.equal(reassembleSaved(getSaved(), CM.STORAGE_KEY).version, CM.DEFAULT_CONFIG.version,
    'saved config version should match DEFAULT_CONFIG version');
});

test('resetToDefaults: saved config has the same version as the returned config', async () => {
  const { CM, getSaved } = makeContextWithCapturingSave();
  const config = await CM.resetToDefaults();
  assert.equal(
    reassembleSaved(getSaved(), CM.STORAGE_KEY).version,
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
  // Since v15 the default carries the seeded OpenShift CI source so section
  // relevance is checked dynamically out of the box.
  assert.equal(config.pluginConfigSources.length, 1);
  assert.equal(config.pluginConfigSources[0].configRepo, 'openshift/release');
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

test('DEFAULT_CONFIG: profile-prow-openshift-release has no per-check dynamicCommands', () => {
  const CM = makeContextWithStorage(null);
  const profile = CM.DEFAULT_CONFIG.profiles.find(p => p.id === 'profile-prow-openshift-release');
  assert.ok(profile, 'openshift/release profile should exist');
  // Rehearsal rerun commands are read verbatim from Prow's own failure-notifier
  // comment (content.js's scrapeFailedCheckRerunCommands()) rather than guessed
  // from the check name's shape, so no dynamicCommand is needed here.
  // (length check, not deepEqual([]) — CM.DEFAULT_CONFIG is built in a
  // separate vm context, so its empty array isn't reference-equal to one
  // constructed in this file, even with identical contents.)
  assert.equal(profile.dynamicCommands.length, 0);
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
  // 'choose' = the picker's Chain picks toggle decides per-post between one
  // command per branch (parallel) and a single space-joined command (Prow's
  // sequential cherry-pick chain).
  assert.equal(cherryPick.joinMode, 'choose');
});

test('DEFAULT_CONFIG: Velero backport profile targets velero-io/velero with the branch picker', () => {
  const CM = makeContextWithStorage(null);
  const profile = CM.DEFAULT_CONFIG.profiles.find(p => p.id === 'profile-velero-backport');
  assert.ok(profile, 'profile-velero-backport should exist');
  assert.equal(profile.repoPatterns.length, 1);
  assert.equal(profile.repoPatterns[0], 'velero-io/velero');
  assert.equal(CM.isProwProfile('profile-velero-backport'), false, 'backport-action is a GitHub Action, not a Prow plugin');
  const backport = profile.globalCommands.find(c => c.label === 'Backport...');
  assert.ok(backport, 'Backport... command should exist');
  assert.equal(backport.command, '/backport');
  assert.equal(backport.hasJobPicker, true);
  assert.equal(backport.jobSource, 'branches');
  assert.equal(backport.joinMode, 'single-command');
  assert.equal(backport.commandTemplate, '/backport {input}');
});

test('DEFAULT_CONFIG: verified and jira commands exist in universal profile', () => {
  const CM = makeContextWithStorage(null);
  const profile = CM.DEFAULT_CONFIG.profiles.find(p => p.id === 'profile-tide-prow-universal');
  const commands = profile.globalCommands.map(c => c.command);
  for (const expected of ['/verified by', '/verified later', '/verified bypass', '/verified remove',
                          '/jira refresh', '/jira backport', '/jira cherrypick']) {
    assert.ok(commands.includes(expected), `${expected} should exist in universal profile`);
  }
});

test('DEFAULT_CONFIG: /jira backport joins with commas, /cherry-pick defers to the picker toggle', () => {
  const CM = makeContextWithStorage(null);
  const profile = CM.DEFAULT_CONFIG.profiles.find(p => p.id === 'profile-tide-prow-universal');
  const backport = profile.globalCommands.find(c => c.command === '/jira backport');
  assert.equal(backport.joinMode, 'single-command-comma');
  assert.equal(backport.jobSource, 'branches');
  const cherryPick = profile.globalCommands.find(c => c.command === '/cherry-pick');
  assert.equal(cherryPick.joinMode, 'choose');
  assert.equal(cherryPick.jobSource, 'branches');
  // The old separate "Cherry-pick Chain..." entry is gone — its behavior is
  // the Chain picks toggle on the single Cherry-pick... command now.
  assert.ok(!profile.globalCommands.some(c => c.label === 'Cherry-pick Chain...'),
    'Cherry-pick Chain... should be merged into Cherry-pick...');
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

// ---------------------------------------------------------------------------
// filterProfilesByRequiredPlugins (dynamic section relevance)
// ---------------------------------------------------------------------------
test('filterProfilesByRequiredPlugins: drops profiles whose required plugin is not enabled', () => {
  const CM = makeContext();
  const profiles = [
    { id: 'a', requiredPlugins: ['pj-rehearse-plugin'] },
    { id: 'b' }
  ];
  const out = CM.filterProfilesByRequiredPlugins(profiles, ['approve', 'lgtm']);
  assert.deepEqual(out.map(p => p.id), ['b'],
    'profile requiring pj-rehearse-plugin must hide when it is not enabled');
});

test('filterProfilesByRequiredPlugins: keeps profiles whose required plugins are all enabled', () => {
  const CM = makeContext();
  const profiles = [
    { id: 'a', requiredPlugins: ['pj-rehearse-plugin'] },
    { id: 'b' }
  ];
  const out = CM.filterProfilesByRequiredPlugins(profiles, ['approve', 'pj-rehearse-plugin']);
  assert.deepEqual(out.map(p => p.id), ['a', 'b']);
});

test('filterProfilesByRequiredPlugins: requires every listed plugin', () => {
  const CM = makeContext();
  const out = CM.filterProfilesByRequiredPlugins(
    [{ id: 'a', requiredPlugins: ['x', 'y'] }], ['x']);
  assert.deepEqual(out, [], 'a missing second required plugin must hide the profile');
});

test('filterProfilesByRequiredPlugins: no plugin data means no filtering (static patterns stand)', () => {
  const CM = makeContext();
  const profiles = [{ id: 'a', requiredPlugins: ['pj-rehearse-plugin'] }];
  assert.equal(CM.filterProfilesByRequiredPlugins(profiles, null), profiles,
    'null plugin data must return the profiles unchanged');
  assert.equal(CM.filterProfilesByRequiredPlugins(profiles, undefined), profiles,
    'undefined plugin data must return the profiles unchanged');
});

test('filterProfilesByRequiredPlugins: an empty plugin array is known-empty, not unknown', () => {
  // handleGetEnabledPlugins distinguishes a failed/unavailable lookup
  // (null) from a successful read that enabled nothing ([]). The latter is
  // real data: profiles with requiredPlugins must hide.
  const CM = makeContext();
  const profiles = [
    { id: 'a', requiredPlugins: ['pj-rehearse-plugin'] },
    { id: 'b' }
  ];
  const out = CM.filterProfilesByRequiredPlugins(profiles, []);
  assert.deepEqual(out.map(p => p.id), ['b'],
    'a successful lookup with zero plugins must hide requiredPlugins profiles');
});

// ---------------------------------------------------------------------------
// Collapsed group persistence (own sync keys, outside the Export/Import schema)
// ---------------------------------------------------------------------------
function makeContextWithStatefulStorage(initial = {}) {
  const store = { ...initial };
  const ctx = vm.createContext({
    window: { GHBCP: { CommandToPlugin: {} } },
    crypto: { randomUUID: () => 'test-uuid-1234' },
    document: { createElement: () => makeEscapingDiv() },
    chrome: {
      runtime: { id: 'fake-id', lastError: null },
      storage: {
        sync: {
          get: (key, cb) => {
            // chrome.storage.sync.get(null, ...) returns everything, and
            // readStoredConfig() reassembles sharded configs by passing an
            // ARRAY of chunk keys — support both, or every sharded read
            // silently falls back to defaults and the round-trip tests
            // below compare fallbacks instead of persisted data.
            if (key === null) return cb({ ...store });
            if (Array.isArray(key)) {
              const out = {};
              for (const k of key) if (k in store) out[k] = store[k];
              return cb(out);
            }
            cb(key in store ? { [key]: store[key] } : {});
          },
          set: (obj, cb) => { Object.assign(store, obj); cb && cb(); },
          remove: (keys, cb) => {
            for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
            cb && cb();
          }
        }
      }
    }
  });
  vm.runInContext(configManagerSrc, ctx);
  return { CM: ctx.window.GHBCP.ConfigManager, store };
}

test('getCollapsedGroups: returns [] when nothing is stored', async () => {
  const { CM } = makeContextWithStatefulStorage();
  assert.deepEqual([...await CM.getCollapsedGroups()], []);
});

test('collapsed groups persist per key, never overwriting other groups', async () => {
  const { CM, store } = makeContextWithStatefulStorage();
  await CM.setGroupCollapsed('profile-payload-openshift', true);
  await CM.setGroupCollapsed('repo-overrides', true);
  assert.ok('ghbcp_collapsed_group:profile-payload-openshift' in store,
    'each collapsed group lives under its own key');
  assert.ok(!('ghbcp_config' in store),
    'collapse state must not be written into the config blob');

  // The cross-tab lost-update scenario: another tab collapses a different
  // group — with whole-set writes this would have dropped the first key.
  await CM.setGroupCollapsed('profile-openshift-labels', true);
  assert.deepEqual([...await CM.getCollapsedGroups()].sort(),
    ['profile-openshift-labels', 'profile-payload-openshift', 'repo-overrides']);

  await CM.setGroupCollapsed('profile-payload-openshift', false);
  assert.deepEqual([...await CM.getCollapsedGroups()].sort(),
    ['profile-openshift-labels', 'repo-overrides'],
    'expanding clears only that group\'s key');
});

test('collapsed group helpers never throw on storage failures', async () => {
  const CM = makeContextWithStorage(null, { message: 'quota exceeded' });
  assert.deepEqual([...await CM.getCollapsedGroups()], []);
  await CM.setGroupCollapsed('x', true); // must resolve, not reject
  await CM.setGroupCollapsed('x', false); // remove path too
});

test('getConfig persists defaults on a genuinely empty store (fresh install)', async () => {
  // The background worker reads stored config only; until something saves,
  // it would never see the seeded plugin-config source. A first empty read
  // must therefore seed storage.
  const { CM, store } = makeContextWithStatefulStorage();
  const config = await CM.getConfig();
  assert.equal(config.version, CM.DEFAULT_CONFIG.version);
  // The seed write is fire-and-forget; let it land before asserting. The
  // default config is large, so it persists as sharded chunks
  // (ghbcp_config holds the { _chunks } marker) — prove persistence by
  // reading back through the normal path.
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok('ghbcp_config' in store,
    'first empty read should persist the defaults');
  const reread = await CM.getConfig();
  assert.deepEqual(reread, config,
    'a second read must return the persisted defaults');
  // Prove the second read actually parsed the persisted shards rather
  // than falling back to defaults again: corrupting one chunk must make
  // the read fail over to a fresh defaults copy.
  const chunkKeys = Object.keys(store).filter(k => k.startsWith('ghbcp_config_part_'));
  assert.ok(chunkKeys.length > 0, 'defaults should have been persisted as shards');
  store[chunkKeys[0]] = 'INVALID{JSON';
  const fallback = await CM.getConfig();
  assert.deepEqual(fallback, config,
    'a corrupted shard must fall back to defaults, not throw');
});

// ---------------------------------------------------------------------------
// v14 → v15 migration: dynamic plugin checks
// ---------------------------------------------------------------------------
function makeV14Config(CM, overrides = {}) {
  return {
    version: 14,
    profiles: [],
    repoOverrides: [],
    globalSettings: JSON.parse(JSON.stringify(CM.DEFAULT_CONFIG.globalSettings)),
    pluginConfigSources: [],
    ...overrides
  };
}

test('migrateConfig: v14 seeds the OpenShift CI plugin source when none is configured', async () => {
  const CM = makeContext();
  const CM2 = makeContextWithStorage(makeV14Config(CM));
  const config = await CM2.getConfig();
  assert.ok(Array.isArray(config.pluginConfigSources) && config.pluginConfigSources.length === 1,
    'the OpenShift CI preset should be seeded');
  const src = config.pluginConfigSources[0];
  assert.equal(src.configRepo, 'openshift/release');
  assert.equal(src.enabled, true);
  assert.equal(src.format, 'sharded');
});

test('migrateConfig: v14 leaves already-configured plugin sources untouched', async () => {
  const CM = makeContext();
  const own = [{ id: 'src-mine', name: 'Mine', enabled: true, format: 'monolithic',
    configRepo: 'org/repo', branch: 'main', pathTemplate: '', filePath: 'prow/plugins.yaml',
    presubmitsBasePath: '', cacheTTLMinutes: 60 }];
  const CM2 = makeContextWithStorage(makeV14Config(CM, { pluginConfigSources: own }));
  const config = await CM2.getConfig();
  assert.equal(config.pluginConfigSources.length, 1);
  assert.equal(config.pluginConfigSources[0].id, 'src-mine',
    'a user-configured source must not be replaced by the seeded preset');
});

test('migrateConfig: v14 rehearse profile gains the pj-rehearse-plugin gate', async () => {
  const CM = makeContext();
  const CM2 = makeContextWithStorage(makeV14Config(CM));
  const config = await CM2.getConfig();
  const p = config.profiles.find(x => x.id === 'profile-prow-openshift-release');
  assert.ok(p, 'rehearse profile should exist after migration');
  assert.deepEqual([...p.requiredPlugins], ['pj-rehearse-plugin'],
    'the dynamic gate should be attached to the rehearse profile');
  assert.deepEqual([...p.repoPatterns], ['openshift/release'],
    'the static repo floor should stay in place');
});

test('migrateConfig: v14 keeps user edits to built-in profiles (surgical v15)', async () => {
  // The settings editor edits built-ins in place; the v15 migration must
  // not revert those edits to defaults — only the requiredPlugins delta is
  // merged in. This is the v14 analogue of the v13 surgical path.
  const CM = makeContext();
  const customized = makeV14Config(CM);
  customized.profiles = [{
    id: 'profile-prow-openshift-release',
    name: 'My Rehearse Buttons',
    enabled: true,
    repoPatterns: ['openshift/release', 'openshift-priv/release'],
    globalCommands: [{ id: 'cmd-mine', label: 'Rehearse Mine', command: '/pj-rehearse mine' }],
    checkCommands: [],
    dynamicCommands: []
  }];
  const CM2 = makeContextWithStorage(customized);
  const config = await CM2.getConfig();
  const p = config.profiles.find(x => x.id === 'profile-prow-openshift-release');
  assert.ok(p, 'profile should survive the migration');
  assert.equal(p.name, 'My Rehearse Buttons', 'custom name must survive');
  assert.deepEqual([...p.repoPatterns], ['openshift/release', 'openshift-priv/release'],
    'custom repo patterns must survive');
  assert.deepEqual(p.globalCommands.map(c => c.command), ['/pj-rehearse mine'],
    'custom commands must survive');
  assert.deepEqual([...p.requiredPlugins], ['pj-rehearse-plugin'],
    'the v15 delta (requiredPlugins) should still be merged in');
});

test('migrateConfig: v13 hopping straight to v15 still gains the requiredPlugins gate', async () => {
  // v13 configs migrate to v15 in one call through the v13 surgical path;
  // the v15 delta must merge there too, or the profile-level gate is
  // silently absent for users who skipped v14 entirely.
  const CM = makeContext();
  const v13 = {
    version: 13,
    profiles: [{
      id: 'profile-prow-openshift-release',
      name: 'My Rehearse Buttons',
      enabled: true,
      repoPatterns: ['openshift/release'],
      globalCommands: [{ id: 'cmd-mine', label: 'Rehearse Mine', command: '/pj-rehearse mine' }],
      checkCommands: [],
      dynamicCommands: []
    }],
    repoOverrides: [],
    globalSettings: JSON.parse(JSON.stringify(CM.DEFAULT_CONFIG.globalSettings)),
    pluginConfigSources: []
  };
  const CM2 = makeContextWithStorage(v13);
  const config = await CM2.getConfig();
  assert.equal(config.version, CM.DEFAULT_CONFIG.version);
  const p = config.profiles.find(x => x.id === 'profile-prow-openshift-release');
  assert.ok(p, 'rehearse profile should exist after migration');
  assert.equal(p.name, 'My Rehearse Buttons', 'v13 surgical path must still preserve edits');
  assert.deepEqual(p.globalCommands.map(c => c.command), ['/pj-rehearse mine'],
    'v13 surgical path must still preserve commands');
  assert.deepEqual([...p.requiredPlugins], ['pj-rehearse-plugin'],
    'the v15 gate must merge on the v13 one-hop path too');
});

test('migrateConfig: v14 keeps a user-set requiredPlugins untouched', async () => {
  const CM = makeContext();
  const customized = makeV14Config(CM);
  customized.profiles = [{
    id: 'profile-prow-openshift-release',
    name: 'x', enabled: true, repoPatterns: ['openshift/release'],
    requiredPlugins: ['something-else'],
    globalCommands: [], checkCommands: [], dynamicCommands: []
  }];
  const CM2 = makeContextWithStorage(customized);
  const config = await CM2.getConfig();
  const p = config.profiles.find(x => x.id === 'profile-prow-openshift-release');
  assert.deepEqual([...p.requiredPlugins], ['something-else'],
    'an existing requiredPlugins value must not be overwritten');
});

test('pj-rehearse commands map to the pj-rehearse-plugin for command-level filtering', () => {
  // The reverse map is built at load time in prow-plugin-map.js; content.js's
  // filterCommandsByPlugins reads it via window.GHBCP.CommandToPlugin. Feed a
  // map shaped like the real one to confirm the lookup semantics the map
  // entry enables.
  const CM = makeContext({ '/pj-rehearse': 'pj-rehearse-plugin' });
  const profiles = [{
    id: 'p',
    globalCommands: [
      { command: '/pj-rehearse' },
      { command: '/pj-rehearse ack' }
    ],
    checkCommands: []
  }];
  const filtered = CM.filterCommandsByPlugins(profiles, ['approve'], 'filter');
  assert.deepEqual([...filtered[0].globalCommands], [],
    '/pj-rehearse commands must be filtered out when the plugin is absent');
  const kept = CM.filterCommandsByPlugins(profiles, ['pj-rehearse-plugin'], 'filter');
  assert.equal(kept[0].globalCommands.length, 2,
    '/pj-rehearse commands must stay when the plugin is enabled');
});
