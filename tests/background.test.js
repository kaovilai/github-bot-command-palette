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

const { extractPlugins, extractOrgPlugins, buildConfigFileUrl } = ctx;

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

test('extractPlugins: deduplicates when plugins section and top-level sections both match', () => {
  // The `approve` plugin could appear in both parsed.plugins[repo] (Method 1) and
  // parsed.approve[].repos (Method 2).  The Set-based accumulator must deduplicate
  // so that the returned array contains `approve` exactly once.
  const yaml =
    'plugins:\n' +
    '  org/repo:\n' +
    '    - approve\n' +
    'approve:\n' +
    '  - repos:\n' +
    '      - org/repo\n';
  const result = extractPlugins(yaml, 'org/repo', 'org');
  const approveCount = result.filter(p => p === 'approve').length;
  assert.equal(approveCount, 1, 'approve should appear exactly once despite matching both sections');
});

test('extractPlugins: YAML that parses to a non-object (e.g. a plain string) returns []', () => {
  // jsyaml.load("just a string") returns a string, not an object.
  // extractPlugins must guard against non-object parsed values.
  const result = extractPlugins('just a plain string', 'org/repo', 'org');
  assert.equal(result.length, 0);
});

test('buildConfigFileUrl: multiple trailing slashes in pathTemplate are stripped', () => {
  const source = { format: 'sharded', configRepo: 'org/config', branch: 'main', pathTemplate: 'config//' };
  const url = buildConfigFileUrl(source, 'myorg', 'myrepo');
  assert.ok(!url.includes('//config'), `URL should not contain double slash before org: ${url}`);
  assert.equal(url, 'https://github.com/org/config/blob/main/config/myorg/myrepo/_pluginconfig.yaml');
});

// ── extractOrgPlugins ────────────────────────────────────────────────────────

test('extractOrgPlugins: empty YAML returns []', () => {
  assert.equal(extractOrgPlugins('', 'org/repo', 'org').length, 0);
});

test('extractOrgPlugins: extracts org-level default plugins', () => {
  const yaml =
    'plugins:\n' +
    '  org:\n' +
    '    plugins:\n' +
    '      - trigger\n' +
    '      - hold\n' +
    '      - approve\n';
  const result = extractOrgPlugins(yaml, 'org/repo', 'org');
  assert.ok(result.includes('trigger'));
  assert.ok(result.includes('hold'));
  assert.ok(result.includes('approve'));
});

test('extractOrgPlugins: returns [] when repo is in excluded_repos', () => {
  const yaml =
    'plugins:\n' +
    '  org:\n' +
    '    excluded_repos:\n' +
    '      - repo\n' +
    '    plugins:\n' +
    '      - trigger\n' +
    '      - hold\n';
  const result = extractOrgPlugins(yaml, 'org/repo', 'org');
  assert.equal(result.length, 0);
});

test('extractOrgPlugins: non-excluded repo gets org defaults', () => {
  const yaml =
    'plugins:\n' +
    '  org:\n' +
    '    excluded_repos:\n' +
    '      - other-repo\n' +
    '    plugins:\n' +
    '      - trigger\n' +
    '      - lgtm\n';
  const result = extractOrgPlugins(yaml, 'org/repo', 'org');
  assert.ok(result.includes('trigger'));
  assert.ok(result.includes('lgtm'));
});

test('extractOrgPlugins: also picks up top-level plugin sections', () => {
  const yaml =
    'approve:\n' +
    '  - repos:\n' +
    '      - org/repo\n' +
    '    require_self_approval: false\n';
  const result = extractOrgPlugins(yaml, 'org/repo', 'org');
  assert.ok(result.includes('approve'));
});

test('extractOrgPlugins: merges plugins section and top-level sections', () => {
  const yaml =
    'plugins:\n' +
    '  org:\n' +
    '    plugins:\n' +
    '      - trigger\n' +
    'lgtm:\n' +
    '  - repos:\n' +
    '      - org\n';
  const result = extractOrgPlugins(yaml, 'org/repo', 'org');
  assert.ok(result.includes('trigger'));
  assert.ok(result.includes('lgtm'));
});

test('extractOrgPlugins: org key with plain list format (no nested plugins)', () => {
  const yaml =
    'plugins:\n' +
    '  org:\n' +
    '    - approve\n' +
    '    - hold\n';
  const result = extractOrgPlugins(yaml, 'org/repo', 'org');
  assert.ok(result.includes('approve'));
  assert.ok(result.includes('hold'));
});

