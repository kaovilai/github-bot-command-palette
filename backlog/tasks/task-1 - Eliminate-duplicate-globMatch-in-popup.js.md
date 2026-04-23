---
id: TASK-1
title: Eliminate duplicate globMatch() in popup.js
status: To Do
assignee: []
created_date: '2026-04-22 19:39'
updated_date: '2026-04-22 19:49'
labels:
  - refactor
  - dedup
dependencies:
  - TASK-2
references:
  - 'popup.js:6'
  - 'config-manager.js:148'
  - 'popup.html:76'
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
popup.js:6 has identical copy of globMatch() from config-manager.js:148. Load config-manager.js in popup.html and use GHBCP.ConfigManager.globMatch instead of local copy. Also removes duplicate getConfig/saveConfig from popup.js (lines 13-22) since CM has robust versions with error handling.

Also fix XSS: popup.js:59 injects repoName and profile names into innerHTML without escaping. Use CM.escapeHtml (see task for adding escapeHtml to CM).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 popup.js has no local globMatch, getConfig, or saveConfig — uses CM versions
- [ ] #2 popup.html loads config-manager.js before popup.js
- [ ] #3 All user-derived strings escaped via CM.escapeHtml before innerHTML insertion
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Step 1: Add config-manager.js to popup.html (before popup.js)
Edit popup.html line 76, change:
```html
<script src="popup.js"></script>
```
to:
```html
<script src="config-manager.js"></script>
<script src="popup.js"></script>
```

### Step 2: Rewrite popup.js to use CM
Remove lines 3-23 (local STORAGE_KEY, globMatch, getConfig, saveConfig). Add at top of IIFE:
```js
const CM = GHBCP.ConfigManager;
```

Replace all calls:
- `getConfig()` → `CM.getConfig()` (line 33)
- `saveConfig(config)` → `CM.saveConfig(config)` (line 126)
- `globMatch(pat, repoName)` → `CM.globMatch(pat, repoName)` (line 72)

### Step 3: Fix XSS in innerHTML construction
Line 59: `${repoName}` → `${CM.escapeHtml(repoName)}`
Line 79: `${p.name}` → `${CM.escapeHtml(p.name)}`
Line 91: `${c.command}` → `${CM.escapeHtml(c.command)}`

### Verification
- Popup shows repo name, matched profiles, command preview
- Toggle profile on/off persists to storage
- Settings link works
<!-- SECTION:PLAN:END -->
