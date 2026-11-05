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
const { parseActionsRunJobIds, parseRehearsalCheckContext, computePresubmitContextShortName, findRehearsalJobMatch, findOwnRowAnchor, matchesJobSearch, buildJoinedCommandText } = ctx;
assert.equal(typeof parseActionsRunJobIds, 'function', 'parseActionsRunJobIds should have been extracted');
assert.equal(typeof parseRehearsalCheckContext, 'function', 'parseRehearsalCheckContext should have been extracted');
assert.equal(typeof computePresubmitContextShortName, 'function', 'computePresubmitContextShortName should have been extracted');
assert.equal(typeof findRehearsalJobMatch, 'function', 'findRehearsalJobMatch should have been extracted');
assert.equal(typeof matchesJobSearch, 'function', 'matchesJobSearch should have been extracted');
assert.equal(typeof buildJoinedCommandText, 'function', 'buildJoinedCommandText should have been extracted');

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


// ── findOwnRowAnchor ─────────────────────────────────────────────────────────
// Fake just enough DOM: a chain of nodes with parentElement and a style table.

function chain(styles) {
  // styles[0] is the starting element, last is the dialog (`stop`).
  const nodes = styles.map((style, i) => ({ id: i, style, parentElement: null }));
  nodes.forEach((n, i) => { n.parentElement = nodes[i + 1] || null; });
  const getStyle = (el) => el.style;
  return { nodes, getStyle };
}

test('findOwnRowAnchor: block parent means no climbing', () => {
  const { nodes, getStyle } = chain([{ display: 'block' }, { display: 'block' }, { display: 'block' }]);
  assert.equal(findOwnRowAnchor(nodes[0], nodes[2], getStyle), nodes[0]);
});

test('findOwnRowAnchor: climbs past row-flex and display:contents parents', () => {
  // textarea -> inputWrapper (flex row) -> contents -> column container -> dialog
  const { nodes, getStyle } = chain([
    { display: 'block' },
    { display: 'flex', flexDirection: 'row' },
    { display: 'contents' },
    { display: 'flex', flexDirection: 'column' },
    { display: 'block' }
  ]);
  // textarea's parent is the row-flex wrapper (climb), whose parent is `contents` (climb),
  // whose parent is the column container (stop): anchor is the `contents` node's child chain end.
  assert.equal(findOwnRowAnchor(nodes[0], nodes[4], getStyle), nodes[2]);
});

test('findOwnRowAnchor: flex column parent is a valid row stack, no climbing', () => {
  const { nodes, getStyle } = chain([{ display: 'block' }, { display: 'flex', flexDirection: 'column' }, { display: 'block' }]);
  assert.equal(findOwnRowAnchor(nodes[0], nodes[2], getStyle), nodes[0]);
});

test('findOwnRowAnchor: inline-flex row (default direction) is climbed', () => {
  const { nodes, getStyle } = chain([{ display: 'block' }, { display: 'inline-flex', flexDirection: 'row' }, { display: 'block' }, { display: 'block' }]);
  assert.equal(findOwnRowAnchor(nodes[0], nodes[3], getStyle), nodes[1]);
});

test('findOwnRowAnchor: never climbs to or above the dialog', () => {
  const { nodes, getStyle } = chain([{ display: 'block' }, { display: 'flex', flexDirection: 'row' }, { display: 'flex', flexDirection: 'row' }]);
  // stop = nodes[2]; node[1]'s parent is the stop, so it must stay at nodes[1].
  assert.equal(findOwnRowAnchor(nodes[0], nodes[2], getStyle), nodes[1]);
});

test('matchesJobSearch: compact query matches characters spread across the name', () => {
  // The reported case: typing "5.0cli" must surface "5.0-e2e-test-cli-aws".
  assert.equal(matchesJobSearch('5.0-e2e-test-cli-aws', '5.0cli'), true);
});

test('matchesJobSearch: compact query does not match unrelated jobs sharing the prefix', () => {
  // Same picker list the user saw — none of these contain c, l, i in order.
  for (const name of ['5.0-e2e-test-aws', '5.0-ci-index', '5.0-images', '5.0-virt-kdm-e2e-test-aws', '5.0-virt-nokdm-e2e-test-aws']) {
    assert.equal(matchesJobSearch(name, '5.0cli'), false, `${name} should not match "5.0cli"`);
  }
});

test('matchesJobSearch: plain substrings still match contiguously', () => {
  assert.equal(matchesJobSearch('5.0-e2e-test-cli-aws', 'cli-aws'), true);
  assert.equal(matchesJobSearch('5.0-e2e-test-cli-aws', 'e2e'), true);
});

test('matchesJobSearch: matching is case-insensitive', () => {
  assert.equal(matchesJobSearch('5.0-E2E-Test-CLI-aws', '5.0cli'), true);
});

