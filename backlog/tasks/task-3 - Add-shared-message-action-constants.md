---
id: TASK-3
title: Add shared message action constants
status: To Do
assignee: []
created_date: '2026-04-22 19:39'
updated_date: '2026-04-22 19:49'
labels:
  - refactor
dependencies: []
references:
  - 'background.js:8-16'
  - 'content.js:795'
  - 'settings.js:674'
  - 'popup.js:102'
priority: medium
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Magic strings 'getEnabledPlugins', 'refreshPlugins', 'testPluginSource' scattered across background.js, content.js, settings.js, popup.js. Typo = silent bug.

Create constants.js:
```js
const GHBCP_ACTIONS = {
  GET_ENABLED_PLUGINS: 'getEnabledPlugins',
  REFRESH_PLUGINS: 'refreshPlugins',
  TEST_PLUGIN_SOURCE: 'testPluginSource'
};
if (typeof window !== 'undefined') {
  window.GHBCP = window.GHBCP || {};
  window.GHBCP.Actions = GHBCP_ACTIONS;
}
```

Load in manifest.json content_scripts (before other scripts), popup.html, settings.html. In background.js use importScripts('constants.js'). Replace all string literals with constants.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 constants.js exists with GHBCP_ACTIONS
- [ ] #2 No raw action strings in background.js, content.js, settings.js, popup.js
- [ ] #3 manifest.json content_scripts includes constants.js first
- [ ] #4 background.js importScripts includes constants.js
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Step 1: Create constants.js
```js
const GHBCP_ACTIONS = {
  GET_ENABLED_PLUGINS: 'getEnabledPlugins',
  REFRESH_PLUGINS: 'refreshPlugins',
  TEST_PLUGIN_SOURCE: 'testPluginSource',
  GET_PRESUBMIT_JOBS: 'getPresubmitJobs'
};

if (typeof window !== 'undefined') {
  window.GHBCP = window.GHBCP || {};
  window.GHBCP.Actions = GHBCP_ACTIONS;
}
```
4 actions total. Uses `const` global for service worker (no `window`), plus `GHBCP.Actions` for content/popup/settings pages.

### Step 2: manifest.json — add to content_scripts
Line 14, change js array to:
```json
"js": ["constants.js", "prow-plugin-map.js", "config-manager.js", "content.js"]
```

### Step 3: background.js — importScripts + replace strings
Line 2: `importScripts('vendor/js-yaml.min.js');`
→ `importScripts('constants.js', 'vendor/js-yaml.min.js');`

Line 10: `'getEnabledPlugins'` → `GHBCP_ACTIONS.GET_ENABLED_PLUGINS`
Line 14: `'refreshPlugins'` → `GHBCP_ACTIONS.REFRESH_PLUGINS`
Line 18: `'testPluginSource'` → `GHBCP_ACTIONS.TEST_PLUGIN_SOURCE`
Line 22: `'getPresubmitJobs'` → `GHBCP_ACTIONS.GET_PRESUBMIT_JOBS`

### Step 4: content.js — replace strings
Line 114: `action: 'getPresubmitJobs'` → `action: GHBCP.Actions.GET_PRESUBMIT_JOBS`
Line 534: `action: 'refreshPlugins'` → `action: GHBCP.Actions.REFRESH_PLUGINS`
Line 848: `action: 'getEnabledPlugins'` → `action: GHBCP.Actions.GET_ENABLED_PLUGINS`

### Step 5: popup.html — add script tag
Before config-manager.js (added in task-1):
```html
<script src="constants.js"></script>
```

### Step 6: popup.js — replace string
Line 102: `action: 'getEnabledPlugins'` → `action: GHBCP.Actions.GET_ENABLED_PLUGINS`

### Step 7: settings.html — add script tag
Before settings.js (line 370):
```html
<script src="constants.js"></script>
```

### Step 8: settings.js — replace string
Line 678: `action: 'testPluginSource'` → `action: GHBCP.Actions.TEST_PLUGIN_SOURCE`

### Verification
- `grep -rn "'getEnabledPlugins\|'refreshPlugins\|'testPluginSource\|'getPresubmitJobs" *.js` — should find 0 matches
- Extension loads, commands work, plugin fetch works, presubmit fetch works, settings test-source works
<!-- SECTION:PLAN:END -->
