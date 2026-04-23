---
id: TASK-2
title: Add escapeHtml and createCommand exports to ConfigManager
status: To Do
assignee: []
created_date: '2026-04-22 19:39'
updated_date: '2026-04-22 19:49'
labels:
  - refactor
dependencies: []
references:
  - 'config-manager.js:233'
  - 'config-manager.js:17'
  - 'config-manager.js:269'
  - 'settings.js:247'
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
config-manager.js needs two new exports so popup.js and settings.js can stop duplicating:

1. escapeHtml(str) — proper HTML escape using div.textContent→div.innerHTML pattern (like settings.js esc()). Note: existing sanitizeCommand() is a no-op (textContent→textContent round-trip) — fine for textarea.value usage but not for innerHTML.

2. createCommand — export existing internal cmd() function so settings.js can use it instead of its own mkCmd().

Add both to the return object at config-manager.js:269.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 CM.escapeHtml exists and uses textContent→innerHTML pattern
- [ ] #2 CM.createCommand exists and matches existing cmd() signature
- [ ] #3 Existing sanitizeCommand unchanged (used correctly for textarea values)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Step 1: Add escapeHtml function (after sanitizeCommand, ~line 238)
```js
function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
```
Note: sanitizeCommand at line 234 (textContent→textContent) is intentionally a no-op — used for textarea.value where HTML escaping is unnecessary. Keep it.

### Step 2: Export cmd as createCommand and escapeHtml
Edit return object at line 270-285:
```js
return {
  generateId,
  createCommand: cmd,  // NEW — exposes internal cmd() builder
  escapeHtml,          // NEW — proper HTML escape for innerHTML
  isContextValid,
  getConfig,
  saveConfig,
  resetToDefaults,
  getMatchingProfiles,
  getExtraCommands,
  filterCommandsByPlugins,
  globMatch,
  sanitizeCommand,
  DEFAULT_CONFIG,
  PRESET_SOURCES,
  STORAGE_KEY
};
```

### Verification
- `CM.escapeHtml('<script>')` returns `&lt;script&gt;`
- `CM.createCommand('Test', '/test', 'primary')` returns command object with generated id
- All existing tests still pass
<!-- SECTION:PLAN:END -->