// ── resolvePresubmitSource ────────────────────────────────────────────────────

test('resolvePresubmitSource: falls back to openshift/release when config is null', () => {
  const src = ctx.resolvePresubmitSource(null);
  assert.equal(src.configRepo, 'openshift/release');
  assert.equal(src.presubmitsBasePath, 'ci-operator/jobs');
});

test('resolvePresubmitSource: falls back when no configured source has presubmitsBasePath', () => {
  const src = ctx.resolvePresubmitSource({
    pluginConfigSources: [{ enabled: true, configRepo: 'openshift/release', branch: 'master' }]
  });
  assert.equal(src.configRepo, 'openshift/release');
  assert.equal(src.presubmitsBasePath, 'ci-operator/jobs');
});

test('resolvePresubmitSource: ignores disabled sources', () => {
  const src = ctx.resolvePresubmitSource({
    pluginConfigSources: [
      { enabled: false, configRepo: 'my/prow', presubmitsBasePath: 'jobs' }
    ]
  });
  assert.equal(src.configRepo, 'openshift/release');
});

test('resolvePresubmitSource: prefers an enabled configured source', () => {
  const src = ctx.resolvePresubmitSource({
    pluginConfigSources: [
      { enabled: false, configRepo: 'a/b', presubmitsBasePath: 'x' },
      { enabled: true, configRepo: 'my/prow', branch: 'main', presubmitsBasePath: 'jobs' }
    ]
  });
  assert.equal(src.configRepo, 'my/prow');
  assert.equal(src.presubmitsBasePath, 'jobs');
});

// ── fetchPullRequestRefs / resolveBaseBranch / resolvePRHeadSha ───────────────
// Generic mutable chrome.storage mock (any key, either area) — separate from
// mockChromeStorage() below, which is hardcoded to a single storage.local key
// for the GitHub-token tests.
function makeStorageArea(initial) {
  const store = Object.assign({}, initial);
  return {
    get(key, cb) { cb({ [key]: store[key] }); },
    set(obj, cb) { Object.assign(store, obj); if (cb) cb(); }
  };
}
function mockChromeStorageFull({ syncData, localData } = {}) {
  return {
    storage: {
      sync: makeStorageArea(syncData || {}),
      local: makeStorageArea(localData || {})
    },
    runtime: {}
  };
}

test('resolveBaseBranch: returns hintBranch immediately, without fetching', async () => {
  ctx.fetch = () => { throw new Error('should not fetch when a hint branch is given'); };
  const result = await ctx.resolveBaseBranch('org/repo', '123', 'oadp-1.6');
  assert.equal(result, 'oadp-1.6');
});

test('resolveBaseBranch: returns null when no hint and no prNumber', async () => {
  ctx.fetch = () => { throw new Error('should not fetch without a PR number'); };
  const result = await ctx.resolveBaseBranch('org/repo', null, null);
  assert.equal(result, null);
});

test('resolveBaseBranch: fetches the PR and reads base.ref when no hint is given', async () => {
  ctx.fetch = async (url) => {
    assert.equal(url, 'https://api.github.com/repos/org/repo/pulls/123');
    return { ok: true, json: async () => ({ base: { ref: 'oadp-1.6' }, head: { sha: 'abc123' } }) };
  };
  const result = await ctx.resolveBaseBranch('org/repo', '123', null);
  assert.equal(result, 'oadp-1.6');
});

test('resolveBaseBranch: non-ok PR API response returns null', async () => {
  ctx.fetch = async () => ({ ok: false, status: 404 });
  const result = await ctx.resolveBaseBranch('org/repo', '123', null);
  assert.equal(result, null);
});

test('resolvePRHeadSha: fetches the PR and reads head.sha', async () => {
  ctx.fetch = async (url) => {
    assert.equal(url, 'https://api.github.com/repos/org/repo/pulls/123');
    return { ok: true, json: async () => ({ base: { ref: 'oadp-1.6' }, head: { sha: 'abc123' } }) };
  };
  const result = await ctx.resolvePRHeadSha('org/repo', '123');
  assert.equal(result, 'abc123');
});

test('resolvePRHeadSha: returns null without a PR number', async () => {
  ctx.fetch = () => { throw new Error('should not fetch without a PR number'); };
  const result = await ctx.resolvePRHeadSha('org/repo', null);
  assert.equal(result, null);
});

