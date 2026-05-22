const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Load prow-plugin-map.js into a vm context (it uses window for export)
const src = fs.readFileSync(path.resolve(__dirname, '..', 'prow-plugin-map.js'), 'utf8');

function loadMap() {
  const ctx = vm.createContext({ window: {} });
  vm.runInContext(src, ctx);
  return {
    pluginMap: ctx.window.GHBCP.ProwPluginMap,
    commandToPlugin: ctx.window.GHBCP.CommandToPlugin
  };
}

// ---------------------------------------------------------------------------
// ProwPluginMap — structural sanity
// ---------------------------------------------------------------------------
test('ProwPluginMap: every entry has commands (array) and description (string)', () => {
  const { pluginMap } = loadMap();
  for (const [name, info] of Object.entries(pluginMap)) {
    assert.ok(Array.isArray(info.commands), `${name}.commands should be an array`);
    assert.ok(info.commands.length > 0, `${name}.commands should not be empty`);
    assert.equal(typeof info.description, 'string', `${name}.description should be a string`);
  }
});

test('ProwPluginMap: no command appears in more than one plugin', () => {
  const { pluginMap } = loadMap();
  const seen = new Map();
  for (const [plugin, info] of Object.entries(pluginMap)) {
    for (const cmd of info.commands) {
      if (seen.has(cmd)) {
        assert.fail(
          `Command "${cmd}" appears in both "${seen.get(cmd)}" and "${plugin}" — ` +
          'duplicate commands cause the reverse map to silently drop the first plugin'
        );
      }
      seen.set(cmd, plugin);
    }
  }
});

// ---------------------------------------------------------------------------
// CommandToPlugin reverse map
// ---------------------------------------------------------------------------
test('CommandToPlugin: /hold maps to "hold", not "wip"', () => {
  const { commandToPlugin } = loadMap();
  assert.equal(commandToPlugin['/hold'], 'hold',
    '/hold should map to the "hold" plugin; if it maps to "wip" the filter incorrectly ' +
    'disables the Hold button when "hold" is enabled but "wip" is not'
  );
});

test('CommandToPlugin: /hold cancel maps to "hold"', () => {
  const { commandToPlugin } = loadMap();
  assert.equal(commandToPlugin['/hold cancel'], 'hold');
});

test('CommandToPlugin: /wip maps to "wip"', () => {
  const { commandToPlugin } = loadMap();
  assert.equal(commandToPlugin['/wip'], 'wip');
});

test('CommandToPlugin: standard commands map to expected plugins', () => {
  const { commandToPlugin } = loadMap();
  const expected = {
    '/lgtm': 'lgtm',
    '/lgtm cancel': 'lgtm',
    '/approve': 'approve',
    '/approve cancel': 'approve',
    '/retest': 'trigger',
    '/ok-to-test': 'trigger',
    '/override': 'override',
    '/cc': 'assign',
    '/uncc': 'assign',
    '/label': 'label',
    '/cherry-pick': 'cherrypick'
  };
  for (const [cmd, plugin] of Object.entries(expected)) {
    assert.equal(commandToPlugin[cmd], plugin, `"${cmd}" should map to "${plugin}"`);
  }
});

test('CommandToPlugin: every command in ProwPluginMap appears in the reverse map', () => {
  const { pluginMap, commandToPlugin } = loadMap();
  for (const [plugin, info] of Object.entries(pluginMap)) {
    for (const cmd of info.commands) {
      assert.ok(cmd in commandToPlugin,
        `Command "${cmd}" from plugin "${plugin}" is missing from CommandToPlugin`);
    }
  }
});
