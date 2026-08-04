---
id: TASK-11
title: 'PR1: static command profiles (payload/verified/jira/labels/specialized)'
status: Done
assignee:
  - '@claude'
created_date: '2026-08-02 16:34'
updated_date: '2026-08-03 14:17'
labels: []
dependencies: []
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PR 1: all static commands from issues #136 (payload commands), #135 (verified), #130 (jira lifecycle), #133 (label shortcuts), #129 (specialized: /publicize openshift-priv/* only, /testwith, /validate-backports, /pipeline required). Profile entries in config-manager.js DEFAULT_CONFIG following existing cmd() patterns; own worktree; /coderabbit-iterate; separate PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Payload, Verified, Jira lifecycle, Label shortcut, Specialized command profiles/commands added
- [x] #2 Plugin map updated so filtering gates new commands correctly
- [x] #3 Schema bump delivers new built-ins to existing users
- [x] #4 Tests added; coderabbit-iterate clean; PR opened referencing #136 #135 #130 #133 #129
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Research (research-verified-jira): #135 NOT done, #130 partial (new /cherry-pick branch picker covers parallel flow; issue's /cherrypick a b c is the SERIAL chain — one line, space-joined; add second command with joinMode 'single-command'). /jira + /verified gated by external plugin name 'jira-lifecycle-plugin' (NOT 'jira' — that's the separate key-linking plugin); extractPlugins already surfaces external_plugins names. Authoritative syntax from openshift-eng/jira-lifecycle-plugin server.go: /verified by <reason> is ONE comma-delimited free-form arg (one button), /verified later <@user>, /verified bypass, /verified remove, /jira refresh, /jira cc-qa (bonus), /jira cherry-?pick OCPBUGS-N[,N], /jira backport br1,br2 (COMMA-separated). Commands must be alone on their line (anchored regex) — multi-line single comment OK.

Recipe: prow-plugin-map.js add 'jira-lifecycle-plugin': {commands: ['/jira','/verified']} (baseCmd fallback in filterCommandsByPlugins gates all subcommands; keep '/jira cherrypick' out of 'cherrypick' entry — test forbids dup); add commands to UNIVERSAL profile (not openshift/* glob — plugin filter is the scoping mechanism); one real code change: content.js:505 hardcodes names.join(' ') for single-command joinMode — add 'single-command-comma' joinMode + settings.html option for /jira backport; /verified later: put @ in placeholder not template (comma lists break @{input}); schema 9→10; update tests/config-manager.test.js + prow-plugin-map.test.js.

PAYLOAD research (research-payload): #136/#134 both greenfield (zero 'payload' matches). Authoritative syntax from docs.ci.openshift.org: /payload <ver> <ci|nightly> <informing|blocking>; /payload-job <periodic> [more...] (single-command join OK); /payload-aggregate <periodic> <count>; -with-prs variants accept ONE command per comment (default newline joinMode wrong for them); abort command is /payload-abort (issue table wrong). Jobs are PERIODICS not presubmits — use hasInput in PR1, picker is PR2. Recipe PR1: new 'profile-payload-openshift' profile (repoPatterns ['openshift/*'], enabled: true) added to BUILTIN_PROFILE_IDS + PROW_PROFILE_IDS; 7 hasInput/plain commands; prow-plugin-map entry 'payload-testing-prow-plugin' with all 7 commands (external plugin, Method 3 already detects); README built-in profiles table row; schema→10 (single bump shared with jira/verified changes); tests near config-manager.test.js:1171. Note: unmapped commands always KEPT by filter — plugin-map entry required for gating. settings.js editor drops expandRehearsalJobs on edit (known gap) — any new boolean flag must be added to settings.js read+write blocks.

LABELS/SPECIALIZED research (research-labels-special): #133/#129 NOT done. CONFIRMED live: org-level _pluginconfig.yaml carries external_plugins (openshift: backport-verifier, pipeline-controller, multi-pr-prow-plugin, jira-lifecycle-plugin, payload-testing-prow-plugin, cherrypick...; openshift-priv adds publicize); repo-level openshift/oadp-operator has NONE → extractOrgPlugins MUST gain Method-3 external_plugins parsing (mirror background.js:312-320) or all newly mapped buttons vanish in filter mode; also fixes existing /cherry-pick bug on openshift/*. Syntax: /publicize (no args, merged PRs, openshift-priv only, requireConfirm); /testwith org/repo/branch/test + ≥1 PR ref REQUIRED; /testwith abort; /validate-backports (no args); /pipeline required (+/pipeline auto bonus). Map bare '/pipeline' (baseCmd fallback); don't list '/testwith abort' separately (dup test). New plugin-map entries: publicize, multi-pr-prow-plugin, backport-verifier, pipeline-controller. #133: 10 label buttons in new profile-openshift-labels (openshift/* + openshift-priv/*), style neutral (= outline look, no CSS change); /label already mapped → no map change; restricted labels (cherry-pick-approved, backport-risk-assessed, staff-eng-approved, jira/skip-dependent-bug-check) note team-gating in tooltip. #129: two profiles — profile-openshift-priv (publicize) + profile-openshift-specialized (testwith/validate-backports/pipeline). Don't touch knownPlugins arrays (different code path). Single schema bump 9→10 for whole PR1.

PR https://github.com/kaovilai/github-bot-command-palette/pull/137 opened from branch worktree-pr1-static-commands (6 commits, 190/190 tests). CodeRabbit rounds 1-4 fixed; round 5 rate-limited (45 min) — one-shot cron aa3fc5d1 fires 16:49 local to run final round. Fable stand-in review found + fixed 2 real Prow-semantics bugs (external_plugins union, excluded_repos scope) and confirmed clean on re-review. AC#4 pending final CodeRabbit clean round.

CodeRabbit final round (round 6, after rate-limit reset + one timeout retry): 0 findings across all 9 reviewed files — loop converged. PR #137 ready for review/merge.
<!-- SECTION:NOTES:END -->
