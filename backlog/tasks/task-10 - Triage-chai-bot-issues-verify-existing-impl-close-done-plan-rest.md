---
id: TASK-10
title: 'Triage chai-bot issues: verify existing impl, close done, plan rest'
status: Done
assignee:
  - '@claude'
created_date: '2026-08-02 16:34'
updated_date: '2026-08-04 14:20'
labels: []
dependencies: []
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
redhat-chai-bot opened issues #129,#130,#132,#133,#134,#135,#136. Fan out research agents comparing each against existing implementation (plugin filtering, pickers, profiles). Close done ones with links; plan the rest into PR1 (static commands), PR2 (payload picker), PR3 (dynamic plugin detection, likely already done).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each chai-bot issue (#129,#130,#132,#133,#134,#135,#136) triaged: already-done parts identified with evidence
- [x] #2 Already-implemented issues closed with comment linking commits/files
- [x] #3 Remaining work planned into PR phases
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Triage complete (4 research agents): #132 substantially DONE (close with evidence; _labels.yaml picker = follow-up; jira mapping folds into PR1). #136,#135,#133,#129 NOT done. #130 partial (/cherry-pick parallel flow done in 2481a97; serial /cherrypick chain + /jira commands remain). CRITICAL live bug found: extractOrgPlugins doesn't parse external_plugins — openshift org keeps them org-level only (verified: repo-level openshift/oadp-operator has none) so /cherry-pick already wrongly filtered on openshift/* in filter mode; fix in PR1. Issue comment/close for #132 drafted, blocked on user approval (external-write permission). AC#2 pending that approval.

Closed #132 as completed with an evidence comment walking all four asks. Split the two genuinely-unimplemented pieces out: #144 (populate a label picker from _labels.yaml) and #145 (schema migration discards user edits to built-in commands — the finding CodeRabbit raised in five consecutive rounds across #137/#138). Jira-lifecycle config coverage lands with #137's /jira and /verified commands.
<!-- SECTION:NOTES:END -->
