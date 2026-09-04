// GitHub Bot Command Palette — Configuration Manager
const GHBCP = window.GHBCP || {};
window.GHBCP = GHBCP;

GHBCP.addTapListener = function addTapListener(el, handler) {
  let swallowClickUntil = 0;
  const activatePointer = (e) => {
    if (typeof e.button === 'number' && e.button > 0) return;
    e.preventDefault();
    e.stopPropagation();
    swallowClickUntil = Date.now() + 700;
    handler(e);
  };
  const activateClick = (e) => {
    if (typeof e.button === 'number' && e.button > 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (Date.now() < swallowClickUntil) return;
    handler(e);
  };
  if (typeof PointerEvent === 'function') {
    el.addEventListener('pointerup', activatePointer);
  } else {
    el.addEventListener('touchend', activatePointer);
  }
  el.addEventListener('click', activateClick);
};

GHBCP.ConfigManager = (() => {
  const STORAGE_KEY = 'ghbcp_config';
  // chrome.storage.sync enforces QUOTA_BYTES_PER_ITEM (8192 bytes, counted as
  // key length + JSON-serialized value length). The full default config already
  // serializes to ~12KB, so writing it as a single item fails with
  // "Resource::kQuotaBytesPerItem quota exceeded". Larger configs are therefore
  // split across several items: CHUNK_META_KEY records how many chunks exist and
  // CHUNK_KEY_PREFIX + i holds each slice of the serialized JSON.
  const CHUNK_META_KEY = 'ghbcp_config_meta';
  const CHUNK_KEY_PREFIX = 'ghbcp_config_chunk_';
  // Conservative slice size: JSON-escaping can nearly double a chunk containing
  // mostly quotes, so 3000 chars stays well under the 8192-byte item limit.
  const MAX_CHUNK_CHARS = 3000;
  // Leaves headroom under the 8192-byte per-item limit for the single-item path.
  const MAX_SINGLE_ITEM_CHARS = 7000;
  const SCHEMA_VERSION = 13;
  const BUILTIN_PROFILE_IDS = new Set([
    'profile-tide-prow-universal',
    'profile-prow-openshift-release',
    'profile-payload-openshift',
    'profile-openshift-labels',
    'profile-openshift-priv',
    'profile-openshift-specialized',
    'profile-velero-backport',
    'profile-mergify',
    'profile-changesets',
    'profile-dependabot',
    'profile-claude',
    'profile-coderabbitai'
  ]);
  const PROW_PROFILE_IDS = new Set([
    'profile-tide-prow-universal',
    'profile-prow-openshift-release',
    'profile-payload-openshift',
    'profile-openshift-labels',
    'profile-openshift-priv',
    'profile-openshift-specialized'
  ]);

  function isProwProfile(profileId) {
    return PROW_PROFILE_IDS.has(profileId);
  }

  /** @returns {string} A new RFC-4122 v4 UUID string. */
  function generateId() {
    return crypto.randomUUID ? crypto.randomUUID() :
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
  }

  /**
   * Build a command object with sensible defaults.
   * @param {string} label   - Display label shown on the button.
   * @param {string} command - Slash command text (e.g. `/lgtm`).
   * @param {string} style   - Visual style key: `success|danger|warning|primary|neutral`.
   * @param {Object} [opts]  - Optional overrides (description, shortcut, hasInput, etc.).
   * @returns {Object} A fully-populated command descriptor.
   */
  function cmd(label, command, style, opts = {}) {
    return {
      id: generateId(),
      label,
      command,
      description: opts.description || command,
      style: style || 'neutral',
      requireConfirm: opts.requireConfirm || false,
      hasInput: opts.hasInput || false,
      hasJobPicker: opts.hasJobPicker || false,
      hasPayloadPicker: opts.hasPayloadPicker || false,
      jobPickerFilter: opts.jobPickerFilter || 'all',
      jobSource: opts.jobSource || '',
      joinMode: opts.joinMode || '',
      expandRehearsalJobs: opts.expandRehearsalJobs || false,
      inputPlaceholder: opts.inputPlaceholder || '',
      commandTemplate: opts.commandTemplate || '',
      shortcut: opts.shortcut || ''
    };
  }

  const DEFAULT_CONFIG = {
    version: SCHEMA_VERSION,
    profiles: [
      {
        id: 'profile-tide-prow-universal',
        name: 'Tide/Prow — Universal',
        description: 'Common Prow/Tide slash commands for any repo',
        enabled: true,
        repoPatterns: ['*'],
        globalCommands: [
          cmd('LGTM', '/lgtm', 'success', { shortcut: 'Alt+L', description: 'Looks good to me' }),
          cmd('Cancel LGTM', '/lgtm cancel', 'danger', { description: 'Cancel LGTM' }),
          cmd('Approve', '/approve', 'success', { shortcut: 'Alt+A', description: 'Approve PR' }),
          cmd('Cancel Approve', '/approve cancel', 'danger', { description: 'Cancel approval' }),
          cmd('Hold', '/hold', 'warning', { description: 'Place hold on PR' }),
          cmd('Cancel Hold', '/hold cancel', 'neutral', { description: 'Remove hold' }),
          cmd('Retest', '/retest', 'primary', { shortcut: 'Alt+R', description: 'Retest all failed tests' }),
          cmd('Retest Required', '/retest-required', 'primary', { description: 'Retest required tests' }),
          cmd('Test...', '/test', 'primary', { hasJobPicker: true, commandTemplate: '/test {input}', description: 'Trigger a specific CI job', shortcut: 'Alt+T' }),
          cmd('Override...', '/override', 'warning', { hasJobPicker: true, jobPickerFilter: 'failed', commandTemplate: '/override "{input}"', description: 'Override a failed CI check', shortcut: 'Alt+O' }),
          cmd('Cherry-pick...', '/cherry-pick', 'neutral', { hasJobPicker: true, jobSource: 'branches', commandTemplate: '/cherry-pick {input}', inputPlaceholder: 'target branch', description: 'Cherry-pick this PR to selected branches' }),
          cmd('CC User', '/cc', 'neutral', { hasInput: true, inputPlaceholder: 'username', commandTemplate: '/cc @{input}', description: 'CC a user' }),
          cmd('UnCC User', '/uncc', 'neutral', { hasInput: true, inputPlaceholder: 'username', commandTemplate: '/uncc @{input}', description: 'Remove CC' }),
          cmd('OK to Test', '/ok-to-test', 'success', { description: 'Allow CI testing for external contributors' }),
          // jira-lifecycle-plugin commands (plugin filtering hides these where
          // the external plugin is not enabled)
          cmd('Verified By...', '/verified by', 'success', { hasInput: true, inputPlaceholder: 'test name, user, or job (comma-separated)', commandTemplate: '/verified by {input}', description: 'Cite pre-merge verification (test, person, or Prow job)' }),
          cmd('Verified Later...', '/verified later', 'warning', { hasInput: true, inputPlaceholder: '@username (comma-separated)', commandTemplate: '/verified later {input}', description: 'Post-merge verification will be performed by named user(s)' }),
          cmd('Verified Bypass', '/verified bypass', 'warning', { requireConfirm: true, description: 'Assert change is non-functional; no testing needed' }),
          cmd('Verified Remove', '/verified remove', 'danger', { description: 'Remove verified/verified-later labels' }),
          cmd('Jira Refresh', '/jira refresh', 'neutral', { description: 'Resync Jira validation status on this PR' }),
          cmd('Jira Backport...', '/jira backport', 'primary', { hasJobPicker: true, jobSource: 'branches', joinMode: 'single-command-comma', commandTemplate: '/jira backport {input}', inputPlaceholder: 'branch1,branch2', description: 'Create backport Jira issues + queue cherry-picks (comma-separated branches)' }),
          cmd('Jira Cherry-pick...', '/jira cherrypick', 'neutral', { hasInput: true, inputPlaceholder: 'OCPBUGS-1234', commandTemplate: '/jira cherrypick {input}', description: 'Clone a Jira bug onto this manually-created cherry-pick PR' }),
          cmd('Cherry-pick Chain...', '/cherrypick', 'neutral', { hasJobPicker: true, jobSource: 'branches', joinMode: 'single-command', commandTemplate: '/cherrypick {input}', inputPlaceholder: 'branch1 branch2', description: 'Serial cherry-pick chain: first branch now, remaining branches hop after each merge' })
        ],
        checkCommands: [
          cmd('Retest This', '/retest', 'primary', { description: 'Retest this specific check' })
        ],
        dynamicCommands: []
      },
      {
        id: 'profile-prow-openshift-release',
        name: 'Prow — OpenShift Release',
        description: 'Extra commands for openshift/release repo (pj-rehearse)',
        enabled: true,
        repoPatterns: ['openshift/release'],
        globalCommands: [
          cmd('Rehearse ACK', '/pj-rehearse ack', 'warning', { requireConfirm: true, description: 'Acknowledge rehearsal' }),
          cmd('Rehearse...', '/pj-rehearse', 'primary', { hasJobPicker: true, jobSource: 'rehearsals', joinMode: 'single-command', commandTemplate: '/pj-rehearse {input}', description: 'Rehearse specific tests from REHEARSALNOTIFIER' }),
          cmd('Rehearse All', '/pj-rehearse', 'primary', { expandRehearsalJobs: true, requireConfirm: true, description: 'Rehearse all affected jobs, listing each one explicitly' })
        ],
        checkCommands: [],
        dynamicCommands: []
      },
      {
        id: 'profile-payload-openshift',
        name: 'OpenShift Payload Testing',
        description: 'Release payload testing commands (payload-testing-prow-plugin)',
        enabled: true,
        repoPatterns: ['openshift/*'],
        globalCommands: [
          cmd('Payload...', '/payload', 'primary', { hasPayloadPicker: true, description: 'Test PR against a payload: <version> <ci|nightly> <informing|blocking>' }),
          cmd('Payload Job...', '/payload-job', 'primary', { hasPayloadPicker: true, description: 'Run specific release-controller periodic job(s) against this PR' }),
          cmd('Payload Aggregate...', '/payload-aggregate', 'primary', { hasPayloadPicker: true, description: 'Run a periodic job N times for flake detection: <job> <count>' }),
          cmd('Payload w/ PRs...', '/payload-with-prs', 'neutral', { hasPayloadPicker: true, description: 'Payload test combining changes from additional PRs (one command per comment)' }),
          cmd('Payload Job w/ PRs...', '/payload-job-with-prs', 'neutral', { hasPayloadPicker: true, description: 'Specific job with changes from additional PRs (one command per comment)' }),
          cmd('Payload Aggregate w/ PRs...', '/payload-aggregate-with-prs', 'neutral', { hasPayloadPicker: true, description: 'Aggregate run with changes from additional PRs (one command per comment)' }),
          cmd('Abort Payload', '/payload-abort', 'danger', { requireConfirm: true, description: 'Cancel all running payload jobs for this PR' })
        ],
        checkCommands: [],
        dynamicCommands: []
      },
      {
        id: 'profile-openshift-labels',
        name: 'OpenShift Labels',
        description: 'One-click /label shortcuts for common OpenShift gating labels',
        enabled: true,
        repoPatterns: ['openshift/*', 'openshift-priv/*'],
        globalCommands: [
          cmd('cherry-pick-approved', '/label cherry-pick-approved', 'neutral', { description: 'QE/Staff Eng approval for backport merge (restricted: patch managers only)' }),
          cmd('backport-risk-assessed', '/label backport-risk-assessed', 'neutral', { description: 'Backport risk evaluated (restricted: sustaining engineers only)' }),
          cmd('qe-approved', '/label qe-approved', 'neutral', { description: 'QE sign-off' }),
          cmd('docs-approved', '/label docs-approved', 'neutral', { description: 'Documentation team sign-off' }),
          cmd('px-approved', '/label px-approved', 'neutral', { description: 'Product Support sign-off' }),
          cmd('staff-eng-approved', '/label staff-eng-approved', 'neutral', { description: 'Staff Engineer approval (restricted: staff engineers only)' }),
          cmd('Squash Merge', '/label tide/merge-method-squash', 'neutral', { description: 'Force squash merge via Tide' }),
          cmd('Merge Commit', '/label tide/merge-method-merge', 'neutral', { description: 'Force merge commit via Tide' }),
          cmd('Rebase Merge', '/label tide/merge-method-rebase', 'neutral', { description: 'Force rebase merge via Tide' }),
          cmd('skip-dependent-bug-check', '/label jira/skip-dependent-bug-check', 'neutral', { description: 'Skip dependent bug validation (restricted: release oversight only)' })
        ],
        checkCommands: [],
        dynamicCommands: []
      },
      {
        id: 'profile-openshift-priv',
        name: 'OpenShift Private (embargoed CVE)',
        description: 'Commands for openshift-priv repos',
        enabled: true,
        repoPatterns: ['openshift-priv/*'],
        globalCommands: [
          cmd('Publicize', '/publicize', 'warning', { requireConfirm: true, description: 'Merge commit history to the public upstream repo (merged PRs only, irreversible)' })
        ],
        checkCommands: [],
        dynamicCommands: []
      },
      {
        id: 'profile-openshift-specialized',
        name: 'OpenShift Specialized',
        description: 'Multi-PR testing, backport validation, gated pipelines',
        enabled: true,
        repoPatterns: ['openshift/*'],
        globalCommands: [
          cmd('Test With...', '/testwith', 'primary', { hasInput: true, inputPlaceholder: 'org/repo/branch/test org/repo#123 [more PRs]', commandTemplate: '/testwith {input}', description: 'Run a test with source built from this PR plus additional PRs (at least one PR required)' }),
          cmd('Abort Testwith', '/testwith abort', 'danger', { requireConfirm: true, description: 'Abort in-flight /testwith jobs' }),
          cmd('Validate Backports', '/validate-backports', 'primary', { description: 'Re-evaluate backports/unvalidated-commits check' }),
          cmd('Pipeline Required', '/pipeline required', 'primary', { description: 'Trigger all required second-stage gated jobs' })
        ],
        checkCommands: [],
        dynamicCommands: []
      },
      {
        id: 'profile-velero-backport',
        name: 'Velero — Backport',
        description: 'Backport merged PRs to release branches (korthout/backport-action)',
        enabled: true,
        repoPatterns: ['velero-io/velero'],
        globalCommands: [
          cmd('Backport...', '/backport', 'neutral', { hasJobPicker: true, jobSource: 'branches', joinMode: 'single-command', commandTemplate: '/backport {input}', inputPlaceholder: 'release-1.17 release-1.18', description: 'Backport this merged PR to target branch(es); bare X.Y shorthand expands to release-X.Y' })
        ],
        checkCommands: [],
        dynamicCommands: []
      },
      {
        id: 'profile-mergify',
        name: 'Mergify',
        description: 'Mergify bot commands',
        enabled: false,
        repoPatterns: ['*'],
        globalCommands: [
          cmd('Requeue', '/mergify requeue', 'primary', { description: 'Requeue in merge queue' }),
          cmd('Refresh', '/mergify refresh', 'neutral', { description: 'Refresh Mergify status' })
        ],
        checkCommands: [],
        dynamicCommands: []
      },
      {
        id: 'profile-changesets',
        name: 'Changesets Bot',
        description: 'Changesets bot commands',
        enabled: false,
        repoPatterns: ['*'],
        globalCommands: [
          cmd('Changeset', '/changeset', 'primary', { hasInput: true, inputPlaceholder: 'patch|minor|major', commandTemplate: '/changeset {input}', description: 'Create changeset' })
        ],
        checkCommands: [],
        dynamicCommands: []
      },
      {
        id: 'profile-dependabot',
        name: 'Dependabot',
        description: 'GitHub Dependabot dependency update commands',
        enabled: false,
        repoPatterns: ['*'],
        globalCommands: [
          cmd('Rebase', '@dependabot rebase', 'primary', { description: 'Rebase this PR' }),
          cmd('Recreate', '@dependabot recreate', 'warning', { description: 'Close and recreate this PR' }),
          cmd('Merge', '@dependabot merge', 'success', { description: 'Merge after CI passes' }),
          cmd('Squash & Merge', '@dependabot squash and merge', 'success', { description: 'Squash and merge after CI passes' }),
          cmd('Cancel Merge', '@dependabot cancel merge', 'danger', { description: 'Cancel a pending merge' }),
          cmd('Reopen', '@dependabot reopen', 'primary', { description: 'Reopen a closed PR' }),
          cmd('Close', '@dependabot close', 'danger', { description: 'Close this PR' }),
          cmd('Ignore Major', '@dependabot ignore this major version', 'warning', { requireConfirm: true, description: 'Ignore this major version' }),
          cmd('Ignore Minor', '@dependabot ignore this minor version', 'warning', { requireConfirm: true, description: 'Ignore this minor version' }),
          cmd('Ignore Dependency', '@dependabot ignore this dependency', 'danger', { requireConfirm: true, description: 'Ignore this dependency entirely' })
        ],
        checkCommands: [],
        dynamicCommands: []
      },
      {
        id: 'profile-claude',
        name: 'Claude',
        description: 'Claude Code AI assistant commands',
        enabled: false,
        repoPatterns: ['*'],
        globalCommands: [
          cmd('Ask Claude...', '@claude', 'primary', { hasInput: true, inputPlaceholder: 'instruction', commandTemplate: '@claude {input}', description: 'Ask Claude a free-form question or instruction' }),
          cmd('Review PR', '@claude review this PR', 'primary', { description: 'Ask Claude to review this PR' }),
          cmd('Fix This', '@claude fix this', 'warning', { description: 'Ask Claude to fix issues' }),
          cmd('Implement...', '@claude implement', 'primary', { hasInput: true, inputPlaceholder: 'description', commandTemplate: '@claude implement {input}', description: 'Ask Claude to implement something' })
        ],
        checkCommands: [],
        dynamicCommands: []
      },
      {
        id: 'profile-coderabbitai',
        name: 'CodeRabbit AI',
        description: 'CodeRabbit AI code review bot commands',
        enabled: false,
        repoPatterns: ['*'],
        globalCommands: [
          cmd('Full Review', '@coderabbitai full review', 'primary', { description: 'Request a full code review' }),
          cmd('Review', '@coderabbitai review', 'primary', { description: 'Request an incremental review' }),
          cmd('Summary', '@coderabbitai summary', 'neutral', { description: 'Generate PR summary' }),
          cmd('Docstrings', '@coderabbitai generate docstrings', 'neutral', { description: 'Generate docstrings for changes' }),
          cmd('Resolve', '@coderabbitai resolve', 'success', { description: 'Resolve all CodeRabbit comments' }),
          cmd('Pause', '@coderabbitai pause', 'warning', { description: 'Pause reviews on this PR' }),
          cmd('Resume', '@coderabbitai resume', 'primary', { description: 'Resume reviews on this PR' }),
          cmd('Help', '@coderabbitai help', 'neutral', { description: 'Show CodeRabbit help' })
        ],
        checkCommands: [],
        dynamicCommands: []
      }
    ],
    repoOverrides: [],
    pluginConfigSources: [],
    globalSettings: {
      enabled: true,
      buttonPosition: 'above-comment-box',
      theme: 'auto',
      confirmBeforePost: false,
      showOnlyFailedTests: true,
      autoSubmit: false,
      pluginFilterMode: 'filter',
      excludedRepos: [],
      prowAutoDetect: true
    }
  };

  const PRESET_SOURCES = [
    {
      name: 'OpenShift CI (openshift/release)',
      format: 'sharded',
      configRepo: 'openshift/release',
      branch: 'master',
      pathTemplate: 'core-services/prow/02_config',
      filePath: '',
      presubmitsBasePath: 'ci-operator/jobs',
      cacheTTLMinutes: 60
    },
    {
      name: 'Kubernetes (kubernetes/test-infra)',
      format: 'monolithic',
      configRepo: 'kubernetes/test-infra',
      branch: 'master',
      pathTemplate: '',
      filePath: 'config/prow/plugins.yaml',
      cacheTTLMinutes: 120
    }
  ];

  /**
   * Return true if the Chrome extension context is still valid (not invalidated).
   * Must be called before any chrome.* API use to avoid "Extension context invalidated" errors.
   * @returns {boolean}
   */
  function isContextValid() {
    try { return !!chrome.runtime.id; } catch (e) { return false; }
  }

  /**
   * Match `str` against a simple glob pattern where `*` is a wildcard.
   * @param {string} pattern - Glob pattern (e.g. `*`, `org/*`, `org/repo`).
   * @param {string} str     - String to test (e.g. `org/repo`).
   * @returns {boolean}
   */
  function globMatch(pattern, str) {
    if (pattern === '*') return true;
    // Escape regex special chars that aren't glob wildcards, then map glob
    // wildcards to their regex equivalents: * → .* (any sequence), ? → . (any char).
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\?/g, '.')
      .replace(/\*/g, '.*');
    const regex = new RegExp('^' + escaped + '$');
    return regex.test(str);
  }

  // GitHub Actions triggering events that can be appended to a check name in
  // the Checks UI to disambiguate a job that runs on multiple events, e.g.
  // "Lint / Lint (ubuntu-latest) (pull_request)". These are stripped from the
  // /override context because Prow/tide only see the underlying status context.
  const GITHUB_ACTIONS_EVENTS = new Set([
    'branch_protection_rule', 'check_run', 'check_suite', 'create', 'delete',
    'deployment', 'deployment_status', 'discussion', 'discussion_comment',
    'fork', 'gollum', 'issue_comment', 'issues', 'label', 'merge_group',
    'milestone', 'page_build', 'public', 'pull_request', 'pull_request_review',
    'pull_request_review_comment', 'pull_request_target', 'push',
    'registry_package', 'release', 'repository_dispatch', 'schedule', 'status',
    'watch', 'workflow_call', 'workflow_dispatch', 'workflow_run'
  ]);

  /**
   * Convert a CI check name as displayed in GitHub's Checks UI into the status
   * context that Prow's `/override` command expects.
   *
   * GitHub Actions renders a check as "{workflow name} / {job name}" and, when
   * the workflow is triggered by more than one event, appends the triggering
   * event: "{workflow name} / {job name} ({event})". Prow/tide, however, only
   * see the underlying status context — the job name alone, without the
   * workflow-name prefix or the event suffix. For example the UI label
   * "Lint / Lint (ubuntu-latest) (pull_request)" maps to the context
   * "Lint (ubuntu-latest)".
   *
   * Non-Actions contexts (e.g. Prow's own "ci/prow/e2e" or "tide", which use
   * "/" without surrounding spaces) are returned unchanged.
   * @param {string} checkName - The check name scraped from the PR page.
   * @returns {string} The context to pass to `/override`.
   */
  function getOverrideContext(checkName) {
    if (typeof checkName !== 'string') return '';
    let name = checkName.trim();

    // Strip a trailing " (event)" suffix only when the parenthesised token is a
    // known GitHub Actions event, so matrix values like "(ubuntu-latest)" are
    // left intact. GitHub joins the event with a single space; matching one
    // literal space (rather than \s+) keeps this linear-time.
    const eventMatch = name.match(/ \(([a-z_]+)\)$/);
    if (eventMatch && GITHUB_ACTIONS_EVENTS.has(eventMatch[1])) {
      name = name.slice(0, eventMatch.index).trimEnd();
    }

    // Strip the leading "{workflow name} / " prefix. GitHub joins the workflow
    // name and job name with " / " (spaces around the slash); Prow contexts
    // such as "ci/prow/e2e" use "/" without spaces and are left untouched.
    const sep = name.indexOf(' / ');
    if (sep !== -1) {
      name = name.slice(sep + 3).trim();
    }

    return name;
  }

  function isRepoExcluded(config, repoFullName) {
    const excluded = config.globalSettings && config.globalSettings.excludedRepos;
    if (!excluded || excluded.length === 0) return false;
    return excluded.some(pat => globMatch(pat, repoFullName));
  }

  /**
   * Migrate a stored config object to the current schema version.
   * Refreshes built-in profiles from DEFAULT_CONFIG while preserving user's `enabled` state,
   * and appends any new built-in profiles not yet in the stored config.
   * @param {Object} config - Stored config object (mutated in place).
   * @returns {Object} The mutated config with `version` bumped and `_migrated: true`.
   */
  function migrateConfig(config) {
    if (config.version >= SCHEMA_VERSION) return config;
    const defaults = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const defaultMap = new Map(defaults.profiles.map(p => [p.id, p]));
    for (let i = 0; i < config.profiles.length; i++) {
      const p = config.profiles[i];
      if (BUILTIN_PROFILE_IDS.has(p.id) && defaultMap.has(p.id)) {
        const updated = defaultMap.get(p.id);
        updated.enabled = p.enabled;
        config.profiles[i] = updated;
      }
    }
    for (const [id, dp] of defaultMap) {
      if (!config.profiles.some(p => p.id === id)) {
        config.profiles.push(dp);
      }
    }
    if (!config.globalSettings.excludedRepos) config.globalSettings.excludedRepos = [];
    if (config.globalSettings.prowAutoDetect === undefined) config.globalSettings.prowAutoDetect = true;
    // Sources saved before presubmitsBasePath existed can't resolve /test
    // rerun_command targets; backfill the known path for openshift/release.
    for (const src of (config.pluginConfigSources || [])) {
      if (src.configRepo === 'openshift/release' && !src.presubmitsBasePath) {
        src.presubmitsBasePath = 'ci-operator/jobs';
      }
    }
    config.version = SCHEMA_VERSION;
    config._migrated = true;
    return config;
  }

  /**
   * Load the stored config, applying schema migration if necessary.
   * Falls back to a deep copy of DEFAULT_CONFIG when storage is unavailable.
   * @returns {Promise<Object>} Resolved configuration object.
   */
  /**
   * Read the raw stored config, transparently reassembling a chunked config
   * written by `saveConfig` when it was too large for a single sync item.
   * @returns {Promise<Object|null>} Stored config object, or null if absent/unreadable.
   */
  function readStoredConfig() {
    return new Promise(resolve => {
      chrome.storage.sync.get([STORAGE_KEY, CHUNK_META_KEY], metaResult => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        const meta = metaResult && metaResult[CHUNK_META_KEY];
        const chunkCount = meta && typeof meta.chunks === 'number' ? meta.chunks : 0;
        if (chunkCount <= 0) {
          resolve((metaResult && metaResult[STORAGE_KEY]) || null);
          return;
        }
        const keys = [];
        for (let i = 0; i < chunkCount; i++) keys.push(CHUNK_KEY_PREFIX + i);
        chrome.storage.sync.get(keys, chunkResult => {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          let json = '';
          for (const key of keys) {
            const part = chunkResult && chunkResult[key];
            if (typeof part !== 'string') {
              // Incomplete chunk set — fall back to any legacy single-item copy.
              resolve((metaResult && metaResult[STORAGE_KEY]) || null);
              return;
            }
            json += part;
          }
          try {
            resolve(JSON.parse(json));
          } catch (e) {
            resolve((metaResult && metaResult[STORAGE_KEY]) || null);
          }
        });
      });
    });
  }

  async function getConfig() {
    if (!isContextValid()) return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    return new Promise(resolve => {
      try {
        readStoredConfig().then(async stored => {
          let config = stored || JSON.parse(JSON.stringify(DEFAULT_CONFIG));
          // Defensive: fill in missing top-level keys so callers never crash on
          // partial or manually-edited stored configs.
          if (!config.globalSettings) config.globalSettings = JSON.parse(JSON.stringify(DEFAULT_CONFIG.globalSettings));
          // Fill in individual missing globalSettings keys so users upgrading from older
          // configs get correct defaults rather than undefined (which can fall back to
          // the wrong value at each call-site, e.g. pluginFilterMode → 'disabled'
          // instead of the intended 'filter').
          else {
            const gsDefaults = DEFAULT_CONFIG.globalSettings;
            for (const key of Object.keys(gsDefaults)) {
              if (!(key in config.globalSettings)) {
                config.globalSettings[key] = gsDefaults[key];
              }
            }
          }
          if (!config.repoOverrides) config.repoOverrides = [];
          if (!config.pluginConfigSources) config.pluginConfigSources = [];
          if (!config.profiles) config.profiles = [];
          if (!config.version || config.version < SCHEMA_VERSION) {
            config = migrateConfig(config);
            // Save without the transient _migrated flag so the toast only shows once.
            const toSave = Object.assign({}, config);
            delete toSave._migrated;
            try { await saveConfig(toSave); } catch (e) { /* best effort */ }
          }
          resolve(config);
        }).catch(() => resolve(JSON.parse(JSON.stringify(DEFAULT_CONFIG))));
      } catch (e) {
        resolve(JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
      }
    });
  }

  /**
   * Persist `config` to `chrome.storage.sync`.
   *
   * Configs that serialize to more than a single sync item can hold are split
   * into `ghbcp_config_chunk_*` items (see CHUNK_META_KEY), avoiding the
   * "Resource::kQuotaBytesPerItem quota exceeded" failure. Stale keys from the
   * other layout are removed after a successful write so reads stay unambiguous.
   * @param {Object} config - The configuration object to save.
   * @returns {Promise<void>} Rejects if storage write fails.
   */
  async function saveConfig(config) {
    if (!isContextValid()) return;
    return new Promise((resolve, reject) => {
      try {
        const json = JSON.stringify(config);
        const fitsInOneItem = STORAGE_KEY.length + json.length <= MAX_SINGLE_ITEM_CHARS;
        const items = {};
        const staleKeys = [];
        if (fitsInOneItem) {
          items[STORAGE_KEY] = config;
        } else {
          const chunks = [];
          for (let i = 0; i < json.length; i += MAX_CHUNK_CHARS) {
            chunks.push(json.slice(i, i + MAX_CHUNK_CHARS));
          }
          chunks.forEach((chunk, i) => { items[CHUNK_KEY_PREFIX + i] = chunk; });
          items[CHUNK_META_KEY] = { chunks: chunks.length };
          staleKeys.push(STORAGE_KEY);
        }
        chrome.storage.sync.set(items, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
            return;
          }
          cleanupStaleKeys(fitsInOneItem, staleKeys).then(resolve, resolve);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Best-effort removal of storage keys left over from the layout not used by
   * the write that just succeeded (single item vs. chunked).
   * @param {boolean} fitsInOneItem - Whether the config was written as one item.
   * @param {string[]} staleKeys    - Keys known to be stale before enumeration.
   * @returns {Promise<void>} Always resolves; removal failures are ignored.
   */
  function cleanupStaleKeys(fitsInOneItem, staleKeys) {
    return new Promise(resolve => {
      try {
        if (!chrome.storage.sync.get || !chrome.storage.sync.remove) {
          resolve();
          return;
        }
        chrome.storage.sync.get(null, all => {
          if (chrome.runtime.lastError || !all) {
            resolve();
            return;
          }
          const keys = staleKeys.slice();
          const chunkCount = fitsInOneItem
            ? 0
            : (all[CHUNK_META_KEY] && all[CHUNK_META_KEY].chunks) || 0;
          for (const key of Object.keys(all)) {
            if (key === CHUNK_META_KEY) {
              if (fitsInOneItem) keys.push(key);
            } else if (key.startsWith(CHUNK_KEY_PREFIX)) {
              const index = Number(key.slice(CHUNK_KEY_PREFIX.length));
              if (fitsInOneItem || !(index >= 0 && index < chunkCount)) keys.push(key);
            }
          }
          if (!keys.length) {
            resolve();
            return;
          }
          chrome.storage.sync.remove(keys, () => {
            void chrome.runtime.lastError;
            resolve();
          });
        });
      } catch (e) {
        resolve();
      }
    });
  }

  const GITHUB_TOKEN_STORAGE_KEY = 'ghbcp_github_token';

  /**
   * Read the user's GitHub Personal Access Token, used to call the real
   * GitHub Actions rerun API for checks Prow doesn't own. Deliberately kept
   * in `chrome.storage.local` (device-scoped) instead of the synced
   * `chrome.storage.sync` config blob — a PAT shouldn't silently propagate
   * to every Chrome profile signed into the same Google account.
   * @returns {Promise<string|null>} The stored token, or null if unset/unavailable.
   */
  async function getGithubToken() {
    if (!isContextValid()) return null;
    return new Promise(resolve => {
      try {
        chrome.storage.local.get(GITHUB_TOKEN_STORAGE_KEY, result => {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          resolve(result[GITHUB_TOKEN_STORAGE_KEY] || null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  /**
   * Persist the user's GitHub Personal Access Token to `chrome.storage.local`.
   * @param {string} token - The token to store.
   * @returns {Promise<void>} Rejects if storage write fails.
   */
  async function saveGithubToken(token) {
    if (!isContextValid()) return;
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.set({ [GITHUB_TOKEN_STORAGE_KEY]: token }, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Remove the stored GitHub Personal Access Token.
   * @returns {Promise<void>} Rejects if storage write fails.
   */
  async function clearGithubToken() {
    if (!isContextValid()) return;
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.remove(GITHUB_TOKEN_STORAGE_KEY, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Reset storage to factory defaults and return the new config.
   * @returns {Promise<Object>} The freshly-saved default configuration.
   */
  async function resetToDefaults() {
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    await saveConfig(config);
    return config;
  }

  /**
   * Return the list of enabled profiles whose `repoPatterns` match `repoFullName`,
   * after applying any repo-level overrides (disabled/extra profiles).
   * @param {Object} config       - Full config object.
   * @param {string} repoFullName - Repository in `org/repo` format.
   * @returns {Object[]} Array of matched, filtered profile objects.
   */
  function getMatchingProfiles(config, repoFullName) {
    const profiles = (config.profiles || []).filter(p => {
      if (!p.enabled) return false;
      return p.repoPatterns.some(pat => globMatch(pat, repoFullName));
    });

    const overrides = (config.repoOverrides || []).filter(o => globMatch(o.pattern, repoFullName));

    for (const override of overrides) {
      if (override.disabledProfiles) {
        for (let i = profiles.length - 1; i >= 0; i--) {
          if (override.disabledProfiles.includes(profiles[i].id)) {
            profiles.splice(i, 1);
          }
        }
      }
      if (override.extraProfiles) {
        for (const pid of override.extraProfiles) {
          const extra = config.profiles.find(p => p.id === pid);
          if (extra && !profiles.find(p => p.id === pid)) {
            profiles.push(extra);
          }
        }
      }
    }

    return profiles;
  }

  /**
   * Collect any `extraCommands` defined in repo overrides that match `repoFullName`.
   * @param {Object} config       - Full config object.
   * @param {string} repoFullName - Repository in `org/repo` format.
   * @returns {Object[]} Flat array of extra command objects.
   */
  function getExtraCommands(config, repoFullName) {
    const overrides = (config.repoOverrides || []).filter(o => globMatch(o.pattern, repoFullName));
    const cmds = [];
    for (const o of overrides) {
      if (o.extraCommands) cmds.push(...o.extraCommands);
    }
    return cmds;
  }

  /**
   * Trim and coerce a command string to a safe value.
   * @param {*} text - Raw input (may be null/undefined).
   * @returns {string} Trimmed string, or empty string if input is nullish.
   */
  function sanitizeCommand(text) {
    return text == null ? '' : String(text).trim();
  }

  /**
   * Escape a string for safe insertion into innerHTML contexts.
   * @param {string} str - Arbitrary string.
   * @returns {string} HTML-entity-escaped string.
   */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  /**
   * Filter or annotate profile commands based on which Prow plugins are enabled for the repo.
   * @param {Object[]} profiles       - Array of profile objects.
   * @param {string[]} enabledPlugins - Plugin names that are active for the current repo.
   * @param {'disabled'|'filter'|'indicate'} mode
   *   - `disabled`: return profiles unchanged.
   *   - `filter`:   remove commands whose plugin is not enabled.
   *   - `indicate`: keep all commands but mark disabled ones with `_pluginDisabled: true`.
   * @returns {Object[]} Updated (deep-cloned) profiles array.
   */
  function filterCommandsByPlugins(profiles, enabledPlugins, mode) {
    if (mode === 'disabled' || !enabledPlugins) return profiles;

    const pluginMap = (window.GHBCP && window.GHBCP.CommandToPlugin) || {};
    const enabledSet = new Set(enabledPlugins);

    function isCommandEnabled(cmd) {
      const baseCmd = cmd.command.split(' ')[0];
      const plugin = pluginMap[cmd.command] || pluginMap[baseCmd];
      if (!plugin) return true;
      return enabledSet.has(plugin);
    }

    return profiles.map(profile => {
      const filtered = JSON.parse(JSON.stringify(profile));
      const globalCmds = filtered.globalCommands || [];
      const checkCmds = filtered.checkCommands || [];
      if (mode === 'filter') {
        filtered.globalCommands = globalCmds.filter(isCommandEnabled);
        filtered.checkCommands = checkCmds.filter(isCommandEnabled);
      } else if (mode === 'indicate') {
        filtered.globalCommands = globalCmds.map(cmd => ({
          ...cmd, _pluginDisabled: !isCommandEnabled(cmd)
        }));
        filtered.checkCommands = checkCmds.map(cmd => ({
          ...cmd, _pluginDisabled: !isCommandEnabled(cmd)
        }));
      }
      return filtered;
    });
  }

  return {
    generateId,
    createCommand: cmd,
    escapeHtml,
    isContextValid,
    getConfig,
    saveConfig,
    getGithubToken,
    saveGithubToken,
    clearGithubToken,
    resetToDefaults,
    getMatchingProfiles,
    getExtraCommands,
    filterCommandsByPlugins,
    globMatch,
    isRepoExcluded,
    getOverrideContext,
    isProwProfile,
    PROW_PROFILE_IDS,
    sanitizeCommand,
    DEFAULT_CONFIG,
    PRESET_SOURCES,
    STORAGE_KEY,
    CHUNK_META_KEY,
    CHUNK_KEY_PREFIX
  };
})();
