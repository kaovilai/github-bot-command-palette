---
id: TASK-8
title: >-
  Rehearse picker: fetch full affected-jobs list from GCS; Rehearse All lists
  every job
status: Done
assignee:
  - '@claude'
created_date: '2026-07-31 16:48'
updated_date: '2026-07-31 16:52'
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
- [x] #1 Rehearse picker lists all affected jobs from the GCS full listing linked in REHEARSALNOTIFIER comment (not just 25 scraped rows)
- [x] #2 Rehearse All posts /pj-rehearse with every affected job name listed explicitly
- [x] #3 Falls back to scraped comment table when GCS listing unavailable
- [x] #4 Tests cover list parsing and URL validation
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Pattern learned: REHEARSALNOTIFIER comment links the full affected-jobs list at https://gcsweb-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/test-platform-results/pj-rehearse/<org>/<repo>/<pr>/<sha>; response is plain text pipe-table "Test Name | Repo | Type | Reason" (GET only, HEAD returns 405).

- background.js: REHEARSAL_LIST_URL_PREFIX allowlist + isAllowedRehearsalListUrl() (URL comes from page DOM, so background revalidates), parseRehearsalJobList() pure parser, getRehearsalJobs message handler.
- content.js: findRehearsalListUrl() scans REHEARSALNOTIFIER comments for the gcsweb link (latest wins), fetchFullRehearsalJobs() with per-URL cache; picker jobSource 'rehearsals' uses full list with scraped-table fallback; expandAndPostRehearseAll() builds explicit job list for Rehearse All.
- config-manager.js: schema v8 (built-in profile refresh delivers new Rehearse All), cmd() gained expandRehearsalJobs flag; Rehearse All now expandRehearsalJobs+requireConfirm.
- settings.js: command editor carries over expandRehearsalJobs (not exposed in UI) so editing doesn't drop it.
- manifest.json: gcsweb-ci host permission (users must re-approve/reload extension).
- tests: parseRehearsalJobList, isAllowedRehearsalListUrl, DEFAULT_CONFIG Rehearse All flags, cmd() flag default. 172/172 pass, re-run after rebasing onto dependabot bumps (@playwright/test 1.62.0).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Rehearse... picker and Rehearse All now use the complete affected-jobs listing that pj-rehearse uploads to GCS (linked from the REHEARSALNOTIFIER comment), instead of the 25-row truncated comment table. Rehearse All expands to "/pj-rehearse <every job>" with a count-based confirm. Verified against openshift/release#82734: all 207 jobs parsed, expanded command 12.5KB. Pushed as 86d26a8 (rebased over dependabot auto-merges #119/#125 — auto-merge pipeline working).
<!-- SECTION:FINAL_SUMMARY:END -->
