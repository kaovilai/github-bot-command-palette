---
id: TASK-5
title: Split content.js into three files by concern
status: To Do
assignee: []
created_date: '2026-04-22 19:39'
updated_date: '2026-04-22 19:49'
labels:
  - refactor
dependencies:
  - TASK-2
  - TASK-3
references:
  - content.js
  - 'manifest.json:13'
priority: medium
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
content.js is 863 lines — split by concern:

**content-commands.js** (~365 lines) — command execution UI:
- Internal _config state set via setConfig()
- URL helpers: detectRepo, isPRPage, getPRNumber, getGitHubTheme
- DOM scrapers: scrapeCheckNames, findCommentTextarea, findSubmitButton
- UI: showToast, showTestJobPicker, showInputPopover
- Execution: createButton, handleCommandClick, fillComment
- Export as GHBCP.ContentCommands

**content-injectors.js** (~220 lines) — DOM injection:
- injectGlobalCommandBar(profiles, extraCommands, {currentRepo, lastPluginData, onRefresh})
- injectCheckButtons(profiles, currentRepo)
- injectReviewToolbar(profiles, currentRepo)
- injectReviewDialogBar(profiles, extraCommands, currentRepo)
- Uses GHBCP.ContentCommands for createButton etc.
- Export as GHBCP.ContentInjectors

**content.js** (~170 lines) — orchestration:
- inject(), debouncedInject()
- registerShortcuts, handleShortcut
- SPA navigation listeners, MutationObserver
- Calls setConfig on ContentCommands, passes params to injectors

manifest.json content_scripts order: constants.js, prow-plugin-map.js, config-manager.js, content-commands.js, content-injectors.js, content.js
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 content.js under 200 lines
- [ ] #2 content-commands.js and content-injectors.js created
- [ ] #3 All content script functions work identically (command bar renders, buttons fill textarea, job picker works, shortcuts work)
- [ ] #4 manifest.json lists all content scripts in correct order
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

content.js is now 917 lines (was 863). New features since last plan: `lastPresubmitJobs`, `fetchPresubmitJobs()`, `detectTargetBranch()`, presubmit-aware job picker, presubmit-aware check buttons.

### Design: shared state via GHBCP namespace modules

Content scripts share global scope. Each module exports via `GHBCP.*`. Config passed via `setConfig()`. Presubmit state passed via `setPresubmitJobs()`.

### Step 1: Create content-commands.js (~400 lines)

```js
GHBCP.ContentCommands = (() => {
  const CM = GHBCP.ConfigManager;
  let _config = null;
  let _presubmitJobs = null;

  function setConfig(config) { _config = config; }
  function setPresubmitJobs(jobs) { _presubmitJobs = jobs; }
  function getPresubmitJobs() { return _presubmitJobs; }

  // URL helpers (lines 10-30)
  function detectRepo() { ... }
  function isPRPage() { ... }
  function getPRNumber() { ... }
  function detectTargetBranch() { ... }  // NEW

  // DOM helpers (lines 32-41, 66-109, 430-479, 481-496)
  function getGitHubTheme() { ... }
  function scrapeCheckNames() { ... }
  function findCommentTextarea() { ... }
  function findSubmitButton(textarea) { ... }
  function showToast(message, type) { ... }

  // Command execution (lines 43-401)
  // showTestJobPicker now reads _presubmitJobs (lines 130-149)
  function createButton(command, context) { ... }
  function handleCommandClick(command, context, btn) { ... }
  function showTestJobPicker(command, context, anchorBtn) { ... }
  function showInputPopover(command, context, anchorBtn) { ... }
  function fillComment(cmdText) { ... }

  return {
    setConfig, setPresubmitJobs, getPresubmitJobs,
    detectRepo, isPRPage, getPRNumber, detectTargetBranch,
    getGitHubTheme, scrapeCheckNames, createButton,
    handleCommandClick, fillComment, findCommentTextarea,
    findSubmitButton, showToast
  };
})();
```

### Step 2: Create content-injectors.js (~240 lines)

```js
GHBCP.ContentInjectors = (() => {
  const CM = GHBCP.ConfigManager;
  const Cmd = GHBCP.ContentCommands;

  // lines 498-613
  function injectGlobalCommandBar(profiles, extraCommands, opts) {
    const { currentRepo, lastPluginData, onRefresh } = opts;
    // Refresh button uses GHBCP.Actions.REFRESH_PLUGINS
    // Calls onRefresh() instead of inject()
    ...
  }

  // lines 615-705 — now has presubmit rerun logic
  function injectCheckButtons(profiles, currentRepo) {
    // Reads Cmd.getPresubmitJobs() for rerun mapping (lines 651-655)
    ...
  }

  // lines 707-737
  function injectReviewToolbar(profiles, currentRepo) { ... }

  // lines 739-794
  function injectReviewDialogBar(profiles, extraCommands, currentRepo) { ... }

  return { injectGlobalCommandBar, injectCheckButtons,
           injectReviewToolbar, injectReviewDialogBar };
})();
```

### Step 3: Rewrite content.js (~180 lines)

```js
(async () => {
  const CM = GHBCP.ConfigManager;
  const Cmd = GHBCP.ContentCommands;
  const Inj = GHBCP.ContentInjectors;
  let config = null;
  let currentRepo = null;
  let debounceTimer = null;
  let lastPluginData = null;

  // NEW: fetchPresubmitJobs (lines 111-124)
  async function fetchPresubmitJobs() {
    if (!CM.isContextValid() || !currentRepo) return null;
    try {
      const resp = await chrome.runtime.sendMessage({
        action: GHBCP.Actions.GET_PRESUBMIT_JOBS,
        repo: currentRepo,
        branch: Cmd.detectTargetBranch(),
        prNumber: Cmd.getPRNumber()
      });
      return resp && resp.jobs ? resp.jobs : null;
    } catch (e) { return null; }
  }

  // Shortcuts (lines 796-827)
  function registerShortcuts(profiles) { ... }
  function handleShortcut(e) { ... }

  // Orchestration (lines 829-873)
  async function inject() {
    config = await CM.getConfig();
    Cmd.setConfig(config);
    currentRepo = Cmd.detectRepo();
    ...
    const presubmitJobs = await fetchPresubmitJobs();
    Cmd.setPresubmitJobs(presubmitJobs);
    ...
    Inj.injectGlobalCommandBar(profiles, extraCommands,
      { currentRepo, lastPluginData, onRefresh: inject });
    Inj.injectCheckButtons(profiles, currentRepo);
    Inj.injectReviewToolbar(profiles, currentRepo);
    Inj.injectReviewDialogBar(profiles, extraCommands, currentRepo);
    registerShortcuts(profiles);
  }

  // Navigation + MutationObserver (lines 875-917)
})();
```

### Step 4: Update manifest.json content_scripts js array
```json
"js": ["constants.js", "prow-plugin-map.js", "config-manager.js",
       "content-commands.js", "content-injectors.js", "content.js"]
```

### Verification
- Command bar renders with all profiles
- Click button → textarea fills
- Job picker: from scraped checks AND presubmit YAML jobs
- Per-job `/test` commands (one per line)
- Check buttons show "Test This" with rerun job name from presubmits
- Keyboard shortcuts work
- Review toolbar + dialog bar work
- Refresh button re-fetches
- SPA navigation re-injects
- `wc -l content.js` < 200
<!-- SECTION:PLAN:END -->
