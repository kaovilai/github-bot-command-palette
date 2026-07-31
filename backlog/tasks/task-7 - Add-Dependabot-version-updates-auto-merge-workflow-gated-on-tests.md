---
id: TASK-7
title: Add Dependabot version updates + auto-merge workflow gated on tests
status: Done
assignee:
  - '@claude'
created_date: '2026-07-30 00:53'
updated_date: '2026-07-31 16:45'
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
- [x] #1 Dependabot version updates configured for npm and github-actions
- [x] #2 Dependabot PRs auto-merge patch/minor after tests pass; majors skipped
- [x] #3 Repo allow_auto_merge enabled
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added .github/dependabot.yml (npm + github-actions weekly), .github/workflows/test.yml (npm ci + npm test on PRs and main), .github/workflows/dependabot-auto-merge.yml (dependabot[bot] PRs: fetch-metadata, run test suite as merge gate since no required branch-protection checks exist, then gh pr merge --auto --squash for non-major updates). Pushed as e756540. Repo allow_auto_merge still false — local hook blocks gh api writes and no GitHub MCP tool covers repo settings; user must run: gh api -X PATCH /repos/kaovilai/github-bot-command-palette -F allow_auto_merge=true
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Dependabot automation complete: weekly npm + github-actions version updates (.github/dependabot.yml), CI test workflow on PRs/main (test.yml), and dependabot-auto-merge.yml which runs the test suite as a merge gate then auto-merges (squash) patch/minor dependabot PRs, leaving majors for review. Repo allow_auto_merge enabled by user via gh api. Pushed as e756540.
<!-- SECTION:FINAL_SUMMARY:END -->