test('resolvePRHeadSha: non-ok PR API response returns null', async () => {
  ctx.fetch = async () => ({ ok: false, status: 404 });
  const result = await ctx.resolvePRHeadSha('org/repo', '123');
  assert.equal(result, null);
});

test('handleGetPRHeadSha: happy path returns the head SHA', async () => {
  ctx.fetch = async () => ({ ok: true, json: async () => ({ base: { ref: 'main' }, head: { sha: 'deadbeef' } }) });
  const result = await ctx.handleGetPRHeadSha('org/repo', '123');
  assert.equal(result.headSha, 'deadbeef');
});

test('handleGetPRHeadSha: no PR number returns null headSha', async () => {
  ctx.fetch = () => { throw new Error('should not fetch without a PR number'); };
  const result = await ctx.handleGetPRHeadSha('org/repo', null);
  assert.equal(result.headSha, null);
});

// ── handleGetPresubmitJobs: configRef override ────────────────────────────────

test('handleGetPresubmitJobs: with no configRef, fetches from source.branch (master)', async () => {
  ctx.chrome = mockChromeStorageFull();
  ctx.fetch = async (url) => {
    assert.equal(url, 'https://raw.githubusercontent.com/openshift/release/master/ci-operator/jobs/migtools/kubevirt-datamover-controller/migtools-kubevirt-datamover-controller-oadp-1.6-presubmits.yaml');
    return { ok: true, text: async () => 'presubmits:\n  migtools/kubevirt-datamover-controller:\n    - name: pull-ci-migtools-kubevirt-datamover-controller-oadp-1.6-e2e-test-aws\n      context: ci/prow/e2e-test-aws\n      rerun_command: /test e2e-test-aws\n' };
  };
  const result = await ctx.handleGetPresubmitJobs('migtools/kubevirt-datamover-controller', 'oadp-1.6', false, null, undefined);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].jobName, 'pull-ci-migtools-kubevirt-datamover-controller-oadp-1.6-e2e-test-aws');
});

test('handleGetPresubmitJobs: with a configRef, fetches from that ref instead of master', async () => {
  ctx.chrome = mockChromeStorageFull();
  ctx.fetch = async (url) => {
    assert.equal(url, 'https://raw.githubusercontent.com/openshift/release/abc123/ci-operator/jobs/migtools/kubevirt-datamover-controller/migtools-kubevirt-datamover-controller-oadp-1.6-presubmits.yaml');
    return { ok: true, text: async () => 'presubmits:\n  migtools/kubevirt-datamover-controller:\n    - name: pull-ci-migtools-kubevirt-datamover-controller-oadp-1.6-e2e-test-aws\n      context: ci/prow/e2e-test-aws\n      rerun_command: /test e2e-test-aws\n' };
  };
  const result = await ctx.handleGetPresubmitJobs('migtools/kubevirt-datamover-controller', 'oadp-1.6', false, null, 'abc123');
  assert.equal(result.jobs.length, 1);
});

test('handleGetPresubmitJobs: configRef and non-configRef calls use separate cache entries (both fetch)', async () => {
  ctx.chrome = mockChromeStorageFull();
  let fetchCount = 0;
  ctx.fetch = async () => {
    fetchCount++;
    return { ok: true, text: async () => 'presubmits:\n  org/repo:\n    - name: pull-ci-org-repo-branch-unit\n      context: ci/prow/unit\n      rerun_command: /test unit\n' };
  };
  await ctx.handleGetPresubmitJobs('org/repo', 'branch', false, null, 'sha1');
  await ctx.handleGetPresubmitJobs('org/repo', 'branch', false, null, undefined);
  assert.equal(fetchCount, 2, 'a configRef-scoped call and an unscoped call must not share a cache entry');
});

test('handleGetPresubmitJobs: a second call with the same configRef hits the cache (one fetch)', async () => {
  ctx.chrome = mockChromeStorageFull();
  let fetchCount = 0;
  ctx.fetch = async () => {
    fetchCount++;
    return { ok: true, text: async () => 'presubmits:\n  org/repo:\n    - name: pull-ci-org-repo-branch-unit\n      context: ci/prow/unit\n      rerun_command: /test unit\n' };
  };
  await ctx.handleGetPresubmitJobs('org/repo', 'branch', false, null, 'sha1');
  await ctx.handleGetPresubmitJobs('org/repo', 'branch', false, null, 'sha1');
  assert.equal(fetchCount, 1);
});

