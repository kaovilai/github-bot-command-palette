---
name: ship
description: Full solo-repo ship cycle for github-bot-command-palette -- branch, push, PR, wait for checks, merge, delete branch, sync main. Use when asked to "ship it", "commit push merge", or do a full commit-to-merged cycle in this repo.
user_invocable: true
---

`main` on this repo is protected: direct `git push` is rejected (GH013 -- requires the `test` status check via a PR). This repo is solo-maintained, so once CI is green there's no reason to wait on human review -- go straight to merge.

## Steps

1. **Commit normally.** Review the diff, stage specific files, `git commit -s`. If you're already on a feature branch, skip to step 3.

2. **If the commit landed on `main`** (easy to do out of habit), move it to a branch:
   ```
   .claude/scripts/ship-branch.sh <branch-name>
   ```
   This creates `<branch-name>` at the current commit, resets local `main` back to `origin/main`, and pushes the branch. It refuses to run if the working tree is dirty or local `main` has diverged from `origin/main` (anything more complex than "a few commits ahead" needs a human look).

   If you're starting fresh, just `git checkout -b <branch-name>` before committing instead -- no script needed.

3. **Open the PR** with `mcp__github__create_pull_request` (never `gh pr create` -- blocked by hook, no MCP equivalent bypass intended).

4. **Watch it to green.** Use the `Monitor` tool to poll `gh pr view <n> --json mergeable,mergeStateStatus,statusCheckRollup` every ~20s until the required `test` check reports `SUCCESS` and `mergeable` is `MERGEABLE`. Other non-required checks (e.g. CodeRabbit) staying pending is fine -- don't wait on those. If `test` fails, stop and report -- don't force-merge a red required check.

5. **Merge** with `mcp__github__merge_pull_request` (`merge_method: "squash"` unless told otherwise). Never `gh pr merge` -- blocked by hook.

6. **Clean up and sync:**
   ```
   .claude/scripts/ship-cleanup.sh <branch-name>
   ```
   Checks out `main`, pulls, deletes the local branch, deletes the remote branch (no-op if GitHub already auto-deleted it).

## What NOT to do

- Don't try `git push` to `main` directly -- it will always be rejected.
- Don't use `gh pr create`/`gh pr merge` -- both blocked by `.claude/hooks/block-gh-cli-writes.sh`; use the MCP tools.
- Don't skip step 4 and merge blind -- the required `test` check is real gating, not decorative.
- Don't run `ship-branch.sh` on a dirty tree or a diverged `main` -- it refuses on purpose; resolve by hand instead.
