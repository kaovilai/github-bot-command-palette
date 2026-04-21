// GitHub Bot Command Palette — Popup
(async () => {
  const STORAGE_KEY = 'ghbcp_config';
  const contentDiv = document.getElementById('content');

  function globMatch(pattern, str) {
    if (pattern === '*') return true;
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp('^' + escaped.replace(/\*/g, '.*') + '$');
    return regex.test(str);
  }

  async function getConfig() {
    return new Promise(resolve => {
      chrome.storage.sync.get(STORAGE_KEY, result => resolve(result[STORAGE_KEY] || null));
    });
  }

  async function saveConfig(config) {
    return new Promise(resolve => {
      chrome.storage.sync.set({ [STORAGE_KEY]: config }, resolve);
    });
  }

  let currentTab = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;
  } catch (e) {
    // no tab access
  }

  const config = await getConfig();
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
    html += `<span class="repo-name">${repoName}</span>`;
    if (isPR) {
      html += ' <span style="font-size:11px;color:var(--success)">● PR page</span>';
    } else {
      html += ' <span class="no-pr">(not a PR page)</span>';
    }
  } else {
    html += '<span class="no-pr">Not on a GitHub page</span>';
  }
  html += '</div>';

  if (repoName && config.profiles) {
    const matched = config.profiles.filter(p =>
      p.repoPatterns.some(pat => globMatch(pat, repoName))
    );

    if (matched.length > 0) {
      html += '<div style="margin-bottom:8px;font-size:12px;color:var(--text-muted)">Matched Profiles:</div>';
      for (const p of matched) {
        html += `<div class="profile-item">
          <span>${p.name}</span>
          <span class="toggle">
            <input type="checkbox" data-pid="${p.id}" ${p.enabled ? 'checked' : ''}>
            <span class="slider"></span>
          </span>
        </div>`;
      }

      const allCmds = matched.filter(p => p.enabled).flatMap(p => p.globalCommands);
      if (allCmds.length > 0) {
        html += '<div class="cmd-preview"><h3>Available Commands</h3><div class="cmd-list">';
        for (const c of allCmds) {
          html += `<span class="cmd-tag">${c.command}</span>`;
        }
        html += '</div></div>';
      }
    } else {
      html += '<div style="font-size:12px;color:var(--text-muted);margin-top:4px">No profiles match this repo</div>';
    }

    // Plugin config status
    if (isPR && config.pluginConfigSources && config.pluginConfigSources.some(s => s.enabled)) {
      try {
        const pluginResp = await chrome.runtime.sendMessage({ action: 'getEnabledPlugins', repo: repoName });
        if (pluginResp && pluginResp.plugins) {
          const ago = pluginResp.cachedAt ? Math.round((Date.now() - pluginResp.cachedAt) / 60000) : '?';
          html += `<div style="font-size:11px;color:var(--text-muted);margin-top:8px;padding:6px;background:var(--bg2);border-radius:4px">
            Plugin config: ${pluginResp.plugins.length} plugins enabled (cached ${ago}m ago)
            ${pluginResp.configFileUrl ? ` · <a href="${pluginResp.configFileUrl}" target="_blank" style="color:var(--primary)">Edit</a>` : ''}
          </div>`;
        } else {
          html += '<div style="font-size:11px;color:var(--text-muted);margin-top:8px">Plugin config: not found for this repo</div>';
        }
      } catch (e) {
        html += '<div style="font-size:11px;color:var(--text-muted);margin-top:8px">Plugin config: unavailable</div>';
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
        await saveConfig(config);
      }
    });
  });

  document.getElementById('open-settings').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
})();
