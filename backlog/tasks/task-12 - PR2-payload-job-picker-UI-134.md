---
id: TASK-12
title: 'PR2: payload job picker UI (#134)'
status: Done
assignee:
  - '@claude'
created_date: '2026-08-02 16:34'
updated_date: '2026-08-03 16:33'
labels: []
dependencies: []
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PR 2 (depends on PR1): Payload Job Picker UI for /payload, /payload-job, /payload-aggregate per issue #134. Structured picker (version/suite/type, aggregation count) following existing Test/Override picker architecture in content.js. Own worktree branched off PR1; /coderabbit-iterate; separate PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Payload picker: release version + suite (ci/nightly) + type (blocking/informing) selection for /payload
- [x] #2 /payload-job job selection + /payload-aggregate count input supported
- [x] #3 Follows existing picker architecture
- [x] #4 Tests; coderabbit-iterate clean; PR opened referencing #134, based on PR1 branch
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Recipe (research-payload): neither existing dialog fits (#134 wants structured form: version + suite ci/nightly + type blocking/informing + aggregation count + multi-PR field). Plan: (1) hasPayloadPicker flag in cmd() factory + dispatch branch in handleCommandClick BEFORE hasJobPicker; (2) showPayloadPicker() in content.js modeled on showTestJobPicker scaffolding (.ghbcp-job-picker classes, role=dialog, aria-modal, addFocusTrap, click-outside, shouldConfirm → fillComment); (3) periodic job list via new jobSource 'payload-periodics' + release-controller API needs NEW manifest host permission https://amd64.ocp.releases.ci.openshift.org/* ; degrade to free-form input on fetch failure (fetchRepoBranches precedent); (4) persist new flag in settings.js BOTH read (274-280) and write (357-368) blocks; (5) enforce one-command-per-comment for -with-prs variants in submit handler; (6) extend tests/accessibility-attributes.test.js (it greps content.js source literally for role=dialog etc.). Sharded periodics end -<N>of<M>; base name runs all shards; /payload-aggregate does NOT expand base names.

Implemented in worktree pr2-payload-picker (branch worktree-pr2-payload-picker, stacked on PR1 branch). showPayloadPicker structured dialog: version (prefilled from detectReleaseVersions() scanning check names, datalist), suite/type selects, job/jobs field, count, PRs field per PAYLOAD_FORMS map keyed by command; single-line emission (-with-prs one-command-per-comment rule); hasPayloadPicker flag dispatched before hasJobPicker, carried through settings editor; schema v11; CSS rows; a11y test additions. 191/191. PR https://github.com/kaovilai/github-bot-command-palette/pull/138 (base = PR1 branch, retarget to main after #137 merges). Fable stand-in review running; CodeRabbit one-shot crons: 16:49 (PR1 round), 16:54 (PR2 round). Release-controller periodic-job fetch (optional part of #134) intentionally deferred — would need new host permission; noted in PR body? (not — mention in issue close/comment later).

Review loops: CodeRabbit rounds 1-2 (5 findings fixed: rendered-fields-driven submit + focus fallback, integer count guard, native required/step constraints so reportValidity speaks). Skipped CodeRabbit's DOM-harness a11y test rewrite — repo convention is source-text regex assertions in tests/accessibility-attributes.test.js; adding jsdom for one dialog is scope creep. Fable stand-in rounds found 6 more, all fixed: (1) Enter raced the version datalist commit and could post a command built from the typed prefix → Enter now advances fields, submits only from the last; (2) whitespace-only entries silently dead-ended → trimmed write-back before validation; (3) '1e3' passed as count and posted verbatim → /^\d+$/ + safe-integer with setCustomValidity message; (4) hasPayloadPicker was sticky+invisible → real settings checkbox (cmd-haspayloadpicker); (5) pattern=\S+ on version/job was INERT (nothing consulted native validity: type=button + div picker) → checkValidity() folded into submit guard; (6) oversized digit counts refused without a message → single countOk expression drives both message and guard. Final: 0323174, 191/191. CodeRabbit final round cron 4d3a0bd1 at 11:18.

Rounds 3-6 (CodeRabbit) + two more Fable passes. Fixed: PAYLOAD_FORMS resolved via hasOwnProperty (a user command named e.g. 'toString' resolved to an Object.prototype member and the field loop iterated a function); Escape/Enter now stopPropagation so neither reaches GitHub's comment form or document handlers; extracted createDialogCloser shared by all three dialogs (job picker, payload picker, input popover) — popover previously stranded focus on close; visible title on the payload picker. Fable caught the refactor's own regression: unconditional anchorBtn.focus() fought fillComment (focus left the comment textarea, so Ctrl+Enter stopped submitting) and stole the caret when clicking straight into the textarea — closer now captures activeElement BEFORE removal and only reclaims focus if it was inside the dialog or unset. Verified clean by Fable incl. cross-browser focus models. HEAD c6cf6ec, 191/191.

DELIBERATE SKIPS (recur every CodeRabbit round, do not implement): (a) rewrite tests/accessibility-attributes.test.js as a jsdom DOM harness — repo convention is source-text regex assertions, adding a dep for one dialog is scope creep; (b) redesign migrateConfig to deep-merge built-in profiles instead of refreshing from DEFAULT_CONFIG — pre-existing designed behavior and the mechanism that delivers new commands to existing users; worth a separate issue since users lose edits to built-ins on schema bumps; (c) its companion migration-preservation test. Also skipped: guarding hasPayloadPicker+hasInput both set — hasInput+hasJobPicker already overlap identically, dispatch order documents precedence.

Final CodeRabbit round cron 5bdd1e03 at 12:21.

Rounds 7-8: round 7 fixed aria-label/visible-label mismatches on the count and job fields (accessible name did not contain visible text, so speech input could not address them — WCAG 2.5.3) and canonicalized the posted run count; round 8 returned ONLY the three deliberately-skipped findings, so the CodeRabbit loop is CONVERGED. Final HEAD f86917f, 191/191. PR #138 ready for review; retarget base to main once #137 merges.

Open ask for the user (external-write approval required, blocked): (1) post the #132 close comment + open the _labels.yaml label-picker follow-up issue; (2) decide whether to file a follow-up for the migrateConfig behavior CodeRabbit flagged in 5 consecutive rounds — editing a built-in command loses the edit on the next schema bump because migration refreshes built-ins from DEFAULT_CONFIG wholesale.
<!-- SECTION:NOTES:END -->
