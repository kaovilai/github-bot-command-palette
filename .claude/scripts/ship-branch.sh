#!/usr/bin/env bash
# ship-branch.sh <branch-name>
#
# main on this repo is protected (required "test" status check -- direct
# push gets GH013-rejected). This moves whatever commit(s) ended up on local
# main onto a new feature branch and pushes it, without touching any history
# GitHub hasn't seen yet.
#
# Safety: refuses unless the working tree is clean and local main is a clean
# fast-forward ahead of origin/main (nothing to untangle).
set -euo pipefail

branch="${1:?usage: ship-branch.sh <branch-name>}"

current_branch=$(git symbolic-ref --short HEAD)
if [ "$current_branch" != "main" ]; then
  echo "Already on '$current_branch', not main -- nothing to move. Just: git push -u origin $current_branch" >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree not clean -- commit or stash first." >&2
  exit 1
fi

git fetch origin main --quiet

if ! git merge-base --is-ancestor origin/main main; then
  echo "Local main has diverged from origin/main (not a clean fast-forward) -- resolve manually." >&2
  exit 1
fi

ahead=$(git rev-list --count origin/main..main)
if [ "$ahead" -eq 0 ]; then
  echo "Local main has no commits ahead of origin/main -- nothing to ship." >&2
  exit 1
fi

echo "Moving $ahead commit(s) from main to '$branch'..."
git branch "$branch"
git checkout "$branch"
git branch -f main origin/main
git push -u origin "$branch"

echo "Done. '$branch' pushed, local main reset to origin/main."
echo "Next: open a PR with mcp__github__create_pull_request, then run ship-cleanup.sh $branch once it merges."
