---
id: TASK-6
title: >-
  Fix /test button falling back to raw check context when no presubmit source
  configured
status: Done
assignee:
  - '@claude'
created_date: '2026-07-29 23:57'
updated_date: '2026-07-29 23:59'
labels: []
dependencies: []
modified_files:
  - background.js
  - config-manager.js
  - tests/background.test.js
  - tests/config-manager.test.js
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On migtools/kubevirt-datamover-plugin#38 the Test button next to the failed `ci/prow/images` check produced `/test ci/prow/images` instead of `/test images`.

Root cause: `handleGetPresubmitJobs` (background.js:360) requires a `pluginConfigSources` entry with `presubmitsBasePath`. DEFAULT_CONFIG ships `pluginConfigSources: []`, `presubmitsBasePath` only exists in PRESET_SOURCES, and `migrateConfig` never backfills sources — so users with older/empty configs get `{jobs: null}` and content.js:1030 falls back to the raw check name.

Fix:
1. Backfill `presubmitsBasePath: 'ci-operator/jobs'` for stored openshift/release sources missing it (migration, schema bump).
2. When no configured source has `presubmitsBasePath`, fall back to the OpenShift preset (openshift/release, ci-operator/jobs) for presubmit rerun_command lookup so the /test target always comes from openshift/release config. Applies to check-row Test buttons and job picker (all consumers of lastPresubmitJobs).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Test button on a Prow check row posts the bare rerun_command target (e.g. /test images) even when user config has no pluginConfigSources
- [x] #2 Stored openshift/release sources missing presubmitsBasePath are backfilled on migration
- [x] #3 Existing tests pass; new coverage for fallback + backfill
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause: handleGetPresubmitJobs required an enabled pluginConfigSources entry with presubmitsBasePath; DEFAULT_CONFIG ships pluginConfigSources: [] and the field only existed in PRESET_SOURCES, so lookups returned {jobs: null} and content.js fell back to the raw check context (ci/prow/images).

Changes:
- background.js: added DEFAULT_PRESUBMIT_SOURCE (openshift/release, master, ci-operator/jobs) and resolvePresubmitSource(config); handleGetPresubmitJobs now falls back to it when no configured source qualifies. Non-OpenShift repos 404 harmlessly (cached).
- config-manager.js: SCHEMA_VERSION 6→7; migrateConfig backfills presubmitsBasePath='ci-operator/jobs' on stored openshift/release sources missing it (does not overwrite custom values).
- tests: 4 new resolvePresubmitSource tests (background.test.js), 2 new migration backfill tests (config-manager.test.js). 166/166 pass.

Verified against real data: openshift/release migtools-kubevirt-datamover-plugin-oadp-1.6-presubmits.yaml has context ci/prow/images with rerun_command /test images; match on context yields /test images.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Test buttons now always derive the /test target from openshift/release Prow config. When no plugin source with presubmitsBasePath is configured, background falls back to a built-in openshift/release source; migration (schema v7) backfills presubmitsBasePath on stored openshift/release sources. Fixes /test ci/prow/images → /test images on check rows and the job picker.
<!-- SECTION:FINAL_SUMMARY:END -->
