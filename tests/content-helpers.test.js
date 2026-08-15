'use strict';
// Unit tests for pure, top-level helper functions in content.js.
//
// content.js's main body is an async IIFE that immediately touches
// `document`/`chrome` on load, so (unlike background.js/config-manager.js)
// there's no existing harness that vm-executes the whole file. Functions
// declared *outside* that IIFE (alongside CHECKS_SECTION_SELECTOR etc.) have
// no such dependencies, so they're extracted and eval'd in isolation instead —
// a much smaller lift than building a full DOM+chrome mock for the file.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');

const contentJs = fs.readFileSync(path.resolve(__dirname, '..', 'content.js'), 'utf8');

const startMarker = 'const ACTIONS_RUN_JOB_HREF_RE';
const endMarker = '\n(async () => {';
const startIdx = contentJs.indexOf(startMarker);
const endIdx = contentJs.indexOf(endMarker, startIdx);
assert.ok(startIdx !== -1 && endIdx !== -1,
  'expected to find parseActionsRunJobIds() between its own top-level const and the content-script IIFE');
const snippet = contentJs.slice(startIdx, endIdx);

const ctx = {};
vm.runInNewContext(snippet, ctx);
const { parseActionsRunJobIds, parseRehearsalCheckContext, computePresubmitContextShortName, findRehearsalJobMatch } = ctx;
assert.equal(typeof parseActionsRunJobIds, 'function', 'parseActionsRunJobIds should have been extracted');
assert.equal(typeof parseRehearsalCheckContext, 'function', 'parseRehearsalCheckContext should have been extracted');
assert.equal(typeof computePresubmitContextShortName, 'function', 'computePresubmitContextShortName should have been extracted');
assert.equal(typeof findRehearsalJobMatch, 'function', 'findRehearsalJobMatch should have been extracted');

// assert.deepEqual/deepStrictEqual also compares prototypes — an object
// returned from code run in a *different* vm context has a different
// Object.prototype (cross-realm), so it fails "same structure but not
// reference-equal" even when every field matches. Compare fields instead.
function assertIdsEqual(actual, expected) {
  assert.equal(actual.runId, expected.runId);
  assert.equal(actual.jobId, expected.jobId);
}

// Same cross-realm caveat as assertIdsEqual() above, for the other functions'
// return shapes.
function assertRehearsalContextEqual(actual, expected) {
  assert.equal(actual.org, expected.org);
  assert.equal(actual.repo, expected.repo);
  assert.equal(actual.branch, expected.branch);
  assert.equal(actual.shortName, expected.shortName);
}

function assertJobMatchEqual(actual, expected) {
  assert.equal(actual.jobName, expected.jobName);
  assert.equal(actual.ambiguous, expected.ambiguous);
  assert.equal(actual.count, expected.count);
}

test('parseActionsRunJobIds: extracts run and job IDs from a full check-row href', () => {
  const href = '/openshift/velero/actions/runs/31753380458/job/94624504231?pr=562';
  assertIdsEqual(parseActionsRunJobIds(href), { runId: '31753380458', jobId: '94624504231' });
});

test('parseActionsRunJobIds: works without a query string', () => {
  const href = '/openshift/velero/actions/runs/1/job/2';
  assertIdsEqual(parseActionsRunJobIds(href), { runId: '1', jobId: '2' });
});

test('parseActionsRunJobIds: works with an absolute URL', () => {
  const href = 'https://github.com/openshift/velero/actions/runs/1/job/2?pr=562';
  assertIdsEqual(parseActionsRunJobIds(href), { runId: '1', jobId: '2' });
});

test('parseActionsRunJobIds: returns null for a non-Actions link (e.g. a Prow deck URL)', () => {
  const href = 'https://prow.ci.openshift.org/view/gs/test-platform-results/pr-logs/pull/openshift_velero/562/pull-ci-openshift-velero-oadp-dev-images/2088042739290607616';
  assert.equal(parseActionsRunJobIds(href), null);
});

test('parseActionsRunJobIds: returns null for missing/empty input', () => {
  assert.equal(parseActionsRunJobIds(null), null);
  assert.equal(parseActionsRunJobIds(undefined), null);
  assert.equal(parseActionsRunJobIds(''), null);
});

// ── parseRehearsalCheckContext ──────────────────────────────────────────────

