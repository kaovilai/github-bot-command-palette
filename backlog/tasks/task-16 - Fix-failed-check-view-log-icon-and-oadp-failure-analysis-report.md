---
id: TASK-16
title: Fix the failed-check "view log" icon and surface the oadp failure-analysis.md report
status: Done
assignee:
  - '@claude'
created_date: '2026-11-07 01:42'
labels: []
dependencies: []
modified_files:
  - background.js
  - content.js
  - tests/background.test.js
  - tests/failed-step-log.spec.js
  - tests/fixtures/pr-with-failed-check.html
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The failed-check "view log" icon (added in #177) never worked on oadp/velero PRs: hover and click always ended in "Failed to load log."

Root cause: CI artifacts for oadp-operator (and velero) presubmits live in the **public** GCS bucket `test-platform-results-public`, and Prow "Details" links point at `https://prow.ci.openshift.org/view/gs/test-platform-results-public/...`. `parseProwViewUrl` only accepted the private `test-platform-results` bucket, so every `getFailedStepLog` call returned `{text: null}`. The private bucket is not publicly readable anyway — the JSON List API returns 401 and object GETs 403; only its `-public` mirror is fetchable.

Additionally, the oadp `analyze-e2e-failure` post-step (openshift/release `ci-operator/step-registry/oadp/analyze-e2e-failure`) writes `failure-analysis.md` (plus `claude-failure-analysis-text.txt`) into its step artifact dir, at `<job>/artifacts/<test>/oadp-analyze-e2e-failure/artifacts/failure-analysis.md`. The extension never looked for it — the failed-check view should prefer showing that analysis alongside the raw failing-step log.

Verified against real failed runs:
- openshift/oadp-operator#2509 e2e job `2113031075788754944` (test-step failure + 4.7 KB analysis report)
- openshift/oadp-operator#2493 job `2118058375735414784` (open PR; 7.6 KB analysis + 115 KB step log) — used by the Playwright spec
- openshift/oadp-operator#2502 job `2112617814903754752` (image-build failure, ci-operator build-log fallback)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `parseProwViewUrl` accepts both `test-platform-results` and `test-platform-results-public`; the artifact walk always reads the public mirror
- [x] #2 `findFailedStepLog` attaches the analyze step's `failure-analysis.md` (falling back to `claude-failure-analysis-text.txt`, and to a bare non-`artifacts/` path) as `analysis`
- [x] #3 Hover preview prefers the analysis text; click modal shows an analysis section followed by the failing-step log
- [x] #4 Removed the `.slice(0, 10)` step caps that could skip a late-sorting failing step or the analyze post-step (oadp e2e jobs have ~19 inner steps)
- [x] #5 Comment-link analysis icons accept `-public` links and `failure-analysis.md` / `claude-failure-analysis-text.txt`
- [x] #6 Unit tests cover bucket parsing, public-bucket walk, analysis attachment/fallbacks, late-step scan, analysis-only result
- [x] #7 Playwright spec exercises hover + modal against real GCS artifacts via a GitHub-DOM fixture (live mode behind `GHBCP_LIVE_PR=1`)
<!-- AC:END -->
