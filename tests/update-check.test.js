'use strict';
// Unit tests for the side-load update check in background.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');

const backgroundSrc = fs.readFileSync(path.resolve(__dirname, '..', 'background.js'), 'utf8')
  .replace(/importScripts\([^)]*\);?/g, '');

/**
 * Load background.js in a fresh context with stubbed chrome/fetch.
 * `fetchImpl` receives (url, opts) and returns a Response-like object.
 */
function load({ manifest = { version: '1.0.0' }, fetchImpl, local = {} } = {}) {
  const calls = { fetch: [], badge: [] };
  const chrome = {
    runtime: {
      onMessage: { addListener() {} },
      onStartup: { addListener() {} },
      onInstalled: { addListener() {} },
      getManifest: () => manifest,
      lastError: null
    },
    storage: {
      local: {
        get(key, cb) { cb({ [key]: local[key] }); },
        set(items, cb) { Object.assign(local, items); cb(); }
      }
    },
    action: { setBadgeText(arg) { calls.badge.push(arg.text); } }
  };
  const ctx = {
    chrome, console, Date,
    fetch: async (url, opts) => { calls.fetch.push(url); return fetchImpl(url, opts); }
  };
  vm.runInNewContext(backgroundSrc, ctx);
  return { ctx, calls };
}

const ok = (body) => async () => ({ ok: true, json: async () => body });

test('compareVersions: numeric, not lexicographic', () => {
  const { ctx } = load();
  assert.ok(ctx.compareVersions('1.0.10', '1.0.9') > 0);
  assert.ok(ctx.compareVersions('1.1.0', '1.0.9') > 0);
  assert.ok(ctx.compareVersions('1.0.0', '1.0.1') < 0);
  assert.equal(ctx.compareVersions('1.0', '1.0.0'), 0);
  assert.ok(ctx.compareVersions('2', '1.9.9') > 0);
});

test('checkForUpdate: newer version on main reports update and sets badge', async () => {
  const { ctx, calls } = load({ fetchImpl: ok({ version: '1.2.0' }) });
  const r = await ctx.handleCheckForUpdate(false);
  assert.equal(r.updateAvailable, true);
  assert.equal(r.current, '1.0.0');
  assert.equal(r.latest, '1.2.0');
  assert.deepEqual(JSON.stringify(calls.badge), '["↑"]');
  assert.match(calls.fetch[0], /raw\.githubusercontent\.com\/kaovilai\/github-bot-command-palette\/main\/manifest\.json$/);
});

test('checkForUpdate: same version clears the badge', async () => {
  const { ctx, calls } = load({ fetchImpl: ok({ version: '1.0.0' }) });
  const r = await ctx.handleCheckForUpdate(false);
  assert.equal(r.updateAvailable, false);
  assert.deepEqual(JSON.stringify(calls.badge), '[""]');
});

test('checkForUpdate: Web Store install (update_url) skips the network', async () => {
  const { ctx, calls } = load({
    manifest: { version: '1.0.0', update_url: 'https://clients2.google.com/service/update2/crx' },
    fetchImpl: ok({ version: '9.9.9' })
  });
  const r = await ctx.handleCheckForUpdate(true);
  assert.equal(r.managed, true);
  assert.equal(r.updateAvailable, false);
  assert.equal(calls.fetch.length, 0);
});

test('checkForUpdate: fresh cache is reused, force bypasses it', async () => {
  const { ctx, calls } = load({ fetchImpl: ok({ version: '1.2.0' }) });
  await ctx.handleCheckForUpdate(false);
  await ctx.handleCheckForUpdate(false);
  assert.equal(calls.fetch.length, 1);
  await ctx.handleCheckForUpdate(true);
  assert.equal(calls.fetch.length, 2);
});

test('checkForUpdate: cache from an older installed version is ignored', async () => {
  const stale = { current: '0.9.0', latest: '1.0.0', updateAvailable: true, checkedAt: Date.now() };
  const { ctx, calls } = load({ fetchImpl: ok({ version: '1.0.0' }), local: { ghbcp_update_cache: stale } });
  const r = await ctx.handleCheckForUpdate(false);
  assert.equal(calls.fetch.length, 1);
  assert.equal(r.updateAvailable, false);
});

test('checkForUpdate: HTTP error, bad manifest and network failure never throw', async () => {
  let r = await load({ fetchImpl: async () => ({ ok: false, status: 404 }) }).ctx.handleCheckForUpdate(true);
  assert.equal(r.error, 'HTTP 404');
  assert.equal(r.updateAvailable, false);

  r = await load({ fetchImpl: ok({ name: 'x' }) }).ctx.handleCheckForUpdate(true);
  assert.equal(r.error, 'invalid-manifest');

  r = await load({ fetchImpl: async () => { throw new Error('offline'); } }).ctx.handleCheckForUpdate(true);
  assert.equal(r.error, 'network-error');
});
