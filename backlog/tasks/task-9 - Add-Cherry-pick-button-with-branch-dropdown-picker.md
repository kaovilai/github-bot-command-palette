---
id: TASK-9
title: Add Cherry-pick button with branch dropdown picker
status: In Progress
assignee:
  - '@claude'
created_date: '2026-07-31 21:21'
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
- [ ] #1 Cherry-pick... button with branch dropdown picker on Prow repos
- [ ] #2 Branch list fetched from GitHub API for current repo
- [ ] #3 Multi-select posts one /cherry-pick <branch> line per branch
- [ ] #4 cherrypick external plugin detected so plugin filtering doesn't disable the button
- [ ] #5 Tests cover external_plugins extraction and new command
<!-- AC:END -->
