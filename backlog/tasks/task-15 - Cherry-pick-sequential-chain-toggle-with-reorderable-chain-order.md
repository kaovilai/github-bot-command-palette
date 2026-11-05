---
id: TASK-15
title: Cherry-pick sequential-chain toggle with reorderable chain order
status: Done
assignee:
  - '@claude'
created_date: '2026-11-05 12:15'
labels: []
dependencies: []
modified_files:
  - content.js
  - config-manager.js
  - settings.html
  - styles.css
  - README.md
  - tests/cherry-pick-chain.spec.js
  - tests/content-helpers.test.js
  - tests/config-manager.test.js
  - tests/accessibility-attributes.test.js
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Prow's `/cherry-pick` (cherrypicker external plugin) treats multiple space-separated branches as a SEQUENTIAL chain, not parallel picks. Verified in kubernetes-sigs/prow `cmd/external-plugins/cherrypicker`: `parseComment` maps each matched line to `cmds[firstToken] = restTokens` (first token = the only branch picked now, rest = chain branches), and `CreateCherrypickBody` appends `/cherrypick <rest…>` to the new PR's body, so each remaining branch hops forward one merge at a time. Multi-line comments (one `/cherry-pick` per line) are independent/parallel targets.

The extension previously exposed the two behaviors as separate buttons ('Cherry-pick...' multi-select = one command per branch, and 'Cherry-pick Chain...' = single space-joined command). This task lets the user choose per post from a single picker, and adds editable chain order.

Requested behavior: default chain order is click order; a button initiates reorder mode with grabbers to drag rows up/down.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Cherry-pick picker offers a Chain picks toggle: unchecked = one `/cherry-pick <branch>` per line (parallel), checked = one space-separated command (sequential chain)
- [x] #2 Chain order defaults to click order
- [x] #3 Reorder button in sequential mode opens an order editor with drag grabbers and ↑/↓ buttons
- [x] #4 Separate 'Cherry-pick Chain...' command merged away; schema bumped to 14 with migration coverage
- [x] #5 Unit + Playwright coverage for parallel, chain, drag-reorder, and arrow-reorder paths
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- New pure helper `buildJoinedCommandText(template, names, joinMode)` replaces the inline join logic in `showTestJobPicker` and is unit-tested directly (content-helpers.test.js extracts top-level helpers).
- New joinMode value `'choose'`: the command declares it, the picker resolves it at submit time from the Chain picks checkbox (`single-command` when checked, `''` otherwise). Other joinModes are untouched.
- `chainOrder` array is the submission order (kept in lockstep with the `selected` Set); submit uses it instead of `Set` iteration order. Drag moves DOM nodes (no re-render mid-drag), `dragend` syncs the array from the DOM; a cancelled drag (`dropEffect === 'none'`) reverts to the dragstart snapshot. ↑/↓ buttons mutate the array and re-render (touch/keyboard path), restoring focus to the moved row.
- Reorder panel and button are gated on joinMode 'choose'; `[hidden]` backed by explicit CSS rules since author display rules would otherwise beat the UA `[hidden]` rule.
- Built-in profile refresh via `migrateConfig` (schema 13 → 14) replaces the universal profile wholesale, so existing installs get the merged command automatically.
- Prow source verified at kubernetes-sigs/prow `cmd/external-plugins/cherrypicker/{server.go,lib/lib.go}` (HelpProvider text, `parseComment`, `CreateCherrypickBody`).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Single 'Cherry-pick...' picker now has a Chain picks toggle (parallel vs Prow's sequential chain) and a Reorder mode with drag grabbers plus ↑/↓ buttons; chain order defaults to click order and drives the emitted command. Schema v14 merges the old 'Cherry-pick Chain...' button; settings' joinMode dropdown gained 'Ask in picker (chain toggle)'. Proof: 310/310 unit tests (new join-mode, v13→v14 migration, and a11y assertions) and a new Playwright spec (`tests/cherry-pick-chain.spec.js`) that loads the real extension headless against the saved PR fixture and verifies four paths end-to-end: unchecked → two `/cherry-pick` lines; checked → single space-joined command; drag row above another → reversed chain; ↑/↓ button → reversed chain. Independent cross-model review found only minor issues (cancelled-drag revert, mid-drag rebuild guard, focus retention, accidental drag from arrow buttons), all fixed.
<!-- SECTION:FINAL_SUMMARY:END -->