// ── parseRehearsalJobList / isAllowedRehearsalListUrl ─────────────────────────

test('parseRehearsalJobList: parses pipe-table rows and skips the header', () => {
  const text =
    'Test Name | Repo | Type | Reason\n' +
    'pull-ci-openshift-velero-oadp-1.6-images | openshift/velero | presubmit | Ci-operator config changed\n' +
    'pull-ci-migtools-kubevirt-velero-plugin-main-images | migtools/kubevirt-velero-plugin | presubmit | Ci-operator config changed\n';
  const jobs = ctx.parseRehearsalJobList(text);
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].name, 'pull-ci-openshift-velero-oadp-1.6-images');
  assert.equal(jobs[0].repo, 'openshift/velero');
  assert.equal(jobs[0].type, 'presubmit');
  assert.equal(jobs[0].reason, 'Ci-operator config changed');
});

test('parseRehearsalJobList: skips blank and non-table lines', () => {
  const text =
    'Test Name | Repo | Type | Reason\n' +
    '\n' +
    'some stray line without pipes\n' +
    'pull-ci-org-repo-main-e2e | org/repo | presubmit | reason\n' +
    '   \n';
  const jobs = ctx.parseRehearsalJobList(text);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].name, 'pull-ci-org-repo-main-e2e');
});

test('parseRehearsalJobList: empty or null input returns []', () => {
  assert.equal(ctx.parseRehearsalJobList('').length, 0);
  assert.equal(ctx.parseRehearsalJobList(null).length, 0);
});

test('isAllowedRehearsalListUrl: accepts pj-rehearse GCS listing URLs only', () => {
  assert.equal(ctx.isAllowedRehearsalListUrl(
    'https://gcsweb-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/test-platform-results/pj-rehearse/openshift/release/82734/2caacb352141ae8c61046d584bf3c88fe08b2b51'), true);
  assert.equal(ctx.isAllowedRehearsalListUrl(
    'https://gcsweb-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/other-bucket/thing'), false);
  assert.equal(ctx.isAllowedRehearsalListUrl('https://evil.example.com/pj-rehearse/x'), false);
  assert.equal(ctx.isAllowedRehearsalListUrl(null), false);
});

// ── extractPlugins: external_plugins section ──────────────────────────────────

test('extractPlugins: external_plugins repo entry adds plugin names', () => {
  const yaml =
    'external_plugins:\n' +
    '  migtools/oadp-cli:\n' +
    '  - endpoint: http://cherrypick\n' +
    '    events:\n' +
    '    - issue_comment\n' +
    '    - pull_request\n' +
    '    name: cherrypick\n' +
    '  - endpoint: http://needs-rebase\n' +
    '    name: needs-rebase\n' +
    'plugins:\n' +
    '  migtools/oadp-cli:\n' +
    '    plugins:\n' +
    '      - trigger\n';
  const result = extractPlugins(yaml, 'migtools/oadp-cli', 'migtools');
  assert.ok(result.includes('cherrypick'), 'external cherrypick plugin should be detected');
  assert.ok(result.includes('needs-rebase'));
  assert.ok(result.includes('trigger'));
});

test('extractPlugins: external_plugins org-level fallback', () => {
  const yaml =
    'external_plugins:\n' +
    '  org:\n' +
    '  - name: cherrypick\n' +
    '    endpoint: http://cherrypick\n';
  const result = extractPlugins(yaml, 'org/repo', 'org');
  assert.ok(result.includes('cherrypick'));
});

test('extractPlugins: external_plugins entries without name are skipped', () => {
  const yaml =
    'external_plugins:\n' +
    '  org/repo:\n' +
    '  - endpoint: http://mystery\n';
  const result = extractPlugins(yaml, 'org/repo', 'org');
  assert.equal(result.length, 0);
});

test('sortBranchNames: release branches first, slash-y bot branches last', () => {
  const sorted = ctx.sortBranchNames([
    'dependabot/go_modules/x-1.2.3', 'oadp-1.4', 'main', 'copilot/fix-thing', 'oadp-1.3'
  ]);
  assert.deepEqual(sorted, [
    'main', 'oadp-1.3', 'oadp-1.4', 'copilot/fix-thing', 'dependabot/go_modules/x-1.2.3'
  ]);
});

