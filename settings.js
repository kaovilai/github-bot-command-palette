// GitHub Bot Command Palette — Settings Page
(async () => {
  const CM = GHBCP.ConfigManager;
  const { generateId, escapeHtml: esc, PRESET_SOURCES } = CM;

  /** @returns {Object} A fresh deep copy of the factory-default configuration. */
  function defaultConfig() {
    return JSON.parse(JSON.stringify(CM.DEFAULT_CONFIG));
  }

  let config = null;
  let editingProfileIndex = -1;
  let editingProfile = null;
  let editingCmdTarget = null;
  let editingCmdIndex = -1;

  /** Load the extension config from storage into the module-level `config` variable. */
  async function loadConfig() {
    config = await CM.getConfig();
  }

  /** Persist the current `config` to storage via ConfigManager. @returns {Promise<void>} */
  async function saveConfig() {
    return CM.saveConfig(config);
  }

  let _statusTimer = null;
  /**
   * Display a transient status message in the settings page status bar.
   * @param {string} msg  - Message text to display.
   * @param {'success'|'error'|'warning'} type - Visual style variant.
   */
  function showStatus(msg, type) {
    const el = document.getElementById('status-msg');
    el.textContent = msg;
    el.className = 'status status-' + type;
    clearTimeout(_statusTimer);
    _statusTimer = setTimeout(() => { el.className = 'status'; }, 3000);
  }

  /** Populate the global-settings form fields from the current config. */
  function renderGlobalSettings() {
    const gs = config.globalSettings;
    document.getElementById('opt-enabled').checked = gs.enabled;
    document.getElementById('opt-confirm').checked = gs.confirmBeforePost;
    document.getElementById('opt-autosubmit').checked = gs.autoSubmit || false;
    document.getElementById('opt-failtests').checked = gs.showOnlyFailedTests;
    document.getElementById('opt-theme').value = gs.theme;
    document.getElementById('opt-position').value = gs.buttonPosition;
    document.getElementById('opt-pluginfilter').value = gs.pluginFilterMode || 'disabled';
    document.getElementById('opt-excluded-repos').value = (gs.excludedRepos || []).join('\n');
    document.getElementById('opt-prow-autodetect').checked = gs.prowAutoDetect !== false;
  }

  /** Attach change-event listeners to global-settings form fields so each change auto-saves. */
  function bindGlobalSettings() {
    async function readAndSave() {
      config.globalSettings.enabled = document.getElementById('opt-enabled').checked;
      config.globalSettings.confirmBeforePost = document.getElementById('opt-confirm').checked;
      config.globalSettings.autoSubmit = document.getElementById('opt-autosubmit').checked;
      config.globalSettings.showOnlyFailedTests = document.getElementById('opt-failtests').checked;
      config.globalSettings.theme = document.getElementById('opt-theme').value;
      config.globalSettings.buttonPosition = document.getElementById('opt-position').value;
      config.globalSettings.pluginFilterMode = document.getElementById('opt-pluginfilter').value;
      config.globalSettings.excludedRepos = document.getElementById('opt-excluded-repos').value
        .split('\n').map(s => s.trim()).filter(s => s.length > 0);
      config.globalSettings.prowAutoDetect = document.getElementById('opt-prow-autodetect').checked;
      try {
        await saveConfig();
        showStatus('Settings saved', 'success');
      } catch (err) {
        showStatus('Save failed: ' + err.message, 'error');
      }
    }

    const fields = ['opt-enabled', 'opt-confirm', 'opt-autosubmit', 'opt-failtests', 'opt-prow-autodetect', 'opt-theme', 'opt-position', 'opt-pluginfilter', 'opt-excluded-repos'];
    for (const id of fields) {
      document.getElementById(id).addEventListener('change', readAndSave);
    }
  }

  /**
   * Load the GitHub token into the Settings form. Kept out of `renderGlobalSettings()`
   * on purpose — the token lives in `chrome.storage.local` via
   * `CM.getGithubToken()`/`saveGithubToken()`, separate from the synced
   * `config` blob (and so isn't included in Export/Import either).
   */
  async function renderGithubToken() {
    const token = await CM.getGithubToken();
    document.getElementById('opt-github-token').value = token || '';
  }

  /** Wire up the GitHub token field's autosave and the Verify Token button. */
  function bindGithubToken() {
    document.getElementById('opt-github-token').addEventListener('change', async (e) => {
      try {
        await CM.saveGithubToken(e.target.value.trim());
        showStatus('Settings saved', 'success');
      } catch (err) {
        showStatus('Save failed: ' + err.message, 'error');
      }
    });

    document.getElementById('btn-verify-token').addEventListener('click', async () => {
      const resultEl = document.getElementById('github-token-status');
      const token = document.getElementById('opt-github-token').value.trim();
      if (!token) {
        resultEl.textContent = 'Enter a token to verify';
        resultEl.className = 'status status-error';
        return;
      }

      resultEl.textContent = 'Verifying...';
      resultEl.className = 'status status-success';

      try {
        const response = await chrome.runtime.sendMessage({ action: 'verifyGithubToken', token });
        if (response && response.success) {
          resultEl.textContent = `Token valid — authenticated as ${response.login}`;
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
  }

  /**
   * Return an HTML `<span>` badge for a command style value.
   * @param {string} style - Style key (e.g. `success`, `danger`, `neutral`).
   * @returns {string} HTML string.
   */
  function styleBadge(style) {
    const s = esc(style);
    return `<span class="badge badge-${s}">${s}</span>`;
  }

  /** Re-render the full profile list from the current config, wiring all edit/delete/toggle handlers. */
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
              <input type="checkbox" data-profile-toggle="${i}" aria-label="Enable ${esc(p.name)}" ${p.enabled ? 'checked' : ''}>
              <span class="slider"></span>
            </span>
            <button class="btn btn-sm" data-edit-profile="${i}" aria-label="Edit profile ${esc(p.name)}">Edit</button>
            <button class="btn btn-sm btn-danger" data-delete-profile="${i}" aria-label="Delete profile ${esc(p.name)}">✕</button>
          </div>
        </div>
        <table class="cmd-table">
          <tr><th>Label</th><th>Command</th><th>Style</th><th>Shortcut</th></tr>
          ${p.globalCommands.map(c => `<tr><td>${esc(c.label)}</td><td><code>${esc(c.command)}</code></td><td>${styleBadge(c.style)}</td><td>${c.shortcut ? `<span class="shortcut-badge">${esc(c.shortcut)}</span>` : ''}</td></tr>`).join('')}
        </table>
      `;
      container.appendChild(card);
    }

    container.querySelectorAll('[data-profile-toggle]').forEach(el => {
      el.addEventListener('change', async () => {
        const idx = parseInt(el.dataset.profileToggle);
        config.profiles[idx].enabled = el.checked;
        try { await saveConfig(); } catch (err) { showStatus('Save failed: ' + err.message, 'error'); }
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
          try {
            await saveConfig();
            renderProfiles();
          } catch (err) {
            showStatus('Save failed: ' + err.message, 'error');
          }
        }
      });
    });
  }

  /**
   * Open the profile editor modal for an existing or new profile.
   * @param {number} index - Index into `config.profiles`, or -1 to create a new profile.
   */
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

  /** Re-render all command lists (global, check, dynamic) inside the profile editor. */
  function renderProfileCommands() {
    renderCmdList('pf-global-cmds', editingProfile.globalCommands, 'global');
    renderCmdList('pf-check-cmds', editingProfile.checkCommands, 'check');
    renderDynamicCmds();
  }

  /**
   * Render a command list inside the profile editor, wiring edit/delete buttons.
   * @param {string}   containerId - ID of the container element.
   * @param {Object[]} cmds        - Array of command objects to render.
   * @param {'global'|'check'} type - Command list type, used to route edit/delete actions.
   */
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
        ${c.shortcut ? `<span class="shortcut-badge">${esc(c.shortcut)}</span>` : ''}
        <span style="flex:1"></span>
        <button class="btn btn-sm" data-edit-cmd="${type}:${i}" aria-label="Edit command ${esc(c.label)}">Edit</button>
        <button class="btn btn-sm btn-danger" data-del-cmd="${type}:${i}" aria-label="Delete command ${esc(c.label)}">✕</button>
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

  /** Re-render the dynamic commands list inside the profile editor, wiring delete buttons. */
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
        <button class="btn btn-sm btn-danger" data-del-dyn="${i}" aria-label="Delete dynamic command ${esc(d.label)}">✕</button>
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

  /**
   * Open the command editor modal, pre-populated for an existing command or blank for a new one.
   * @param {'global'|'check'} type - Which command list to edit.
   * @param {number} index          - Index into the relevant command array, or -1 to create a new command.
   */
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
    document.getElementById('cmd-haspayloadpicker').checked = cmd.hasPayloadPicker || false;
    document.getElementById('cmd-jobsource').value = cmd.jobSource || '';
    document.getElementById('cmd-jobpickerfilter').value = cmd.jobPickerFilter || 'all';
    document.getElementById('cmd-joinmode').value = cmd.joinMode || '';
    document.getElementById('cmd-inputplaceholder').value = cmd.inputPlaceholder || '';
    document.getElementById('cmd-template').value = cmd.commandTemplate || '';
    toggleInputFields();

    document.getElementById('cmd-modal').classList.add('active');
  }

  /** Show or hide the input-related fields in the command editor based on the hasInput/hasJobPicker checkboxes. */
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

    try {
      await saveConfig();
      renderProfiles();
      document.getElementById('profile-modal').classList.remove('active');
      showStatus('Profile saved', 'success');
    } catch (err) {
      showStatus('Save failed: ' + err.message, 'error');
    }
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
      description: document.getElementById('cmd-description').value.trim() || document.getElementById('cmd-command').value.trim(),
      style: document.getElementById('cmd-style').value,
      shortcut: document.getElementById('cmd-shortcut').value.trim(),
      requireConfirm: document.getElementById('cmd-confirm').checked,
      hasInput: document.getElementById('cmd-hasinput').checked,
      hasJobPicker: document.getElementById('cmd-hasjobpicker').checked,
      jobSource: document.getElementById('cmd-jobsource').value,
      jobPickerFilter: document.getElementById('cmd-jobpickerfilter').value,
      joinMode: document.getElementById('cmd-joinmode').value,
      // Not exposed in the editor UI; carry over so editing e.g. "Rehearse All"
      // does not silently drop its expand-to-job-list behavior.
      expandRehearsalJobs: editingCmdIndex >= 0
        ? ((editingCmdTarget === 'global' ? editingProfile.globalCommands : editingProfile.checkCommands)[editingCmdIndex].expandRehearsalJobs || false)
        : false,
      hasPayloadPicker: document.getElementById('cmd-haspayloadpicker').checked,
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
      // Reload through getConfig() so schema migration runs on older imports.
      await loadConfig();
      renderGlobalSettings();
      renderProfiles();
      renderPluginSources();
      showStatus('Config imported successfully', 'success');
    } catch (err) {
      showStatus('Import failed: ' + err.message, 'error');
    }
    e.target.value = '';
  });

  document.getElementById('btn-reset').addEventListener('click', async () => {
    if (!confirm('Reset all settings to defaults? This cannot be undone.')) return;
    config = defaultConfig();
    try {
      await saveConfig();
      renderGlobalSettings();
      renderProfiles();
      renderPluginSources();
      showStatus('Reset to defaults', 'success');
    } catch (err) {
      showStatus('Reset failed: ' + err.message, 'error');
    }
  });

  // === Plugin Config Sources ===

  let editingSourceIndex = -1;

  /** Re-render the plugin config sources list from the current config, wiring all edit/delete/toggle/preset handlers. */
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
              <input type="checkbox" data-source-toggle="${i}" aria-label="Enable ${esc(s.name)}" ${s.enabled ? 'checked' : ''}>
              <span class="slider"></span>
            </span>
            <button class="btn btn-sm" data-edit-source="${i}" aria-label="Edit source ${esc(s.name)}">Edit</button>
            <button class="btn btn-sm btn-danger" data-delete-source="${i}" aria-label="Delete source ${esc(s.name)}">✕</button>
          </div>
        </div>
      `;
      container.appendChild(card);
    }

    container.querySelectorAll('[data-source-toggle]').forEach(el => {
      el.addEventListener('change', async () => {
        config.pluginConfigSources[parseInt(el.dataset.sourceToggle)].enabled = el.checked;
        try { await saveConfig(); } catch (err) { showStatus('Save failed: ' + err.message, 'error'); }
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
          try {
            await saveConfig();
            renderPluginSources();
          } catch (err) {
            showStatus('Save failed: ' + err.message, 'error');
          }
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

  /**
   * Open the plugin config source editor modal, pre-populated for an existing source or blank for a new one.
   * @param {number} index - Index into `config.pluginConfigSources`, or -1 to create a new source.
   */
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
    document.getElementById('src-presubmitspath').value = s.presubmitsBasePath || '';
    document.getElementById('src-ttl').value = s.cacheTTLMinutes || 60;
    document.getElementById('src-enabled').checked = s.enabled;
    document.getElementById('src-test-inline').className = 'status';
    document.getElementById('src-test-inline').textContent = '';
    toggleSourceFields();
    document.getElementById('source-modal').classList.add('active');
  }

  /** Show or hide path-template / file-path fields in the source editor based on the selected format. */
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
    document.getElementById('src-presubmitspath').value = preset.presubmitsBasePath || '';
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
      presubmitsBasePath: document.getElementById('src-presubmitspath').value.trim(),
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

    try {
      await saveConfig();
      renderPluginSources();
      document.getElementById('source-modal').classList.remove('active');
      showStatus('Source saved', 'success');
    } catch (err) {
      showStatus('Save failed: ' + err.message, 'error');
    }
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
  try {
    await loadConfig();
  } catch (err) {
    showStatus('Failed to load settings: ' + err.message, 'error');
    config = defaultConfig();
  }
  renderGlobalSettings();
  bindGlobalSettings();
  await renderGithubToken();
  bindGithubToken();
  renderProfiles();
  renderPluginSources();
})();
