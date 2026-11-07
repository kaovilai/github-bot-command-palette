---
id: TASK-17
title: Inline grep error log panel + opt-in live logic updates from the static site
status: Done
assignee:
  - '@claude'
created_date: '2026-11-07 02:10'
labels: []
dependencies: []
modified_files:
  - content.js
  - background.js
  - config-manager.js
  - config-export.json
  - manifest.json
  - settings.html
  - settings.js
  - styles.css
  - README.md
  - live/logic.json
  - live/index.html
  - .github/workflows/deploy-live-logic.yml
  - tests/content-helpers.test.js
  - tests/background.test.js
  - tests/failed-step-log.spec.js
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two follow-ups to the failed-check log view:

**1. Inline, scrollable grep error list on the PR page.** The log icon on a failed Prow check now toggles an inline panel under the check row instead of opening a modal directly. The panel greps the failing step's log (`extractErrorLines`, default patterns: `ERRO`, klog `E1107 …`, `FATAL`, `panic:`, ginkgo `[Fail]`, `FAIL(ED|URE)`, make `***`, `timed out`, `context deadline exceeded`, `exit status N`, `OOMKilled`/`CrashLoopBackOff`/`ImagePullBackOff`/`ErrImagePull`) and renders the last N matches (`<line>: <text>`, max-height + `overflow-y:auto`), so failures can be skimmed in place. "Full log" opens the complete Claude analysis + raw log in the existing modal; the icon toggles the panel closed. Real-world check: openshift/oadp-operator#2493's 115 KB e2e log yields 15 matches.

**2. Opt-in live logic updates.** New Settings toggle (`globalSettings.liveUpdates`, default off). When on, content.js asks the background worker for `https://github.tig.pw/github-bot-command-palette/logic.json` on every inject (background TTL 60s, ETag revalidation, last-known-good on failure, status recorded in `chrome.storage.local.ghbcp_live_logic_status`). `sanitizeLiveLogic` whitelists data-only fields — checks-section selector, legacy check-row selector, grep patterns (compile-checked, ≤300 chars, ≤50 entries), `maxErrorLines` clamp, optional `notes` — and the page re-renders with a toast when `version` changes. No page reload, no extension reload. Only JSON is fetched: MV3 forbids remote code, and the extension's fetch allowlists stay hardcoded in background.js.

`live/logic.json` is the source of truth; `.github/workflows/deploy-live-logic.yml` validates and publishes `live/` to GitHub Pages on push to main (prerequisite: Pages source = GitHub Actions; project pages are served under `/github-bot-command-palette/` on the `github.tig.pw` domain). Code changes in content.js/background.js still require an extension reload.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Log icon click toggles an inline, scrollable panel of grep-matched error lines (no modal detour); icon toggles it closed
- [x] #2 Panel header shows match count + failing-step label; "Full log" opens analysis + full log modal; graceful fallbacks (analysis only / no matches / load failure)
- [x] #3 `extractErrorLines` keeps the last N matches, is case-insensitive, ignores malformed patterns, truncates long lines
- [x] #4 Settings → Live updates (opt-in, default off) round-trips through config save/load and export schema
- [x] #5 Background `getLiveLogic` respects the opt-in, caches with ETag + 60s TTL, serves last-known-good on failure, records status
- [x] #6 `sanitizeLiveLogic` whitelists selectors/patterns/caps only; invalid regexes and unknown keys dropped
- [x] #7 Live selector/grep-pattern overrides applied at inject time; version change toasts and re-renders without reload
- [x] #8 `manifest.json` host permission for `github.tig.pw`; Pages deploy workflow validates logic.json and publishes live/
- [x] #9 Unit tests (extractErrorLines, sanitizeLiveLogic, handleGetLiveLogic cache/304/failure paths) + Playwright coverage of panel toggle, scrollability, Full log, and the opt-in wiring
<!-- AC:END -->
