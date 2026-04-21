// GitHub Bot Command Palette — Settings Page
(async () => {
  const STORAGE_KEY = 'ghbcp_config';
  const SCHEMA_VERSION = 1;

  function generateId() {
    return crypto.randomUUID ? crypto.randomUUID() :
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
  }

  function defaultConfig() {
    return {
      version: SCHEMA_VERSION,
      profiles: [
        {
          id: 'profile-tide-prow-universal',
          name: 'Tide/Prow — Universal',
          description: 'Common Prow/Tide slash commands for any repo',
          enabled: true,
          repoPatterns: ['*'],
          globalCommands: [
            mkCmd('LGTM', '/lgtm', 'success', { shortcut: 'Alt+L' }),
            mkCmd('Cancel LGTM', '/lgtm cancel', 'danger'),
            mkCmd('Approve', '/approve', 'success', { shortcut: 'Alt+A' }),
            mkCmd('Cancel Approve', '/approve cancel', 'danger'),
            mkCmd('Hold', '/hold', 'warning'),
            mkCmd('Cancel Hold', '/hold cancel', 'neutral'),
            mkCmd('Retest', '/retest', 'primary', { shortcut: 'Alt+R' }),
            mkCmd('Retest Required', '/retest-required', 'primary'),
            mkCmd('Test...', '/test', 'primary', { hasJobPicker: true, commandTemplate: '/test {input}', shortcut: 'Alt+T' }),
            mkCmd('CC User', '/cc', 'neutral', { hasInput: true, inputPlaceholder: 'username', commandTemplate: '/cc @{input}' }),
            mkCmd('UnCC User', '/uncc', 'neutral', { hasInput: true, inputPlaceholder: 'username', commandTemplate: '/uncc @{input}' })
          ],
          checkCommands: [mkCmd('Retest This', '/retest', 'primary')],
          dynamicCommands: []
        },
        {
          id: 'profile-prow-openshift-release',
          name: 'Prow — OpenShift Release',
          description: 'Extra commands for openshift/release repo',
          enabled: true,
          repoPatterns: ['openshift/release'],
          globalCommands: [
            mkCmd('Rehearse ACK', '/pj-rehearse ack', 'warning', { requireConfirm: true }),
            mkCmd('Rehearse Test...', '/pj-rehearse', 'primary', { hasInput: true, inputPlaceholder: 'test-job-name', commandTemplate: '/pj-rehearse {input}' }),
            mkCmd('Rehearse All', '/pj-rehearse', 'primary')
          ],
          checkCommands: [],
          dynamicCommands: [{
            id: generateId(), label: 'Rehearse',
            commandExpression: '"/pj-rehearse " + testName',
            injectAt: 'failed-checks', style: 'primary'
          }]
        },
        {
          id: 'profile-mergify',
          name: 'Mergify',
          description: 'Mergify bot commands',
          enabled: false,
          repoPatterns: ['*'],
          globalCommands: [
            mkCmd('Requeue', '/mergify requeue', 'primary'),
            mkCmd('Refresh', '/mergify refresh', 'neutral')
          ],
          checkCommands: [], dynamicCommands: []
        },
        {
          id: 'profile-changesets',
          name: 'Changesets Bot',
          description: 'Changesets bot commands',
          enabled: false,
          repoPatterns: ['*'],
          globalCommands: [
            mkCmd('Changeset', '/changeset', 'primary', { hasInput: true, inputPlaceholder: 'patch|minor|major', commandTemplate: '/changeset {input}' })
          ],
          checkCommands: [], dynamicCommands: []
        }
      ],
      repoOverrides: [],
      pluginConfigSources: [],
      globalSettings: {
        enabled: true, buttonPosition: 'above-comment-box', theme: 'auto',
        confirmBeforePost: false, showOnlyFailedTests: true, autoSubmit: false,
        pluginFilterMode: 'filter'
      }
    };
  }

  const PRESET_SOURCES = [
    {
      name: 'OpenShift CI (openshift/release)',
      format: 'sharded',
      configRepo: 'openshift/release',
      branch: 'master',
      pathTemplate: 'core-services/prow/02_config',
      filePath: '',
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

  function mkCmd(label, command, style, opts = {}) {
    return {
      id: generateId(), label, command, description: opts.description || command,
      style: style || 'neutral', requireConfirm: opts.requireConfirm || false,
      hasInput: opts.hasInput || false, hasJobPicker: opts.hasJobPicker || false,
      inputPlaceholder: opts.inputPlaceholder || '',
      commandTemplate: opts.commandTemplate || '', shortcut: opts.shortcut || ''
    };
  }

  let config = null;
  let editingProfileIndex = -1;
  let editingProfile = null;
  let editingCmdTarget = null;
  let editingCmdIndex = -1;

  async function loadConfig() {
    return new Promise(resolve => {
      chrome.storage.sync.get(STORAGE_KEY, result => {
        config = result[STORAGE_KEY] || defaultConfig();
        resolve();
      });
    });
  }

  async function saveConfig() {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.set({ [STORAGE_KEY]: config }, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      });
    });
  }

  function showStatus(msg, type) {
    const el = document.getElementById('status-msg');
    el.textContent = msg;
    el.className = 'status status-' + type;
    setTimeout(() => { el.className = 'status'; }, 3000);
  }

  function renderGlobalSettings() {
    const gs = config.globalSettings;
    document.getElementById('opt-enabled').checked = gs.enabled;
    document.getElementById('opt-confirm').checked = gs.confirmBeforePost;
    document.getElementById('opt-autosubmit').checked = gs.autoSubmit || false;
    document.getElementById('opt-failtests').checked = gs.showOnlyFailedTests;
    document.getElementById('opt-theme').value = gs.theme;
    document.getElementById('opt-position').value = gs.buttonPosition;
    document.getElementById('opt-pluginfilter').value = gs.pluginFilterMode || 'disabled';
  }

  function bindGlobalSettings() {
    const fields = ['opt-enabled', 'opt-confirm', 'opt-autosubmit', 'opt-failtests', 'opt-theme', 'opt-position', 'opt-pluginfilter'];
    for (const id of fields) {
      document.getElementById(id).addEventListener('change', async () => {
        config.globalSettings.enabled = document.getElementById('opt-enabled').checked;
        config.globalSettings.confirmBeforePost = document.getElementById('opt-confirm').checked;
        config.globalSettings.autoSubmit = document.getElementById('opt-autosubmit').checked;
        config.globalSettings.showOnlyFailedTests = document.getElementById('opt-failtests').checked;
        config.globalSettings.theme = document.getElementById('opt-theme').value;
        config.globalSettings.buttonPosition = document.getElementById('opt-position').value;
        config.globalSettings.pluginFilterMode = document.getElementById('opt-pluginfilter').value;
        await saveConfig();
        showStatus('Settings saved', 'success');
      });
    }
  }

  function styleBadge(style) {
    return `<span class="badge badge-${style}">${style}</span>`;
  }

  function renderProfiles() {
    const container = document.getElementById('profiles-list');
    container.innerHTML = '';

    for (let i = 0; i < config.profiles.length; i++) {
      const p = config.profiles[i];
      const card = document.createElement('div');
      card.className = 'profile-card';

      const cmdCount = p.globalCommands.length + p.checkCommands.length + (p.dynamicCommands || []).length;

      card.innerHTML = `
        <div class="profile-header">
          <div>
            <span class="profile-name">${esc(p.name)}</span>
            <span class="profile-desc"> — ${esc(p.description)}</span>
            <div class="profile-patterns">${p.repoPatterns.map(r => esc(r)).join(', ')} · ${cmdCount} commands</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="toggle">
              <input type="checkbox" data-profile-toggle="${i}" ${p.enabled ? 'checked' : ''}>
              <span class="slider"></span>
            </span>
            <button class="btn btn-sm" data-edit-profile="${i}">Edit</button>
            <button class="btn btn-sm btn-danger" data-delete-profile="${i}">✕</button>
          </div>
        </div>
        <table class="cmd-table">
          <tr><th>Label</th><th>Command</th><th>Style</th><th>Input</th></tr>
          ${p.globalCommands.map(c => `<tr><td>${esc(c.label)}</td><td><code>${esc(c.command)}</code></td><td>${styleBadge(c.style)}</td><td>${c.hasInput ? '✓' : ''}</td></tr>`).join('')}
        </table>
      `;
      container.appendChild(card);
    }

    container.querySelectorAll('[data-profile-toggle]').forEach(el => {
      el.addEventListener('change', async () => {
        const idx = parseInt(el.dataset.profileToggle);
        config.profiles[idx].enabled = el.checked;
        await saveConfig();
      });
    });

    container.querySelectorAll('[data-edit-profile]').forEach(el => {
      el.addEventListener('click', () => openProfileEditor(parseInt(el.dataset.editProfile)));
    });

    container.querySelectorAll('[data-delete-profile]').forEach(el => {
      el.addEventListener('click', async () => {
        const idx = parseInt(el.dataset.deleteProfile);
        if (confirm(`Delete profile "${config.profiles[idx].name}"?`)) {
          config.profiles.splice(idx, 1);
          await saveConfig();
          renderProfiles();
        }
      });
    });
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function openProfileEditor(index) {
    editingProfileIndex = index;
    editingProfile = index >= 0
      ? JSON.parse(JSON.stringify(config.profiles[index]))
      : {
          id: generateId(), name: '', description: '', enabled: true,
          repoPatterns: ['*'], globalCommands: [], checkCommands: [], dynamicCommands: []
        };

    document.getElementById('modal-title').textContent = index >= 0 ? 'Edit Profile' : 'New Profile';
    document.getElementById('pf-name').value = editingProfile.name;
    document.getElementById('pf-desc').value = editingProfile.description;
    document.getElementById('pf-patterns').value = editingProfile.repoPatterns.join('\n');
    document.getElementById('pf-enabled').checked = editingProfile.enabled;

    renderProfileCommands();
    document.getElementById('profile-modal').classList.add('active');
  }

  function renderProfileCommands() {
    renderCmdList('pf-global-cmds', editingProfile.globalCommands, 'global');
    renderCmdList('pf-check-cmds', editingProfile.checkCommands, 'check');
    renderDynamicCmds();
  }

  function renderCmdList(containerId, cmds, type) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    for (let i = 0; i < cmds.length; i++) {
      const c = cmds[i];
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px;';
      row.innerHTML = `
        <span>${styleBadge(c.style)}</span>
        <strong style="font-size:12px">${esc(c.label)}</strong>
        <code style="font-size:11px;color:var(--text-muted)">${esc(c.command)}</code>
        <span style="flex:1"></span>
        <button class="btn btn-sm" data-edit-cmd="${type}:${i}">Edit</button>
        <button class="btn btn-sm btn-danger" data-del-cmd="${type}:${i}">✕</button>
      `;
      container.appendChild(row);
    }

    container.querySelectorAll('[data-edit-cmd]').forEach(el => {
      el.addEventListener('click', () => {
        const [t, idx] = el.dataset.editCmd.split(':');
        openCmdEditor(t, parseInt(idx));
      });
    });

    container.querySelectorAll('[data-del-cmd]').forEach(el => {
      el.addEventListener('click', () => {
        const [t, idx] = el.dataset.delCmd.split(':');
        const arr = t === 'global' ? editingProfile.globalCommands : editingProfile.checkCommands;
        arr.splice(parseInt(idx), 1);
        renderProfileCommands();
      });
    });
  }

  function renderDynamicCmds() {
    const container = document.getElementById('pf-dynamic-cmds');
    container.innerHTML = '';
    const dyns = editingProfile.dynamicCommands || [];
    for (let i = 0; i < dyns.length; i++) {
      const d = dyns[i];
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:12px;';
      row.innerHTML = `
        <strong>${esc(d.label)}</strong>
        <code style="font-size:11px;color:var(--text-muted)">${esc(d.commandExpression)}</code>
        <span style="flex:1"></span>
        <button class="btn btn-sm btn-danger" data-del-dyn="${i}">✕</button>
      `;
      container.appendChild(row);
    }

    container.querySelectorAll('[data-del-dyn]').forEach(el => {
      el.addEventListener('click', () => {
        editingProfile.dynamicCommands.splice(parseInt(el.dataset.delDyn), 1);
        renderDynamicCmds();
      });
    });
  }

  function openCmdEditor(type, index) {
    editingCmdTarget = type;
    editingCmdIndex = index;
    const arr = type === 'global' ? editingProfile.globalCommands : editingProfile.checkCommands;
    const cmd = index >= 0 ? arr[index] : {
      id: generateId(), label: '', command: '', description: '', style: 'neutral',
      requireConfirm: false, hasInput: false, inputPlaceholder: '', commandTemplate: '', shortcut: ''
    };

    document.getElementById('cmd-label').value = cmd.label;
    document.getElementById('cmd-command').value = cmd.command;
    document.getElementById('cmd-description').value = cmd.description;
    document.getElementById('cmd-style').value = cmd.style;
    document.getElementById('cmd-shortcut').value = cmd.shortcut || '';
    document.getElementById('cmd-confirm').checked = cmd.requireConfirm;
    document.getElementById('cmd-hasinput').checked = cmd.hasInput;
    document.getElementById('cmd-hasjobpicker').checked = cmd.hasJobPicker || false;
    document.getElementById('cmd-inputplaceholder').value = cmd.inputPlaceholder || '';
    document.getElementById('cmd-template').value = cmd.commandTemplate || '';
    toggleInputFields();

    document.getElementById('cmd-modal').classList.add('active');
  }

  function toggleInputFields() {
    const show = document.getElementById('cmd-hasinput').checked || document.getElementById('cmd-hasjobpicker').checked;
    document.getElementById('cmd-input-fields').classList.toggle('hidden', !show);
  }

  // Event bindings
  document.getElementById('cmd-hasinput').addEventListener('change', toggleInputFields);
  document.getElementById('cmd-hasjobpicker').addEventListener('change', toggleInputFields);

  document.getElementById('btn-add-profile').addEventListener('click', () => openProfileEditor(-1));

  document.getElementById('btn-cancel-profile').addEventListener('click', () => {
    document.getElementById('profile-modal').classList.remove('active');
  });

  document.getElementById('btn-save-profile').addEventListener('click', async () => {
    editingProfile.name = document.getElementById('pf-name').value.trim();
    editingProfile.description = document.getElementById('pf-desc').value.trim();
    editingProfile.repoPatterns = document.getElementById('pf-patterns').value.split('\n').map(s => s.trim()).filter(Boolean);
    editingProfile.enabled = document.getElementById('pf-enabled').checked;

    if (!editingProfile.name) { alert('Profile name required'); return; }
    if (editingProfile.repoPatterns.length === 0) editingProfile.repoPatterns = ['*'];

    if (editingProfileIndex >= 0) {
      config.profiles[editingProfileIndex] = editingProfile;
    } else {
      config.profiles.push(editingProfile);
    }

    await saveConfig();
    renderProfiles();
    document.getElementById('profile-modal').classList.remove('active');
    showStatus('Profile saved', 'success');
  });

  document.getElementById('btn-add-global-cmd').addEventListener('click', () => openCmdEditor('global', -1));
  document.getElementById('btn-add-check-cmd').addEventListener('click', () => openCmdEditor('check', -1));

  document.getElementById('btn-add-dynamic-cmd').addEventListener('click', () => {
    const label = prompt('Dynamic command label:');
    if (!label) return;
    const expr = prompt('Command expression (JS, vars: testName, checkName, repoName, prNumber):', '"/retest " + testName');
    if (!expr) return;
    if (!editingProfile.dynamicCommands) editingProfile.dynamicCommands = [];
    editingProfile.dynamicCommands.push({
      id: generateId(), label, commandExpression: expr, injectAt: 'failed-checks', style: 'primary'
    });
    renderDynamicCmds();
  });

  document.getElementById('btn-cancel-cmd').addEventListener('click', () => {
    document.getElementById('cmd-modal').classList.remove('active');
  });

  document.getElementById('btn-save-cmd').addEventListener('click', () => {
    const cmd = {
      id: editingCmdIndex >= 0
        ? (editingCmdTarget === 'global' ? editingProfile.globalCommands : editingProfile.checkCommands)[editingCmdIndex].id
        : generateId(),
      label: document.getElementById('cmd-label').value.trim(),
      command: document.getElementById('cmd-command').value.trim(),
      description: document.getElementById('cmd-description').value.trim(),
      style: document.getElementById('cmd-style').value,
      shortcut: document.getElementById('cmd-shortcut').value.trim(),
      requireConfirm: document.getElementById('cmd-confirm').checked,
      hasInput: document.getElementById('cmd-hasinput').checked,
      hasJobPicker: document.getElementById('cmd-hasjobpicker').checked,
      inputPlaceholder: document.getElementById('cmd-inputplaceholder').value.trim(),
      commandTemplate: document.getElementById('cmd-template').value.trim()
    };

    if (!cmd.label || !cmd.command) { alert('Label and command required'); return; }

    const arr = editingCmdTarget === 'global' ? editingProfile.globalCommands : editingProfile.checkCommands;
    if (editingCmdIndex >= 0) {
      arr[editingCmdIndex] = cmd;
    } else {
      arr.push(cmd);
    }

    renderProfileCommands();
    document.getElementById('cmd-modal').classList.remove('active');
  });

  document.getElementById('btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ghbcp-config.json';
    a.click();
    URL.revokeObjectURL(url);
    showStatus('Config exported', 'success');
  });

  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });

  document.getElementById('import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = JSON.parse(text);
      if (!imported.profiles || !imported.globalSettings) {
        throw new Error('Invalid config format');
      }
      config = imported;
      await saveConfig();
      renderGlobalSettings();
      renderProfiles();
      showStatus('Config imported successfully', 'success');
    } catch (err) {
      showStatus('Import failed: ' + err.message, 'error');
    }
    e.target.value = '';
  });

  document.getElementById('btn-reset').addEventListener('click', async () => {
    if (!confirm('Reset all settings to defaults? This cannot be undone.')) return;
    config = defaultConfig();
    await saveConfig();
    renderGlobalSettings();
    renderProfiles();
    renderPluginSources();
    showStatus('Reset to defaults', 'success');
  });

  // === Plugin Config Sources ===

  let editingSourceIndex = -1;

  function renderPluginSources() {
    if (!config.pluginConfigSources) config.pluginConfigSources = [];
    const container = document.getElementById('plugin-sources-list');
    container.innerHTML = '';

    for (let i = 0; i < config.pluginConfigSources.length; i++) {
      const s = config.pluginConfigSources[i];
      const card = document.createElement('div');
      card.className = 'profile-card';
      card.innerHTML = `
        <div class="profile-header">
          <div>
            <span class="profile-name">${esc(s.name)}</span>
            <span class="badge badge-${s.format === 'sharded' ? 'primary' : 'warning'}">${s.format}</span>
            <div class="profile-patterns">
              <code>${esc(s.configRepo)}</code> @ ${esc(s.branch)}
              ${s.format === 'sharded' ? ' / ' + esc(s.pathTemplate) : ' / ' + esc(s.filePath)}
              · TTL ${s.cacheTTLMinutes || 60}m
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="toggle">
              <input type="checkbox" data-source-toggle="${i}" ${s.enabled ? 'checked' : ''}>
              <span class="slider"></span>
            </span>
            <button class="btn btn-sm" data-edit-source="${i}">Edit</button>
            <button class="btn btn-sm btn-danger" data-delete-source="${i}">✕</button>
          </div>
        </div>
      `;
      container.appendChild(card);
    }

    container.querySelectorAll('[data-source-toggle]').forEach(el => {
      el.addEventListener('change', async () => {
        config.pluginConfigSources[parseInt(el.dataset.sourceToggle)].enabled = el.checked;
        await saveConfig();
      });
    });

    container.querySelectorAll('[data-edit-source]').forEach(el => {
      el.addEventListener('click', () => openSourceEditor(parseInt(el.dataset.editSource)));
    });

    container.querySelectorAll('[data-delete-source]').forEach(el => {
      el.addEventListener('click', async () => {
        const idx = parseInt(el.dataset.deleteSource);
        if (confirm(`Delete source "${config.pluginConfigSources[idx].name}"?`)) {
          config.pluginConfigSources.splice(idx, 1);
          await saveConfig();
          renderPluginSources();
        }
      });
    });

    // Populate presets dropdown
    const presetSelect = document.getElementById('preset-select');
    presetSelect.innerHTML = '<option value="">Add from Preset...</option>';
    for (let i = 0; i < PRESET_SOURCES.length; i++) {
      presetSelect.innerHTML += `<option value="${i}">${esc(PRESET_SOURCES[i].name)}</option>`;
    }
  }

  function openSourceEditor(index) {
    editingSourceIndex = index;
    const s = index >= 0
      ? config.pluginConfigSources[index]
      : { id: '', name: '', enabled: true, format: 'sharded', configRepo: '', branch: 'master', pathTemplate: '', filePath: '', cacheTTLMinutes: 60 };

    document.getElementById('source-modal-title').textContent = index >= 0 ? 'Edit Source' : 'New Source';
    document.getElementById('src-name').value = s.name;
    document.getElementById('src-format').value = s.format;
    document.getElementById('src-configrepo').value = s.configRepo;
    document.getElementById('src-branch').value = s.branch;
    document.getElementById('src-pathtemplate').value = s.pathTemplate || '';
    document.getElementById('src-filepath').value = s.filePath || '';
    document.getElementById('src-ttl').value = s.cacheTTLMinutes || 60;
    document.getElementById('src-enabled').checked = s.enabled;
    document.getElementById('src-test-inline').className = 'status';
    document.getElementById('src-test-inline').textContent = '';
    toggleSourceFields();
    document.getElementById('source-modal').classList.add('active');
  }

  function toggleSourceFields() {
    const fmt = document.getElementById('src-format').value;
    document.getElementById('src-path-row').classList.toggle('hidden', fmt !== 'sharded');
    document.getElementById('src-file-row').classList.toggle('hidden', fmt !== 'monolithic');
  }

  document.getElementById('src-format').addEventListener('change', toggleSourceFields);

  document.getElementById('btn-add-source').addEventListener('click', () => openSourceEditor(-1));

  document.getElementById('preset-select').addEventListener('change', () => {
    const val = document.getElementById('preset-select').value;
    if (val === '') return;
    const preset = PRESET_SOURCES[parseInt(val)];
    if (!config.pluginConfigSources) config.pluginConfigSources = [];

    const existing = config.pluginConfigSources.find(s => s.configRepo === preset.configRepo);
    if (existing) {
      document.getElementById('preset-select').value = '';
      showStatus('Source already exists: ' + preset.name, 'error');
      return;
    }

    openSourceEditor(-1);
    document.getElementById('src-name').value = preset.name;
    document.getElementById('src-format').value = preset.format;
    document.getElementById('src-configrepo').value = preset.configRepo;
    document.getElementById('src-branch').value = preset.branch;
    document.getElementById('src-pathtemplate').value = preset.pathTemplate;
    document.getElementById('src-filepath').value = preset.filePath;
    document.getElementById('src-ttl').value = preset.cacheTTLMinutes;
    toggleSourceFields();
    document.getElementById('preset-select').value = '';
  });

  document.getElementById('btn-cancel-source').addEventListener('click', () => {
    document.getElementById('source-modal').classList.remove('active');
  });

  document.getElementById('btn-save-source').addEventListener('click', async () => {
    const source = {
      id: editingSourceIndex >= 0 ? config.pluginConfigSources[editingSourceIndex].id : generateId(),
      name: document.getElementById('src-name').value.trim(),
      enabled: document.getElementById('src-enabled').checked,
      format: document.getElementById('src-format').value,
      configRepo: document.getElementById('src-configrepo').value.trim(),
      branch: document.getElementById('src-branch').value.trim() || 'master',
      pathTemplate: document.getElementById('src-pathtemplate').value.trim(),
      filePath: document.getElementById('src-filepath').value.trim(),
      cacheTTLMinutes: parseInt(document.getElementById('src-ttl').value) || 60
    };

    if (!source.name || !source.configRepo) {
      alert('Name and config repository required');
      return;
    }

    if (!config.pluginConfigSources) config.pluginConfigSources = [];

    if (editingSourceIndex >= 0) {
      config.pluginConfigSources[editingSourceIndex] = source;
    } else {
      config.pluginConfigSources.push(source);
    }

    await saveConfig();
    renderPluginSources();
    document.getElementById('source-modal').classList.remove('active');
    showStatus('Source saved', 'success');
  });

  document.getElementById('btn-test-source').addEventListener('click', async () => {
    const resultEl = document.getElementById('src-test-inline');
    const testRepo = document.getElementById('src-test-repo').value.trim();
    if (!testRepo || !testRepo.includes('/')) {
      resultEl.textContent = 'Enter a valid org/repo to test';
      resultEl.className = 'status status-error';
      return;
    }

    const source = {
      format: document.getElementById('src-format').value,
      configRepo: document.getElementById('src-configrepo').value.trim(),
      branch: document.getElementById('src-branch').value.trim() || 'master',
      pathTemplate: document.getElementById('src-pathtemplate').value.trim(),
      filePath: document.getElementById('src-filepath').value.trim()
    };

    resultEl.textContent = 'Fetching...';
    resultEl.className = 'status status-success';

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'testPluginSource',
        source,
        testRepo
      });

      if (response && response.success) {
        const plugins = response.plugins.length > 0 ? response.plugins.join(', ') : '(none found)';
        resultEl.textContent = `Enabled plugins for ${testRepo}: ${plugins} (${response.rawLength} bytes fetched)`;
        resultEl.className = 'status status-success';
      } else {
        resultEl.textContent = 'Error: ' + (response ? response.error : 'No response');
        resultEl.className = 'status status-error';
      }
    } catch (err) {
      resultEl.textContent = 'Error: ' + err.message;
      resultEl.className = 'status status-error';
    }
  });

  // Init
  await loadConfig();
  renderGlobalSettings();
  bindGlobalSettings();
  renderProfiles();
  renderPluginSources();
})();
