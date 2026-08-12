---
id: TASK-14
title: Fix detectTargetBranch resolving head branch instead of base branch
status: Done
assignee: []
created_date: '2026-08-12 04:31'
labels: []
dependencies: []
modified_files:
  - content.js
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On openshift/oadp-operator#2206, the /test buttons for 3 failing checks posted `/test ci/prow/4.23-e2e-test-aws` etc. instead of the bare `/test 4.23-e2e-test-aws` from openshift/release's presubmits config.

Root cause: `detectTargetBranch()` in content.js used stale selectors (`.base-ref`, `.commit-ref`) that no longer match the base branch on GitHub's modern Primer React PR header. `.commit-ref` in particular belongs to unrelated "force-pushed the X branch" timeline events, so it resolved to the PR's *head* branch name (`OADP-7943-fix-annotation-reconcile-1.6`) instead of the base branch (`oadp-1.6`). background.js then 404'd fetching `openshift-oadp-operator-OADP-7943-fix-annotation-reconcile-1.6-presubmits.yaml` from openshift/release, returned null jobs, and content.js fell back to the raw (unresolved) check context name for the Test button label/command.

Fix: derive the base branch from the PR header's `/tree/` link that points at the current repo (base is always same-repo; head may be on a fork, and always appears first in DOM order), instead of matching by CSS class name.
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Rewrote detectTargetBranch() in content.js to resolve the PR base branch from the header's `/tree/` anchor pointing at the current repo (base always same-repo, always first in DOM order — "wants to merge N commits into &lt;base&gt; from &lt;head&gt;"), instead of matching `.base-ref`/`.commit-ref` CSS classes that no longer exist on GitHub's modern Primer React PR header. Verified live against openshift/oadp-operator#2206 via chrome-devtools: old code resolved the head branch name, new code correctly resolves `oadp-1.6`. All 191 existing unit tests still pass.
<!-- SECTION:FINAL_SUMMARY:END -->
