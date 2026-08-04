---
id: TASK-9
title: Add Cherry-pick button with branch dropdown picker
status: Done
assignee:
  - '@claude'
created_date: '2026-07-31 21:21'
updated_date: '2026-07-31 21:25'
labels: []
dependencies: []
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
migtools/oadp-cli#243 shows the openshift-cherrypick-robot flow: comment '/cherry-pick <branch>' per target branch, robot opens cherry-pick PRs. Add a Cherry-pick... button to the universal Prow profile with a job-picker-style dropdown listing the repo's branches (GitHub API), multi-select posting one /cherry-pick line per branch. Also parse external_plugins in _pluginconfig.yaml (cherrypick is an external plugin, currently invisible to plugin filtering).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Cherry-pick... button with branch dropdown picker on Prow repos
- [x] #2 Branch list fetched from GitHub API for current repo
- [x] #3 Multi-select posts one /cherry-pick <branch> line per branch
- [x] #4 cherrypick external plugin detected so plugin filtering doesn't disable the button
- [x] #5 Tests cover external_plugins extraction and new command
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Command form confirmed from PR comments: '/cherry-pick <branch>' per branch, answered by openshift-cherrypick-robot. cherrypick is configured under external_plugins in _pluginconfig.yaml (not the plugins list) — extractPlugins gained Method 3 for that section. New 'branches' jobSource: content.js fetchRepoBranches() (per-repo cache) → background handleGetRepoBranches() (3 pages × 100, sortBranchNames puts slash-less release branches first); picker falls back to showInputPopover when branch fetch fails. settings.html job-source dropdown gained 'branches'. Multi-line '/cherry-pick a\n/cherry-pick b' in one comment works because the cherrypicker plugin regex uses multiline FindAll.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added Cherry-pick... button (universal Prow profile, schema v9) with a branch dropdown picker: branches fetched from the GitHub API via background (up to 300, release branches sorted before bot branches), multi-select posts one /cherry-pick <branch> line per branch in a single comment, free-form input fallback when the API is unavailable. extractPlugins now parses external_plugins so cherrypick (an external plugin) is visible to plugin filtering. Verified live against migtools/oadp-cli (#243 flow): cherrypick detected, oadp-1.3..1.6/oadp-dev listed first. 177/177 tests. Pushed as 2481a97.
<!-- SECTION:FINAL_SUMMARY:END -->