// ── extractOrgPlugins: external_plugins at org level ──────────────────────────
// openshift/openshift-priv declare external plugins (cherrypick,
// jira-lifecycle-plugin, payload-testing-prow-plugin, publicize, ...) ONLY in
// the org-level _pluginconfig.yaml; repo-level files carry none.

test('extractOrgPlugins: org-level external_plugins names are detected', () => {
  const yaml =
    'external_plugins:\n' +
    '  openshift:\n' +
    '  - endpoint: http://cherrypick\n' +
    '    name: cherrypick\n' +
    '  - endpoint: http://jira-lifecycle-plugin\n' +
    '    name: jira-lifecycle-plugin\n' +
    '  - endpoint: http://payload-testing-prow-plugin\n' +
    '    name: payload-testing-prow-plugin\n' +
    'plugins:\n' +
    '  openshift:\n' +
    '    plugins:\n' +
    '      - label\n';
  const result = extractOrgPlugins(yaml, 'openshift/oadp-operator', 'openshift');
  assert.ok(result.includes('cherrypick'), 'org-level external cherrypick should be detected');
  assert.ok(result.includes('jira-lifecycle-plugin'));
  assert.ok(result.includes('payload-testing-prow-plugin'));
  assert.ok(result.includes('label'));
});

test('extractOrgPlugins: external_plugins entries without name are skipped', () => {
  const yaml =
    'external_plugins:\n' +
    '  org:\n' +
    '  - endpoint: http://mystery\n';
  const result = extractOrgPlugins(yaml, 'org/repo', 'org');
  assert.equal(result.length, 0);
});

test('extractOrgPlugins: repo- and org-keyed external_plugins entries are unioned', () => {
  // Prow's hook server matches external_plugins keyed by either the full repo
  // OR the org — both apply, neither shadows the other.
  const yaml =
    'external_plugins:\n' +
    '  openshift/oadp-operator:\n' +
    '  - name: repo-specific-plugin\n' +
    '    endpoint: http://repo-specific-plugin\n' +
    '  openshift:\n' +
    '  - name: org-wide-plugin\n' +
    '    endpoint: http://org-wide-plugin\n';
  const result = extractOrgPlugins(yaml, 'openshift/oadp-operator', 'openshift');
  assert.ok(result.includes('repo-specific-plugin'), 'full-repo entry should be included');
  assert.ok(result.includes('org-wide-plugin'), 'org entry should be included too (union)');
});

test('extractPlugins: repo- and org-keyed external_plugins entries are unioned', () => {
  const yaml =
    'external_plugins:\n' +
    '  org/repo:\n' +
    '  - name: repo-plugin\n' +
    '  org:\n' +
    '  - name: org-plugin\n';
  const result = extractPlugins(yaml, 'org/repo', 'org');
  assert.ok(result.includes('repo-plugin'));
  assert.ok(result.includes('org-plugin'));
});

test('extractOrgPlugins: excluded_repos does not suppress external_plugins', () => {
  // plugins.<org>.excluded_repos only removes the repo from the org plugins
  // stanza; Prow still serves external plugins to excluded repos.
  const yaml =
    'plugins:\n' +
    '  openshift:\n' +
    '    excluded_repos:\n' +
    '      - foo\n' +
    '    plugins:\n' +
    '      - label\n' +
    'external_plugins:\n' +
    '  openshift:\n' +
    '  - name: cherrypick\n' +
    '    endpoint: http://cherrypick\n';
  const result = extractOrgPlugins(yaml, 'openshift/foo', 'openshift');
  assert.ok(!result.includes('label'), 'excluded repo should not inherit the org plugins stanza');
  assert.ok(result.includes('cherrypick'), 'external plugins still apply to excluded repos');
});

// ── GitHub Actions rerun handlers ─────────────────────────────────────────────
// These call chrome.storage.local (via storageGet) and fetch(), neither of
// which the shared `ctx` provides by default (no existing test needed them) —
// install lightweight per-test mocks. Other tests in this file never touch
// ctx.chrome/ctx.fetch, so this is safe to add without affecting them.

// assert.deepEqual/deepStrictEqual compares prototypes too — a plain object
// returned from code run in a *different* vm context has a different
// Object.prototype (cross-realm), so it fails "same structure but not
// reference-equal" even when every field matches. Compare fields instead.
function assertResultEqual(actual, expected) {
  for (const key of Object.keys(expected)) {
    assert.equal(actual[key], expected[key], `field "${key}"`);
  }
}

