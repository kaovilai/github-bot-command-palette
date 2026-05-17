// GitHub Bot Command Palette — Popup
(async () => {
  const CM = GHBCP.ConfigManager;
  const esc = CM.escapeHtml;
  const contentDiv = document.getElementById('content');
  let currentTab = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;
  } catch (e) {
    // no tab access
  }

  const config = await CM.getConfig();
  if (!config) {
    contentDiv.innerHTML = '<div class="repo-info"><span class="no-pr">No configuration found. Open settings to initialize.</span></div>';
    document.getElementById('open-settings').addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
    return;
  }

  let repoName = null;
  let isPR = false;

  if (currentTab && currentTab.url) {
    const match = currentTab.url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/\d+/);
    if (match) {
      repoName = match[1];
      isPR = true;
    } else {
      const repoMatch = currentTab.url.match(/github\.com\/([^/]+\/[^/]+)/);
      if (repoMatch) repoName = repoMatch[1];
    }
  }

  let html = '<div class="repo-info">';
  if (repoName) {
    html += `<span class="repo-name">${esc(repoName)}</span>`;
    if (isPR) {
      html += ' <span class="status-pr">● PR page</span>';
    } else {
      html += ' <span class="no-pr">(not a PR page)</span>';
    }
  } else {
    html += '<span class="no-pr">Not on a GitHub page</span>';
  }
  html += '</div>';

  if (repoName && config.profiles) {
    const repoOverrides = config.repoOverrides || [];
    const overrides = repoOverrides.filter(o => CM.globMatch(o.pattern, repoName));
    const disabledByOverride = new Set(overrides.flatMap(o => o.disabledProfiles || []));
    const matched = config.profiles.filter(p =>
      !disabledByOverride.has(p.id) &&
      p.repoPatterns.some(pat => CM.globMatch(pat, repoName))
    );

    if (matched.length > 0) {
      html += '<div class="profiles-heading">Matched Profiles:</div>';
      for (const p of matched) {
        html += `<div class="profile-item">
          <span>${esc(p.name)}</span>
          <span class="toggle">
            <input type="checkbox" data-pid="${p.id}" aria-label="Enable ${esc(p.name)}" ${p.enabled ? 'checked' : ''}>
            <span class="slider"></span>
          </span>
        </div>`;
      }

      const allCmds = matched.filter(p => p.enabled).flatMap(p => p.globalCommands);
      if (allCmds.length > 0) {
        html += '<div class="cmd-preview"><h3>Available Commands</h3><div class="cmd-list">';
        for (const c of allCmds) {
          html += `<span class="cmd-tag">${esc(c.command)}</span>`;
        }
        html += '</div></div>';
      }
    } else {
      html += '<div class="no-profiles">No profiles match this repo</div>';
    }

    // Plugin config status
    if (isPR && config.pluginConfigSources && config.pluginConfigSources.some(s => s.enabled)) {
      try {
        const pluginResp = await chrome.runtime.sendMessage({ action: 'getEnabledPlugins', repo: repoName });
        if (pluginResp && pluginResp.plugins) {
          const ago = pluginResp.cachedAt ? Math.round((Date.now() - pluginResp.cachedAt) / 60000) : '?';
          html += `<div class="plugin-status">
            Plugin config: ${pluginResp.plugins.length} plugins enabled (cached ${ago}m ago)
            ${pluginResp.configFileUrl ? ` · <a href="${esc(pluginResp.configFileUrl)}" target="_blank" class="plugin-link">Edit</a>` : ''}
          </div>`;
        } else {
          html += '<div class="plugin-status-msg">Plugin config: not found for this repo</div>';
        }
      } catch (e) {
        html += '<div class="plugin-status-msg">Plugin config: unavailable</div>';
      }
    }
  }

  contentDiv.innerHTML = html;

  contentDiv.querySelectorAll('[data-pid]').forEach(el => {
    el.addEventListener('change', async () => {
      const pid = el.dataset.pid;
      const profile = config.profiles.find(p => p.id === pid);
      if (profile) {
        profile.enabled = el.checked;
        await CM.saveConfig(config);
      }
    });
  });

  document.getElementById('open-settings').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
})();
