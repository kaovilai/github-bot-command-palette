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
    '      - org/repo\n' +
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
    '      - org/other-repo\n' +
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