function mockChromeStorage(tokenValue) {
  return {
    storage: {
      local: {
        get(key, cb) { cb(tokenValue === undefined ? {} : { [key]: tokenValue }); }
      }
    },
    runtime: {}
  };
}

test('handleVerifyGithubToken: missing token returns no-token without fetching', async () => {
  ctx.fetch = () => { throw new Error('should not fetch without a token'); };
  const result = await ctx.handleVerifyGithubToken('');
  assertResultEqual(result, { success: false, error: 'no-token' });
});

test('handleVerifyGithubToken: valid token returns success + login', async () => {
  ctx.fetch = async (url, opts) => {
    assert.equal(url, 'https://api.github.com/user');
    assert.equal(opts.headers.Authorization, 'Bearer abc123');
    return { ok: true, json: async () => ({ login: 'octocat' }) };
  };
  const result = await ctx.handleVerifyGithubToken('abc123');
  assertResultEqual(result, { success: true, login: 'octocat' });
});

test('handleVerifyGithubToken: non-ok response surfaces the HTTP status', async () => {
  ctx.fetch = async () => ({ ok: false, status: 401 });
  const result = await ctx.handleVerifyGithubToken('bad-token');
  assertResultEqual(result, { success: false, error: 'HTTP 401' });
});

test('handleRerunActionsJob: rejects a malformed repo before touching storage or fetch', async () => {
  ctx.chrome = mockChromeStorage('irrelevant');
  ctx.fetch = () => { throw new Error('should not fetch for a bad repo'); };
  const result = await ctx.handleRerunActionsJob('not-a-repo', '123', '456');
  assertResultEqual(result, { success: false, error: 'bad-repo' });
});

test('handleRerunActionsJob: rejects missing run/job IDs', async () => {
  ctx.chrome = mockChromeStorage('irrelevant');
  const result = await ctx.handleRerunActionsJob('org/repo', null, null);
  assertResultEqual(result, { success: false, error: 'bad-ids' });
});

test('handleRerunActionsJob: no stored token returns no-token without fetching', async () => {
  ctx.chrome = mockChromeStorage(undefined);
  ctx.fetch = () => { throw new Error('should not fetch without a token'); };
  const result = await ctx.handleRerunActionsJob('org/repo', '123', '456');
  assertResultEqual(result, { success: false, error: 'no-token' });
});

test('handleRerunActionsJob: posts to the documented rerun endpoint and reports success', async () => {
  ctx.chrome = mockChromeStorage('tok');
  ctx.fetch = async (url, opts) => {
    assert.equal(url, 'https://api.github.com/repos/org/repo/actions/jobs/456/rerun');
    assert.equal(opts.method, 'POST');
    assert.equal(opts.headers.Authorization, 'Bearer tok');
    return { ok: true, status: 201 };
  };
  const result = await ctx.handleRerunActionsJob('org/repo', '123', '456');
  assertResultEqual(result, { success: true });
});

test('handleRerunActionsJob: maps 403 to forbidden (token lacks Actions write access)', async () => {
  ctx.chrome = mockChromeStorage('tok');
  ctx.fetch = async () => ({ ok: false, status: 403 });
  const result = await ctx.handleRerunActionsJob('org/repo', '123', '456');
  assertResultEqual(result, { success: false, error: 'forbidden' });
});

test('handleRerunActionsJob: maps 404 to not-found (job may have expired)', async () => {
  ctx.chrome = mockChromeStorage('tok');
  ctx.fetch = async () => ({ ok: false, status: 404 });
  const result = await ctx.handleRerunActionsJob('org/repo', '123', '456');
  assertResultEqual(result, { success: false, error: 'not-found' });
});

test('handleRerunFailedActionsJobs: no stored token returns no-token', async () => {
  ctx.chrome = mockChromeStorage(undefined);
  const result = await ctx.handleRerunFailedActionsJobs('org/repo', '123');
  assertResultEqual(result, { success: false, error: 'no-token' });
});

test('handleRerunFailedActionsJobs: posts to the run-level rerun-failed-jobs endpoint', async () => {
  ctx.chrome = mockChromeStorage('tok');
  ctx.fetch = async (url, opts) => {
    assert.equal(url, 'https://api.github.com/repos/org/repo/actions/runs/123/rerun-failed-jobs');
    assert.equal(opts.method, 'POST');
    return { ok: true, status: 201 };
  };
  const result = await ctx.handleRerunFailedActionsJobs('org/repo', '123');
  assertResultEqual(result, { success: true });
});
