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
const { parseActionsRunJobIds } = ctx;
assert.equal(typeof parseActionsRunJobIds, 'function', 'parseActionsRunJobIds should have been extracted');

// assert.deepEqual/deepStrictEqual also compares prototypes — an object
// returned from code run in a *different* vm context has a different
// Object.prototype (cross-realm), so it fails "same structure but not
// reference-equal" even when every field matches. Compare fields instead.
function assertIdsEqual(actual, expected) {
  assert.equal(actual.runId, expected.runId);
  assert.equal(actual.jobId, expected.jobId);
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
