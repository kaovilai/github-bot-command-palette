#!/usr/bin/env bash
# ship-cleanup.sh <branch-name>
#
# Run after a feature branch's PR has merged: syncs local main and removes
# the now-merged branch (local + remote, best-effort).
set -euo pipefail

branch="${1:?usage: ship-cleanup.sh <branch-name>}"

git checkout main
git pull --ff-only

if git rev-parse --verify --quiet "$branch" >/dev/null; then
  git branch -d "$branch" || echo "Local branch '$branch' not fully merged into current HEAD -- left in place." >&2
fi

if git ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1; then
  git push origin --delete "$branch" || echo "Could not delete remote branch '$branch' (maybe already gone)." >&2
else
  echo "Remote branch '$branch' already gone (likely auto-deleted on merge)."
fi

echo "main synced to $(git rev-parse --short HEAD)."
