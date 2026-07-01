// GitHub Bot Command Palette — Configuration Manager
const GHBCP = window.GHBCP || {};
window.GHBCP = GHBCP;

GHBCP.ConfigManager = (() => {
  const STORAGE_KEY = 'ghbcp_config';
  const SCHEMA_VERSION = 6;
  const BUILTIN_PROFILE_IDS = new Set([
    'profile-tide-prow-universal',
    'profile-prow-openshift-release',
    'profile-mergify',
    'profile-changesets',
    'profile-dependabot',
    'profile-claude',
    'profile-coderabbitai'
  ]);
  const PROW_PROFILE_IDS = new Set([
    'profile-tide-prow-universal',
    'profile-prow-openshift-release'
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
      jobPickerFilter: opts.jobPickerFilter || 'all',
      jobSource: opts.jobSource || '',
      joinMode: opts.joinMode || '',
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
          cmd('CC User', '/cc', 'neutral', { hasInput: true, inputPlaceholder: 'username', commandTemplate: '/cc @{input}', description: 'CC a user' }),
          cmd('UnCC User', '/uncc', 'neutral', { hasInput: true, inputPlaceholder: 'username', commandTemplate: '/uncc @{input}', description: 'Remove CC' }),
          cmd('OK to Test', '/ok-to-test', 'success', { description: 'Allow CI testing for external contributors' })
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
          cmd('Rehearse All', '/pj-rehearse', 'primary', { description: 'Rehearse all tests' })
        ],
        checkCommands: [],
        dynamicCommands: [
          {
            id: generateId(),
            label: 'Rehearse',
            commandExpression: '"/pj-rehearse " + testName',
            injectAt: 'failed-checks',
            style: 'primary'
          }
        ]
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
    // left intact.
    const eventMatch = name.match(/\s+\(([a-z_]+)\)$/);
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
    config.version = SCHEMA_VERSION;
    config._migrated = true;
    return config;
  }

  /**
   * Load the stored config, applying schema migration if necessary.
   * Falls back to a deep copy of DEFAULT_CONFIG when storage is unavailable.
   * @returns {Promise<Object>} Resolved configuration object.
   */
  async function getConfig() {
    if (!isContextValid()) return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    return new Promise(resolve => {
      try {
        chrome.storage.sync.get(STORAGE_KEY, async result => {
          if (chrome.runtime.lastError) {
            resolve(JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
            return;
          }
          let config = result[STORAGE_KEY] || JSON.parse(JSON.stringify(DEFAULT_CONFIG));
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
        });
      } catch (e) {
        resolve(JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
      }
    });
  }

  /**
   * Persist `config` to `chrome.storage.sync`.
   * @param {Object} config - The configuration object to save.
   * @returns {Promise<void>} Rejects if storage write fails.
   */
  async function saveConfig(config) {
    if (!isContextValid()) return;
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.sync.set({ [STORAGE_KEY]: config }, () => {
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
    STORAGE_KEY
  };
})();
