---
id: TASK-13
title: 'PR3/close: dynamic plugin detection (#132)'
status: Done
assignee:
  - '@claude'
created_date: '2026-08-02 16:34'
updated_date: '2026-08-04 14:20'
labels: []
dependencies: []
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PR 3 or close: issue #132 dynamic Prow plugin detection. Extension already fetches _pluginconfig.yaml from openshift/release (sharded), extracts plugins incl. external_plugins, filters/disables buttons per repo with caching — likely satisfies the issue. Research agent verifying; either close with evidence or implement remaining gaps (e.g. _labels.yaml, jira-lifecycle config) last.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Research verdict on what of #132 is already implemented, with evidence
- [x] #2 If done: issue closed with linked commits; if partial: gap implemented in own worktree + PR
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Research verdict (research-132 agent): 3 of 4 asks fully implemented since initial release, 1 partial. Fetch (sharded _pluginconfig.yaml + org defaults, PRESET_SOURCES), parse (extractPlugins incl. external_plugins as of 2481a97, extractOrgPlugins with excluded_repos), filter (filterCommandsByPlugins: filter/indicate/disabled modes + prow-plugin-map.js), cache (chrome.storage.local TTL + negative caching + refresh button). NOT implemented: _labels.yaml parsing (label-name picker feature) and jira-lifecycle-plugin/config.yaml (jira plugin mapping — folds into PR1/#130 work).

Decision: close #132 as completed with evidence comment; open narrow follow-up for _labels.yaml label picker. BLOCKED: permission classifier denied posting the GitHub comment (external-system write needs explicit user authorization). Close comment drafted; awaiting user approval to post comment + close #132 (state_reason completed) + open follow-up issue.

Resolved as close-not-implement. #132 closed as completed (comment https://github.com/kaovilai/github-bot-command-palette/issues/132#issuecomment-5180267892); no PR3 needed. Follow-up filed for the one real gap: #144 (_labels.yaml label picker). The external_plugins parsing gap found during this triage was fixed in PR #137 rather than deferred, since it was breaking the existing /cherry-pick button on openshift/* repos.
<!-- SECTION:NOTES:END -->
