// GitHub Bot Command Palette — Content Script
(async () => {
  const CM = GHBCP.ConfigManager;
  let config = null;
  let currentRepo = null;
  let debounceTimer = null;
  let lastPluginData = null;

  function detectRepo() {
    const match = window.location.pathname.match(/^\/([^/]+\/[^/]+)/);
    return match ? match[1] : null;
  }

  function isPRPage() {
    return /^\/[^/]+\/[^/]+\/pull\/\d+/.test(window.location.pathname);
  }

  function getPRNumber() {
    const match = window.location.pathname.match(/\/pull\/(\d+)/);
    return match ? match[1] : null;
  }

  function getGitHubTheme() {
    const html = document.documentElement;
    const mode = html.getAttribute('data-color-mode');
    if (mode === 'dark') return 'dark';
    if (mode === 'light') return 'light';
    const theme = html.getAttribute('data-dark-theme');
    if (theme && theme !== 'light') return 'dark';
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    return 'light';
  }

  function createButton(command, context) {
    const btn = document.createElement('button');
    btn.className = `ghbcp-btn ghbcp-btn-${command.style || 'neutral'}`;
    if (command._pluginDisabled) {
      btn.classList.add('ghbcp-btn-plugin-disabled');
    }
    btn.textContent = command.label;
    let tooltip = command.description + (command.shortcut ? ` (${command.shortcut})` : '');
    if (command._pluginDisabled) {
      tooltip += ' — plugin not enabled for this repo';
    }
    btn.title = tooltip;
    btn.dataset.ghbcpId = command.id;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleCommandClick(command, context, btn);
    });

    return btn;
  }

  function scrapeCheckNames() {
    const names = [];
    const seen = new Set();

    // Modern GitHub Primer React UI: section[aria-label="Checks"] > li[aria-label]
    const checksSection = document.querySelector('section[aria-label="Checks"]');
    if (checksSection) {
      const items = checksSection.querySelectorAll('li[aria-label]');
      for (const item of items) {
        const nameEl = item.querySelector('h4 a span');
        if (!nameEl) continue;
        const name = nameEl.textContent.trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const isFailed = item.querySelector('.octicon-x-circle-fill') !== null;
        const isPending = item.querySelector('.octicon-dot-fill') !== null;
        const status = isFailed ? 'failed' : isPending ? 'pending' : 'passed';
        names.push({ name, status });
      }
    }

    // Legacy GitHub UI fallback
    if (names.length === 0) {
      const rows = document.querySelectorAll(
        '.merge-status-list .merge-status-item, ' +
        '.js-merge-status-check-item, ' +
        '.merge-status-list li'
      );
      for (const row of rows) {
        const nameEl = row.querySelector('.status-actions a, .merge-status-item a, a.Link--primary, .text-bold');
        if (!nameEl) continue;
        const name = nameEl.textContent.trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const isFailed = row.querySelector('.octicon-x-circle-fill, .color-fg-danger, [data-conclusion="failure"]') ||
                         row.classList.contains('bg-danger');
        const isPending = row.querySelector('.octicon-dot-fill, .color-fg-attention, [data-conclusion="pending"]');
        const status = isFailed ? 'failed' : isPending ? 'pending' : 'passed';
        names.push({ name, status });
      }
    }

    return names;
  }

  function showTestJobPicker(command, context, anchorBtn) {
    const existing = document.querySelector('.ghbcp-job-picker');
    if (existing) existing.remove();

    const filter = command.jobPickerFilter || 'all';
    let jobs = scrapeCheckNames();
    if (filter === 'failed') {
      jobs = jobs.filter(j => j.status === 'failed');
    } else if (filter === 'pending') {
      jobs = jobs.filter(j => j.status === 'pending');
    }

    const picker = document.createElement('div');
    picker.className = 'ghbcp-job-picker';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'ghbcp-job-picker-search';
    searchInput.placeholder = 'Search jobs... (' + jobs.length + ' available)';
    picker.appendChild(searchInput);

    const list = document.createElement('div');
    list.className = 'ghbcp-job-picker-list';

    function renderJobs(filter) {
      list.innerHTML = '';
      const filtered = filter
        ? jobs.filter(j => j.name.toLowerCase().includes(filter.toLowerCase()))
        : jobs;

      if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'ghbcp-job-picker-empty';
        empty.textContent = filter ? 'No matching jobs' : 'No CI jobs found on this page';
        list.appendChild(empty);
        return;
      }

      // Sort: failed first, then pending, then passed
      const order = { failed: 0, pending: 1, passed: 2 };
      filtered.sort((a, b) => order[a.status] - order[b.status]);

      for (const job of filtered) {
        const item = document.createElement('div');
        item.className = 'ghbcp-job-picker-item';

        const dot = document.createElement('span');
        dot.className = `ghbcp-job-dot ghbcp-job-dot-${job.status}`;
        item.appendChild(dot);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'ghbcp-job-name';
        nameSpan.textContent = job.name;
        item.appendChild(nameSpan);

        item.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const template = command.commandTemplate || '/test {input}';
          const cmdText = CM.sanitizeCommand(template.replace('{input}', job.name));

          if (command.requireConfirm || config.globalSettings.confirmBeforePost) {
            if (!confirm(`Post "${cmdText}"?`)) return;
          }

          fillComment(cmdText);
          picker.remove();
        });

        list.appendChild(item);
      }
    }

    searchInput.addEventListener('input', () => renderJobs(searchInput.value));
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') picker.remove();
      if (e.key === 'Enter') {
        const firstItem = list.querySelector('.ghbcp-job-picker-item');
        if (firstItem) firstItem.click();
      }
    });

    picker.appendChild(list);
    renderJobs('');

    // Close on outside click
    function onClickOutside(e) {
      if (!picker.contains(e.target) && e.target !== anchorBtn) {
        picker.remove();
        document.removeEventListener('click', onClickOutside);
      }
    }
    setTimeout(() => document.addEventListener('click', onClickOutside), 0);

    anchorBtn.parentElement.style.position = 'relative';
    anchorBtn.parentElement.appendChild(picker);

    requestAnimationFrame(() => searchInput.focus());
  }

  function handleCommandClick(command, context, btn) {
    if (command.hasJobPicker) {
      showTestJobPicker(command, context, btn);
      return;
    }
    if (command.hasInput) {
      showInputPopover(command, context, btn);
      return;
    }

    let cmdText = CM.sanitizeCommand(command.command);
    if (context && context.testName && command.commandTemplate) {
      cmdText = command.commandTemplate.replace('{input}', context.testName);
    }

    if (command.requireConfirm || config.globalSettings.confirmBeforePost) {
      if (!confirm(`Post "${cmdText}"?`)) return;
    }

    fillComment(cmdText);
  }

  function showInputPopover(command, context, anchorBtn) {
    const existing = document.querySelector('.ghbcp-popover');
    if (existing) existing.remove();

    const popover = document.createElement('div');
    popover.className = 'ghbcp-popover';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ghbcp-popover-input';
    input.placeholder = command.inputPlaceholder || 'Enter value...';
    if (context && context.testName) {
      input.value = context.testName;
    }

    const postBtn = document.createElement('button');
    postBtn.className = 'ghbcp-btn ghbcp-btn-primary ghbcp-popover-post';
    postBtn.textContent = 'Post';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'ghbcp-btn ghbcp-btn-neutral ghbcp-popover-cancel';
    cancelBtn.textContent = '✕';

    function doPost() {
      const val = input.value.trim();
      if (!val) return;
      const template = command.commandTemplate || (command.command + ' {input}');
      const cmdText = CM.sanitizeCommand(template.replace('{input}', val));

      if (command.requireConfirm || config.globalSettings.confirmBeforePost) {
        if (!confirm(`Post "${cmdText}"?`)) return;
      }

      fillComment(cmdText);
      popover.remove();
    }

    postBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      doPost();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doPost();
      }
      if (e.key === 'Escape') {
        popover.remove();
      }
    });

    cancelBtn.addEventListener('click', (e) => {
      e.preventDefault();
      popover.remove();
    });

    popover.appendChild(input);
    popover.appendChild(postBtn);
    popover.appendChild(cancelBtn);

    anchorBtn.parentElement.style.position = 'relative';
    anchorBtn.parentElement.appendChild(popover);

    requestAnimationFrame(() => input.focus());
  }

  function fillComment(cmdText) {
    const textarea = findCommentTextarea();
    if (!textarea) {
      showToast('No comment box found', 'error');
      return;
    }

    textarea.focus();
    textarea.value = cmdText;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));

    if (config.globalSettings.autoSubmit) {
      setTimeout(() => {
        const submitBtn = findSubmitButton(textarea);
        if (submitBtn) {
          submitBtn.click();
          showToast(`Posted ${cmdText}`, 'success');
        } else {
          showToast(`Filled: ${cmdText} (submit manually)`, 'warning');
        }
      }, 100);
    } else {
      showToast(`Filled: ${cmdText}`, 'success');
    }
  }

  function findCommentTextarea() {
    // If a modal review dialog is open, prefer its textarea
    const reviewDialog = document.querySelector('div[role="dialog"][aria-modal="true"]');
    if (reviewDialog) {
      const ta = reviewDialog.querySelector('textarea');
      if (ta) return ta;
    }

    // Prefer the main bottom-of-PR comment field
    const mainField = document.getElementById('new_comment_field');
    if (mainField) return mainField;

    // Fallback: look for visible comment textareas in the new-comment form
    const selectors = [
      '.js-new-comment-form textarea[name="comment[body]"]',
      '.discussion-timeline-actions textarea[name="comment[body]"]',
      'textarea.js-comment-field',
      'file-attachment textarea'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  }

  function findSubmitButton(textarea) {
    // Review dialog submit button
    const dialog = textarea.closest('div[role="dialog"][aria-modal="true"]');
    if (dialog) {
      const btn = dialog.querySelector('button[data-variant="primary"]:not([disabled])');
      if (btn) return btn;
    }

    const form = textarea.closest('form');
    if (form) {
      const btn = form.querySelector('button[type="submit"]:not([disabled]), button.btn-primary[type="submit"]');
      if (btn) return btn;
    }
    const selectors = [
      'button[data-disable-with="Comment"]',
      'button.btn-primary[type="submit"]',
      '.js-new-comment-form button[type="submit"]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function showToast(message, type) {
    const existing = document.querySelector('.ghbcp-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `ghbcp-toast ghbcp-toast-${type || 'success'}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('ghbcp-toast-show'));

    setTimeout(() => {
      toast.classList.remove('ghbcp-toast-show');
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  function injectGlobalCommandBar(profiles, extraCommands) {
    const existing = document.querySelector('.ghbcp-command-bar');
    if (existing) existing.remove();

    const textarea = findCommentTextarea();

    const bar = document.createElement('div');
    bar.className = 'ghbcp-command-bar';
    bar.dataset.ghbcpInjected = 'true';

    const theme = getGitHubTheme();
    bar.dataset.theme = theme;

    const header = document.createElement('div');
    header.className = 'ghbcp-bar-header';

    const headerLeft = document.createElement('span');
    headerLeft.innerHTML = '<span class="ghbcp-bar-icon">&#129302;</span> <span class="ghbcp-bar-title">Bot Commands</span>';
    header.appendChild(headerLeft);

    const headerRight = document.createElement('span');
    headerRight.className = 'ghbcp-bar-actions';

    if (lastPluginData) {
      if (lastPluginData.cachedAt) {
        const ago = Math.round((Date.now() - lastPluginData.cachedAt) / 60000);
        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'ghbcp-refresh-btn';
        refreshBtn.innerHTML = '&#8635;';
        refreshBtn.title = `Refresh plugin config (cached ${ago} min ago)`;
        refreshBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!CM.isContextValid()) return;
          refreshBtn.classList.add('ghbcp-spinning');
          try {
            await chrome.runtime.sendMessage({ action: 'refreshPlugins', repo: currentRepo });
          } catch (err) { /* ignore */ }
          refreshBtn.classList.remove('ghbcp-spinning');
          inject();
        });
        headerRight.appendChild(refreshBtn);
      }

      if (lastPluginData.configFileUrl) {
        const configLink = document.createElement('a');
        configLink.className = 'ghbcp-config-link';
        configLink.href = lastPluginData.configFileUrl;
        configLink.target = '_blank';
        configLink.rel = 'noopener';
        configLink.innerHTML = '&#9881;';
        configLink.title = 'Edit plugin config on GitHub';
        headerRight.appendChild(configLink);
      }
    }

    header.appendChild(headerRight);
    bar.appendChild(header);

    for (const profile of profiles) {
      if (profile.globalCommands.length === 0) continue;

      const group = document.createElement('div');
      group.className = 'ghbcp-cmd-group';

      const groupLabel = document.createElement('span');
      groupLabel.className = 'ghbcp-group-label';
      groupLabel.textContent = profile.name;
      group.appendChild(groupLabel);

      const btnWrap = document.createElement('div');
      btnWrap.className = 'ghbcp-btn-wrap';

      for (const cmd of profile.globalCommands) {
        btnWrap.appendChild(createButton(cmd, { repoName: currentRepo, prNumber: getPRNumber() }));
      }

      group.appendChild(btnWrap);
      bar.appendChild(group);
    }

    if (extraCommands.length > 0) {
      const group = document.createElement('div');
      group.className = 'ghbcp-cmd-group';
      const groupLabel = document.createElement('span');
      groupLabel.className = 'ghbcp-group-label';
      groupLabel.textContent = 'Repo Overrides';
      group.appendChild(groupLabel);

      const btnWrap = document.createElement('div');
      btnWrap.className = 'ghbcp-btn-wrap';
      for (const cmd of extraCommands) {
        btnWrap.appendChild(createButton(cmd, { repoName: currentRepo, prNumber: getPRNumber() }));
      }
      group.appendChild(btnWrap);
      bar.appendChild(group);
    }

    if (textarea) {
      const container = textarea.closest('.js-new-comment-form') ||
                        textarea.closest('form') ||
                        textarea.parentElement;
      if (container) {
        container.insertBefore(bar, container.firstChild);
        return;
      }
    }

    // Fallback: inject at top of discussion timeline or PR body
    const fallback = document.querySelector('.js-discussion, .pull-discussion-timeline, #discussion_bucket, .container-xl');
    if (fallback) {
      fallback.insertBefore(bar, fallback.firstChild);
    } else {
      document.body.insertBefore(bar, document.body.firstChild);
    }
  }

  function injectCheckButtons(profiles) {
    let checkRows = [];

    // Modern GitHub UI
    const checksSection = document.querySelector('section[aria-label="Checks"]');
    if (checksSection) {
      checkRows = checksSection.querySelectorAll('li[aria-label]');
    }

    // Legacy fallback
    if (checkRows.length === 0) {
      checkRows = document.querySelectorAll(
        '.merge-status-list .merge-status-item, ' +
        '.js-merge-status-check-item, ' +
        '.merge-status-list li'
      );
    }

    for (const row of checkRows) {
      if (row.dataset.ghbcpInjected === 'true') continue;

      const isFailed = row.querySelector('.octicon-x-circle-fill') !== null ||
                       row.querySelector('.color-fg-danger, [data-conclusion="failure"]') !== null;

      if (!isFailed) continue;

      const nameEl = row.querySelector('h4 a span') ||
                     row.querySelector('.status-actions a, .merge-status-item a, a.Link--primary, .text-bold');
      const checkName = nameEl ? nameEl.textContent.trim() : '';
      if (!checkName) continue;

      row.dataset.ghbcpInjected = 'true';

      const btnContainer = document.createElement('span');
      btnContainer.className = 'ghbcp-check-btns';

      const context = {
        testName: checkName,
        checkName,
        repoName: currentRepo,
        prNumber: getPRNumber()
      };

      for (const profile of profiles) {
        for (const cmd of profile.checkCommands) {
          btnContainer.appendChild(createButton(cmd, context));
        }

        for (const dyn of profile.dynamicCommands) {
          if (dyn.injectAt === 'failed-checks') {
            try {
              const dynCmd = {
                id: dyn.id + '-' + checkName,
                label: dyn.label,
                command: new Function('testName', 'checkName', 'repoName', 'prNumber',
                  'return ' + dyn.commandExpression)(
                  context.testName, context.checkName, context.repoName, context.prNumber
                ),
                description: `${dyn.label}: ${checkName}`,
                style: dyn.style,
                requireConfirm: false,
                hasInput: false
              };
              btnContainer.appendChild(createButton(dynCmd, context));
            } catch (e) {
              // skip malformed dynamic command
            }
          }
        }
      }

      if (btnContainer.children.length > 0) {
        row.appendChild(btnContainer);
      }
    }
  }

  function injectReviewToolbar(profiles) {
    const isFilesTab = window.location.pathname.includes('/files') ||
                       document.querySelector('.js-diff-progressive-container');
    if (!isFilesTab) return;

    if (document.querySelector('.ghbcp-review-toolbar')) return;

    const reviewForm = document.querySelector('.js-reviews-container, #review-changes-modal, .pull-request-review-menu');
    if (!reviewForm) return;

    const toolbar = document.createElement('div');
    toolbar.className = 'ghbcp-review-toolbar';
    toolbar.dataset.ghbcpInjected = 'true';

    const approveCommands = [];
    for (const profile of profiles) {
      for (const cmd of profile.globalCommands) {
        if (['/lgtm', '/approve'].includes(cmd.command)) {
          approveCommands.push(cmd);
        }
      }
    }

    if (approveCommands.length === 0) return;

    for (const cmd of approveCommands) {
      toolbar.appendChild(createButton(cmd, { repoName: currentRepo, prNumber: getPRNumber() }));
    }

    reviewForm.parentElement.insertBefore(toolbar, reviewForm);
  }

  function injectReviewDialogBar(profiles, extraCommands) {
    const dialog = document.querySelector('div[role="dialog"][aria-modal="true"]');
    if (!dialog) return;
    if (dialog.querySelector('.ghbcp-command-bar')) return;

    const textarea = dialog.querySelector('textarea');
    if (!textarea) return;

    const bar = document.createElement('div');
    bar.className = 'ghbcp-command-bar';
    bar.dataset.ghbcpInjected = 'true';
    bar.style.margin = '0 0 8px 0';

    const header = document.createElement('div');
    header.className = 'ghbcp-bar-header';
    header.innerHTML = '<span><span class="ghbcp-bar-icon">&#129302;</span> <span class="ghbcp-bar-title">Bot Commands</span></span>';
    bar.appendChild(header);

    for (const profile of profiles) {
      if (profile.globalCommands.length === 0) continue;
      const group = document.createElement('div');
      group.className = 'ghbcp-cmd-group';
      const groupLabel = document.createElement('span');
      groupLabel.className = 'ghbcp-group-label';
      groupLabel.textContent = profile.name;
      group.appendChild(groupLabel);

      const btnWrap = document.createElement('div');
      btnWrap.className = 'ghbcp-btn-wrap';
      for (const cmd of profile.globalCommands) {
        btnWrap.appendChild(createButton(cmd, { repoName: currentRepo, prNumber: getPRNumber() }));
      }
      group.appendChild(btnWrap);
      bar.appendChild(group);
    }

    if (extraCommands.length > 0) {
      const group = document.createElement('div');
      group.className = 'ghbcp-cmd-group';
      const btnWrap = document.createElement('div');
      btnWrap.className = 'ghbcp-btn-wrap';
      for (const cmd of extraCommands) {
        btnWrap.appendChild(createButton(cmd, { repoName: currentRepo, prNumber: getPRNumber() }));
      }
      group.appendChild(btnWrap);
      bar.appendChild(group);
    }

    const fieldset = textarea.closest('fieldset');
    if (fieldset && fieldset.parentElement) {
      fieldset.parentElement.insertBefore(bar, fieldset);
    } else {
      const container = textarea.parentElement;
      container.insertBefore(bar, container.firstChild);
    }
  }

  function registerShortcuts(profiles) {
    document.removeEventListener('keydown', handleShortcut);
    window._ghbcpShortcutMap = {};

    for (const profile of profiles) {
      for (const cmd of profile.globalCommands) {
        if (cmd.shortcut) {
          window._ghbcpShortcutMap[cmd.shortcut.toLowerCase()] = cmd;
        }
      }
    }

    document.addEventListener('keydown', handleShortcut);
  }

  function handleShortcut(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

    const parts = [];
    if (e.altKey) parts.push('alt');
    if (e.ctrlKey) parts.push('ctrl');
    if (e.shiftKey) parts.push('shift');
    if (e.metaKey) parts.push('meta');
    parts.push(e.key.toLowerCase());
    const combo = parts.join('+');

    const cmd = window._ghbcpShortcutMap[combo];
    if (cmd) {
      e.preventDefault();
      handleCommandClick(cmd, { repoName: currentRepo, prNumber: getPRNumber() }, null);
    }
  }

  async function inject() {
    if (!CM.isContextValid()) return;
    if (!isPRPage()) return;

    config = await CM.getConfig();
    if (!config.globalSettings.enabled) return;

    currentRepo = detectRepo();
    if (!currentRepo) return;

    let profiles = CM.getMatchingProfiles(config, currentRepo);
    if (profiles.length === 0) return;

    const filterMode = config.globalSettings.pluginFilterMode || 'disabled';
    const hasSources = config.pluginConfigSources && config.pluginConfigSources.some(s => s.enabled);

    if (filterMode !== 'disabled' && hasSources && CM.isContextValid()) {
      try {
        const response = await chrome.runtime.sendMessage({
          action: 'getEnabledPlugins',
          repo: currentRepo
        });
        if (response) {
          lastPluginData = response;
          if (response.plugins) {
            profiles = CM.filterCommandsByPlugins(profiles, response.plugins, filterMode);
          }
        }
      } catch (e) {
        lastPluginData = null;
      }
    } else {
      lastPluginData = null;
    }

    const extraCommands = CM.getExtraCommands(config, currentRepo);

    injectGlobalCommandBar(profiles, extraCommands);
    injectCheckButtons(profiles);
    injectReviewToolbar(profiles);
    injectReviewDialogBar(profiles, extraCommands);
    registerShortcuts(profiles);
  }

  function debouncedInject() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(inject, 50);
  }

  // Initial injection
  inject();

  // SPA navigation listeners
  document.addEventListener('turbo:load', debouncedInject);
  document.addEventListener('pjax:end', debouncedInject);
  window.addEventListener('popstate', debouncedInject);
  window.addEventListener('hashchange', debouncedInject);

  // MutationObserver for dynamic content
  const observer = new MutationObserver(mutations => {
    if (!CM.isContextValid()) {
      observer.disconnect();
      return;
    }
    let shouldReinject = false;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1) {
          if (node.querySelector && (
            node.querySelector('textarea') ||
            node.querySelector('.merge-status-list') ||
            node.matches && node.matches('.merge-status-item, .js-merge-status-check-item') ||
            node.matches && node.matches('div[role="dialog"]') ||
            node.querySelector('div[role="dialog"]')
          )) {
            shouldReinject = true;
            break;
          }
        }
      }
      if (shouldReinject) break;
    }
    if (shouldReinject) debouncedInject();
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();
