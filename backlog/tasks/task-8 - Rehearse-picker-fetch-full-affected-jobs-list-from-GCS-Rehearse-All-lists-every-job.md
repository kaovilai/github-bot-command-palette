---
id: TASK-8
title: >-
  Rehearse picker: fetch full affected-jobs list from GCS; Rehearse All lists
  every job
status: In Progress
assignee:
  - '@claude'
created_date: '2026-07-31 16:48'
labels: []
dependencies: []
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
REHEARSALNOTIFIER comments on openshift/release PRs truncate the affected-jobs table to 25 rows but link the full list (e.g. 207 jobs) at https://gcsweb-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/test-platform-results/pj-rehearse/<org>/<repo>/<pr>/<sha>, served as a plain pipe-table 'Test Name | Repo | Type | Reason'. Currently scrapeRehearsalNames() only reads the 25-row comment table, so the Rehearse... picker is incomplete, and Rehearse All posts bare /pj-rehearse. Fetch the full listing via background (new host permission + message handler with URL allowlist), use it in the picker, and make Rehearse All expand to an explicit list of every job. Schema bump so built-in profile refresh delivers the updated commands.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Rehearse picker lists all affected jobs from the GCS full listing linked in REHEARSALNOTIFIER comment (not just 25 scraped rows)
- [ ] #2 Rehearse All posts /pj-rehearse with every affected job name listed explicitly
- [ ] #3 Falls back to scraped comment table when GCS listing unavailable
- [ ] #4 Tests cover list parsing and URL validation
<!-- AC:END -->
