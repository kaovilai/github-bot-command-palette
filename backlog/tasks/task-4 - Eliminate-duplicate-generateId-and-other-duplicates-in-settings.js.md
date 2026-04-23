---
id: TASK-4
title: Eliminate duplicate generateId() and other duplicates in settings.js
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
  - 'settings.js:6'
  - 'settings.js:247'
  - 'settings.js:93'
  - 'settings.js:114'
  - 'config-manager.js:9'
priority: high
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
settings.js:6 has identical copy of generateId() from config-manager.js:9. Also duplicates: STORAGE_KEY, SCHEMA_VERSION, defaultConfig() (≈CM.DEFAULT_CONFIG), mkCmd() (≈CM.cmd), PRESET_SOURCES, esc() (HTML escape).

Load config-manager.js in settings.html. Replace all duplicates with CM.* calls:
- generateId → CM.generateId
- defaultConfig() → JSON.parse(JSON.stringify(CM.DEFAULT_CONFIG))
- mkCmd → CM.createCommand (exported from CM per task-2)
- PRESET_SOURCES → CM.PRESET_SOURCES
- esc() → CM.escapeHtml (added to CM per task-2)
- loadConfig/saveConfig → simplified wrappers around CM.getConfig/CM.saveConfig
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 settings.js has no local generateId, esc, mkCmd, PRESET_SOURCES, STORAGE_KEY, or SCHEMA_VERSION
- [ ] #2 settings.html loads config-manager.js before settings.js
- [ ] #3 Reset to defaults uses CM.DEFAULT_CONFIG
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Step 1: Add config-manager.js to settings.html
Before settings.js script tag (line 370):
```html
<script src="config-manager.js"></script>
<script src="settings.js"></script>
```

### Step 2: Remove duplicated declarations from settings.js
Delete these blocks:
- Lines 3-4: `const STORAGE_KEY`, `const SCHEMA_VERSION`
- Lines 6-12: `function generateId()`
- Lines 14-91: `function defaultConfig()`
- Lines 93-112: `const PRESET_SOURCES` — note: missing `presubmitsBasePath` field that CM.PRESET_SOURCES has. Using CM's version fixes this drift.
- Lines 114-123: `function mkCmd()`
- Lines 247-251: `function esc()`

### Step 3: Add CM reference at top of IIFE
```js
(async () => {
  const CM = GHBCP.ConfigManager;
```

### Step 4: Simplify loadConfig/saveConfig (lines 131-147)
```js
async function loadConfig() {
  config = await CM.getConfig();
}

async function saveConfig() {
  await CM.saveConfig(config);
}
```

### Step 5: Replace all generateId() calls
Line 258, 343, 409, 422, 625 → CM.generateId()

### Step 6: Replace all esc() calls
Lines 202, 203, 204, 287, 288, 322, 323, 510, 511, 513, 514, 557 → CM.escapeHtml()

### Step 7: Replace PRESET_SOURCES references
Lines 556-558 (render loop): `PRESET_SOURCES` → `CM.PRESET_SOURCES`
Line 596: `PRESET_SOURCES[parseInt(val)]` → `CM.PRESET_SOURCES[parseInt(val)]`
Lines 607-614 (preset field population): `preset.presubmitsBasePath` at line 613 now just works since CM.PRESET_SOURCES has this field

### Step 8: Replace defaultConfig() in reset handler
Line 486: `config = defaultConfig()` → `config = JSON.parse(JSON.stringify(CM.DEFAULT_CONFIG))`

### Verification
- Settings page loads and renders all profiles
- Create/edit/delete profile, command, source all work
- Reset to defaults restores all 4 profiles
- Preset source "OpenShift CI" now includes presubmitsBasePath
- `grep -n 'generateId\|function esc\|PRESET_SOURCES\|STORAGE_KEY\|mkCmd\|SCHEMA_VERSION' settings.js` — only CM.* references
<!-- SECTION:PLAN:END -->