test('matchesJobSearch: every whitespace-separated term must match', () => {
  assert.equal(matchesJobSearch('5.0-e2e-test-cli-aws', '5.0 cli'), true);
  assert.equal(matchesJobSearch('5.0-e2e-test-cli-aws', '5.0 nomatch'), false);
});

test('matchesJobSearch: quoted terms match as one phrase containing spaces', () => {
  assert.equal(matchesJobSearch('presubmit: e2e cli aws', '"e2e cli"'), true);
  assert.equal(matchesJobSearch('presubmit: e2e cli aws', '"cli e2e"'), false);
});

test('matchesJobSearch: quoted terms opt out of the fuzzy fallbacks', () => {
  assert.equal(matchesJobSearch('5.0-e2e-test-cli-aws', '"cli5.0"'), false);
  assert.equal(matchesJobSearch('5.0-e2e-test-cli-aws', '"5.0cli"'), false);
});

test('matchesJobSearch: quoted phrases must stay contiguous, not just in order', () => {
  // Both words are present and in order here, but separated — the phrase
  // query must not fall back to subsequence matching.
  assert.equal(matchesJobSearch('presubmit: e2e unrelated cli aws', '"e2e cli"'), false);
});

test('matchesJobSearch: reversed fragments match as an unordered character set', () => {
  assert.equal(matchesJobSearch('5.0-e2e-test-cli-aws', 'cli5.0'), true);
  assert.equal(matchesJobSearch('5.0-e2e-test-cli-aws', 'cli50'), true);
});

test('matchesJobSearch: unordered fallback still needs every character present', () => {
  assert.equal(matchesJobSearch('5.0-e2e-test-cli-aws', 'cli5.0x'), false);
});

test('matchesJobSearch: unordered fallback is skipped for 1-2 character terms', () => {
  // "sa" is not a substring of "aws-test" and appears out of order; matching
  // it anyway would make nearly every job match a two-key query.
  assert.equal(matchesJobSearch('aws-test', 'sa'), false);
  assert.equal(matchesJobSearch('aws-test', 'saw'), true);
});

test('matchesJobSearch: empty or whitespace-only query matches everything', () => {
  assert.equal(matchesJobSearch('anything', ''), true);
  assert.equal(matchesJobSearch('anything', '   '), true);
});

// ── buildJoinedCommandText ───────────────────────────────────────────────────
// Mirrors how Prow's cherrypicker parses a comment
// (cmd/external-plugins/cherrypicker, parseComment): every line matching
// `^/cherry-pick\s+(.+)$` becomes one independent target branch, and within a
// line only the FIRST token is picked — the rest are chain branches carried
// forward in the new PR's body. So:
//   one command per line  → parallel cherry-pick PRs
//   one space-joined line → sequential chain, one branch per merge

test('buildJoinedCommandText: default joinMode posts one command per branch (parallel)', () => {
  assert.equal(
    buildJoinedCommandText('/cherry-pick {input}', ['release-1.17', 'release-1.16'], ''),
    '/cherry-pick release-1.17\n/cherry-pick release-1.16'
  );
});

test('buildJoinedCommandText: single-command join space-joins into one chain command', () => {
  // Prow picks release-1.17 now; release-1.16/1.15 ride in the new PR's body.
  assert.equal(
    buildJoinedCommandText('/cherry-pick {input}', ['release-1.17', 'release-1.16', 'release-1.15'], 'single-command'),
    '/cherry-pick release-1.17 release-1.16 release-1.15'
  );
});

test('buildJoinedCommandText: comma join is for /jira backport', () => {
  assert.equal(
    buildJoinedCommandText('/jira backport {input}', ['oadp-1.6', 'oadp-1.5'], 'single-command-comma'),
    '/jira backport oadp-1.6,oadp-1.5'
  );
});

test('buildJoinedCommandText: comma join refuses names containing a comma', () => {
  // A comma inside a name can't be expressed in a comma-joined argument —
  // null lets the picker keep the dialog open and alert instead of posting
  // an ambiguous command.
  assert.equal(
    buildJoinedCommandText('/jira backport {input}', ['a,b', 'c'], 'single-command-comma'),
    null
  );
});

test('buildJoinedCommandText: empty selection yields null (nothing to post)', () => {
  assert.equal(buildJoinedCommandText('/cherry-pick {input}', [], ''), null);
  assert.equal(buildJoinedCommandText('/cherry-pick {input}', undefined, 'single-command'), null);
});

test('buildJoinedCommandText: single selection is identical in both modes', () => {
  assert.equal(buildJoinedCommandText('/cherry-pick {input}', ['release-1.17'], ''), '/cherry-pick release-1.17');
  assert.equal(buildJoinedCommandText('/cherry-pick {input}', ['release-1.17'], 'single-command'), '/cherry-pick release-1.17');
});

