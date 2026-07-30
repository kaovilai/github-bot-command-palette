---
id: TASK-7
title: Add Dependabot version updates + auto-merge workflow gated on tests
status: In Progress
assignee:
  - '@claude'
created_date: '2026-07-30 00:53'
labels: []
dependencies: []
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Repo has 2 open Dependabot vulnerabilities and no automation: no .github/dependabot.yml, no CI test workflow, no auto-merge. Add dependabot.yml (npm + github-actions weekly), a test workflow running npm test, and a dependabot auto-merge workflow that runs tests then enables auto-merge for patch/minor updates only. Enable repo allow_auto_merge setting.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Dependabot version updates configured for npm and github-actions
- [ ] #2 Dependabot PRs auto-merge patch/minor after tests pass; majors skipped
- [ ] #3 Repo allow_auto_merge enabled
<!-- AC:END -->
