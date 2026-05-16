---
on:
  schedule: daily
  workflow_dispatch:
  push:
    branches: [main]
engine: copilot
permissions:
  contents: read
  issues: read
  pull-requests: read
tools:
  edit:
  bash: ["git log", "git diff", "git show", "find", "grep", "wc", "cat", "ls", "head", "tail"]
  github:
    toolsets: [repos, issues, pull_requests]
safe-outputs:
  create-pull-request:
    max: 1
    title-prefix: "[daily] "
    labels: [automation]
    protected-files: fallback-to-issue
  create-issue:
    title-prefix: "[daily] "
    labels: [automation]
    max: 2
max-runs: 30
---

# Daily Repository Improvement

You are maintaining a Chrome extension that injects contextual action buttons for CI/bot slash commands on GitHub PR pages.

## Pre-flight Checks

Before doing anything, check for existing open PRs and issues:

1. Search for open PRs with label `automation`. If any exist, **stop** — do not create another PR. Post a comment on the existing PR asking if it can be reviewed and merged.
2. Search for open issues with label `automation`.
   - If any open issue describes the **same improvement** you are about to propose (same files, same category), **stop** — call `noop` with a message like "Duplicate of #N". Do not create another issue or PR for the same fix.
   - If an open issue describes a **different** improvement that is actionable now, consider working on that instead.

**Never include `Closes #N` or `Fixes #N` in an issue body** — only use closing keywords in PR descriptions. Using them in issues causes unintended auto-closing of other issues.

## Your Task

Each run, find up to THREE small, related improvements and bundle them into a single pull request. Since most changes touch shared files like `content.js`, separate PRs would conflict with each other. Group improvements by theme when possible.

## Improvement Categories (pick one)

### 1. Code Quality
- Find code duplication across `content.js`, `popup.js`, `settings.js`, `background.js`, `config-manager.js`
- Identify functions that are too long or complex and could be simplified
- Look for hardcoded values that should be configurable
- Check for missing error handling in async operations

### 2. Documentation
- Ensure README.md accurately reflects current features
- Add JSDoc comments to exported functions missing documentation
- Update or add inline comments where logic is non-obvious

### 3. Test Coverage
- Review `tests/extension.spec.js` and identify untested user flows
- Suggest or create new test cases for edge cases
- Check that test assertions are meaningful (not just "page loads")

### 4. Manifest & Extension Config
- Review `manifest.json` for deprecated keys or missing best practices
- Check permissions are minimal (no unnecessary broad permissions)
- Verify content script matching patterns are correct

### 5. Accessibility & UX
- Check injected UI elements for accessibility (aria labels, keyboard nav)
- Look for color contrast issues in injected buttons
- Ensure extension works with GitHub's dark mode

## Decision Criteria

Pick improvements that can be bundled cleanly into one PR. Prefer:
- Changes that fix actual bugs over style improvements
- Changes that affect users over internal-only refactors
- Grouping related changes (e.g., multiple accessibility fixes, or several error handling improvements)

## Output

If you find concrete improvements:
- Create ONE pull request bundling all changes
- PR description should list each improvement with what changed and why
- Do NOT create separate PRs for each improvement

If you find an issue that needs human decision-making:
- Create an issue describing the problem and possible solutions
- Do not make opinionated architectural changes without human input

If everything looks good today:
- Do nothing. No PR, no issue. Silent success.