test('parseRehearsalCheckContext: parses a normal rehearsal check context', () => {
  const checkName = 'ci/rehearse/migtools/kubevirt-datamover-controller/oadp-1.6/e2e-test-aws';
  assertRehearsalContextEqual(parseRehearsalCheckContext(checkName), {
    org: 'migtools',
    repo: 'kubevirt-datamover-controller',
    branch: 'oadp-1.6',
    shortName: 'e2e-test-aws'
  });
});

test('parseRehearsalCheckContext: returns null for a non-rehearsal check name', () => {
  assert.equal(parseRehearsalCheckContext('ci/prow/images'), null);
  assert.equal(parseRehearsalCheckContext('tide'), null);
});

test('parseRehearsalCheckContext: a branch containing "/" still yields the true trailing shortname', () => {
  const checkName = 'ci/rehearse/org/repo/release/4.16/e2e-test-aws';
  assertRehearsalContextEqual(parseRehearsalCheckContext(checkName), {
    org: 'org',
    repo: 'repo',
    branch: 'release/4.16',
    shortName: 'e2e-test-aws'
  });
});

test('parseRehearsalCheckContext: returns null for missing/empty/non-string input', () => {
  assert.equal(parseRehearsalCheckContext(null), null);
  assert.equal(parseRehearsalCheckContext(undefined), null);
  assert.equal(parseRehearsalCheckContext(''), null);
  assert.equal(parseRehearsalCheckContext(42), null);
});

// ── computePresubmitContextShortName ────────────────────────────────────────
// Mirrors openshift/ci-tools pkg/rehearse/jobs.go's contextFor():
//   func contextFor(source *prowconfig.Presubmit) string {
//     if source.Context != "" {
//       return source.Context[strings.LastIndex(source.Context, "/")+1:]
//     }
//     return source.Name
//   }

test('computePresubmitContextShortName: uses the last "/"-segment of context when set', () => {
  assert.equal(computePresubmitContextShortName({ jobName: 'pull-ci-org-repo-branch-e2e-test-aws', context: 'ci/prow/e2e-test-aws' }), 'e2e-test-aws');
});

test('computePresubmitContextShortName: falls back to jobName when context is empty', () => {
  assert.equal(computePresubmitContextShortName({ jobName: 'pull-ci-org-repo-branch-unit', context: '' }), 'pull-ci-org-repo-branch-unit');
});

test('computePresubmitContextShortName: returns undefined for a missing entry', () => {
  assert.equal(computePresubmitContextShortName(null), undefined);
  assert.equal(computePresubmitContextShortName(undefined), undefined);
});

// ── findRehearsalJobMatch ────────────────────────────────────────────────────

test('findRehearsalJobMatch: returns the single matching entry\'s jobName', () => {
  const entries = [
    { jobName: 'pull-ci-org-repo-branch-e2e-test-aws', context: 'ci/prow/e2e-test-aws' },
    { jobName: 'pull-ci-org-repo-branch-unit', context: 'ci/prow/unit' }
  ];
  assertJobMatchEqual(findRehearsalJobMatch(entries, 'e2e-test-aws'), { jobName: 'pull-ci-org-repo-branch-e2e-test-aws' });
});

test('findRehearsalJobMatch: returns null when nothing matches', () => {
  const entries = [{ jobName: 'pull-ci-org-repo-branch-unit', context: 'ci/prow/unit' }];
  assert.equal(findRehearsalJobMatch(entries, 'e2e-test-aws'), null);
});

test('findRehearsalJobMatch: flags (rather than guesses) when more than one entry matches', () => {
  const entries = [
    { jobName: 'pull-ci-org-repo-branch-e2e-test-aws', context: 'ci/prow/e2e-test-aws' },
    { jobName: 'pull-ci-org-repo-branch-other-e2e-test-aws', context: 'some-other-prefix/e2e-test-aws' }
  ];
  assertJobMatchEqual(findRehearsalJobMatch(entries, 'e2e-test-aws'), { ambiguous: true, count: 2 });
});

test('findRehearsalJobMatch: returns null for empty/null entries or shortName', () => {
  assert.equal(findRehearsalJobMatch(null, 'e2e-test-aws'), null);
  assert.equal(findRehearsalJobMatch([], 'e2e-test-aws'), null);
  assert.equal(findRehearsalJobMatch([{ jobName: 'x', context: 'a/x' }], ''), null);
});

