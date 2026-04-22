// GitHub Bot Command Palette — Configuration Manager
const GHBCP = window.GHBCP || {};
window.GHBCP = GHBCP;

GHBCP.ConfigManager = (() => {
  const STORAGE_KEY = 'ghbcp_config';
  const SCHEMA_VERSION = 1;

  function generateId() {
    return crypto.randomUUID ? crypto.randomUUID() :
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
  }

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
          cmd('Override...', '/override', 'warning', { hasJobPicker: true, jobPickerFilter: 'failed', commandTemplate: '/override {input}', description: 'Override a failed CI check', shortcut: 'Alt+O' }),
          cmd('CC User', '/cc', 'neutral', { hasInput: true, inputPlaceholder: 'username', commandTemplate: '/cc @{input}', description: 'CC a user' }),
          cmd('UnCC User', '/uncc', 'neutral', { hasInput: true, inputPlaceholder: 'username', commandTemplate: '/uncc @{input}', description: 'Remove CC' })
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
          cmd('Rehearse Test...', '/pj-rehearse', 'primary', { hasInput: true, inputPlaceholder: 'test-job-name', commandTemplate: '/pj-rehearse {input}', description: 'Rehearse specific test' }),
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
      pluginFilterMode: 'filter'
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

  function isContextValid() {
    try { return !!chrome.runtime.id; } catch (e) { return false; }
  }

  function globMatch(pattern, str) {
    if (pattern === '*') return true;
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp('^' + escaped.replace(/\*/g, '.*') + '$');
    return regex.test(str);
  }

  async function getConfig() {
    if (!isContextValid()) return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    return new Promise(resolve => {
      try {
        chrome.storage.sync.get(STORAGE_KEY, result => {
          if (chrome.runtime.lastError) {
            resolve(JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
            return;
          }
          resolve(result[STORAGE_KEY] || JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
        });
      } catch (e) {
        resolve(JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
      }
    });
  }

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

  async function resetToDefaults() {
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    await saveConfig(config);
    return config;
  }

  function getMatchingProfiles(config, repoFullName) {
    const profiles = config.profiles.filter(p => {
      if (!p.enabled) return false;
      return p.repoPatterns.some(pat => globMatch(pat, repoFullName));
    });

    const overrides = config.repoOverrides.filter(o => globMatch(o.pattern, repoFullName));

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

  function getExtraCommands(config, repoFullName) {
    const overrides = config.repoOverrides.filter(o => globMatch(o.pattern, repoFullName));
    const cmds = [];
    for (const o of overrides) {
      if (o.extraCommands) cmds.push(...o.extraCommands);
    }
    return cmds;
  }

  function sanitizeCommand(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.textContent;
  }

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
      if (mode === 'filter') {
        filtered.globalCommands = filtered.globalCommands.filter(isCommandEnabled);
        filtered.checkCommands = filtered.checkCommands.filter(isCommandEnabled);
      } else if (mode === 'indicate') {
        filtered.globalCommands = filtered.globalCommands.map(cmd => ({
          ...cmd, _pluginDisabled: !isCommandEnabled(cmd)
        }));
        filtered.checkCommands = filtered.checkCommands.map(cmd => ({
          ...cmd, _pluginDisabled: !isCommandEnabled(cmd)
        }));
      }
      return filtered;
    });
  }

  return {
    generateId,
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
})();
