// GitHub Bot Command Palette — Content Script

// Shared selectors used by both scrapeCheckNames() and injectCheckButtons()
// to keep status detection and DOM queries consistent in one place.
const CHECKS_SECTION_SELECTOR = 'section[aria-label="Checks"]';

// Monotonic counter for generating unique ARIA label IDs within the page,
// avoiding the (unlikely but non-zero) collision risk of Math.random().
let _ghbcpGroupIdCounter = 0;
const LEGACY_CHECK_ROW_SELECTOR =
  '.merge-status-list .merge-status-item, ' +
  '.js-merge-status-check-item, ' +
  '.merge-status-list li';

// Matches a GitHub Actions run/job link, e.g.
// "/openshift/velero/actions/runs/31753380458/job/94624504231?pr=562".
const ACTIONS_RUN_JOB_HREF_RE = /\/actions\/runs\/(\d+)\/job\/(\d+)/;

/**
 * Extract the workflow run ID and job ID from a check row's own link. These
 * are the IDs the GitHub Actions rerun REST API needs
 * (`POST /repos/{repo}/actions/jobs/{jobId}/rerun`) — already present in the
 * DOM, so no extra API call is needed to resolve them. Pure function, no
 * chrome/DOM globals touched — kept top-level (outside the content-script
 * IIFE) so it's trivial to test in isolation.
 * @param {string|null|undefined} href - A check row's anchor href (relative or absolute).
 * @returns {{runId: string, jobId: string}|null} The parsed IDs, or null if `href` isn't an Actions run/job link.
 */
function parseActionsRunJobIds(href) {
  if (!href) return null;
  const match = href.match(ACTIONS_RUN_JOB_HREF_RE);
  return match ? { runId: match[1], jobId: match[2] } : null;
}

(async () => {
  const CM = GHBCP.ConfigManager;
  let config = null;
  let currentRepo = null;
  let debounceTimer = null;
  let lastPluginData = null;
  let lastPresubmitJobs = null;
  let lastGithubToken = null;
  let lastRehearsalJobsUrl = null;
  let lastRehearsalJobs = null;
  let lastRepoBranches = null;
  let lastRepoBranchesRepo = null;
  let shortcutMap = {};

  /** @returns {string|null} Full `org/repo` path extracted from the current URL, or null. */
  function detectRepo() {
    const match = window.location.pathname.match(/^\/([^/]+\/[^/]+)/);
    return match ? match[1] : null;
  }

  /** @returns {boolean} True when the current page is a GitHub pull-request page. */
  function isPRPage() {
    return /^\/[^/]+\/[^/]+\/pull\/\d+/.test(window.location.pathname);
  }

  /** @returns {string|null} PR number string extracted from the URL, or null if not on a PR page. */
  function getPRNumber() {
    const match = window.location.pathname.match(/\/pull\/(\d+)/);
    return match ? match[1] : null;
  }

  /**
   * Detect the base branch of the current PR by querying the DOM.
   * GitHub's PR header always renders "<author> wants to merge N commits into
   * <base> from <head>", with the base link appearing first and always
   * pointing at the current repo (the head may be on a fork). Filtering
   * `/tree/` links to the current repo's prefix and taking the first match
   * yields the base branch reliably without depending on GitHub's
   * frequently-changing generated CSS class names.
   *
   * `.base-ref`/`.commit-ref` (previously used here) no longer match the base
   * branch on the modern Primer React PR header: `.commit-ref` in particular
   * belongs to unrelated "force-pushed the X branch" timeline events and
   * resolves to the *head* branch, which 404s against openshift/release's
   * presubmits config and silently falls back to raw (unresolved) check names.
   * @returns {string|null} Branch name, or null if the page does not expose it.
   */
  function detectTargetBranch() {
    const repo = detectRepo();
    if (repo) {
      const prefix = `/${repo}/tree/`;
      const treeLink = Array.from(document.querySelectorAll('a[href]'))
        .find(a => a.getAttribute('href').startsWith(prefix));
      if (treeLink) {
        const branch = treeLink.getAttribute('href').slice(prefix.length);
        if (branch) return decodeURIComponent(branch);
      }
    }
    // Legacy fallback for older GitHub UI layouts
    const baseRef = document.querySelector('.base-ref a, .base-ref span.css-truncate-target');
    if (baseRef) return baseRef.textContent.trim();
    return null;
  }

  /**
   * Create an accessible button element for a slash command.
   * @param {Object} command - Command descriptor (id, label, style, description, shortcut, _pluginDisabled).
   * @param {Object} context - Contextual data passed to the click handler (repoName, prNumber, testName, etc.).
   * @returns {HTMLButtonElement}
   */
  function createButton(command, context) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `ghbcp-btn ghbcp-btn-${command.style || 'neutral'}`;
    if (command._pluginDisabled) {
      btn.classList.add('ghbcp-btn-plugin-disabled');
    }
    btn.textContent = command.label;
    let tooltip = (command.description || command.command || command.label || '') + (command.shortcut ? ` (${command.shortcut})` : '');
    if (command._pluginDisabled) {
      tooltip += ' — plugin not enabled for this repo';
    }
    btn.title = tooltip;
    btn.setAttribute('aria-label', tooltip);
    btn.dataset.ghbcpId = command.id;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleCommandClick(command, context, btn);
    });

    return btn;
  }

  /**
   * Stand-in for the "Test" button on checks Prow doesn't own (e.g. a plain
   * GitHub Actions matrix job). /test can't reach these — Prow only reruns
   * jobs it defines — so link to the check's own run page instead, where
   * GitHub's native "Re-run jobs" / "Re-run failed jobs" button can retrigger
   * it. That button itself needs *write* access to the repo (the reason Prow's
   * /test-comment convention exists in the first place — so contributors
   * without write access can still trigger CI), so it's often greyed out or
   * missing entirely for non-maintainers on org-gated repos like openshift/*;
   * the tooltip calls that out explicitly rather than assuming the link
   * always works. The tooltip is the tip; the link is a convenience.
   *
   * Used as a fallback by `createRerunActionButton()` when no GitHub token is
   * configured (or the row's run/job IDs can't be parsed) — the safe,
   * zero-setup default.
   * @param {string} checkName
   * @param {Element} row - The check row, used to find its run-page link.
   * @returns {HTMLAnchorElement}
   */
  function createRerunHintButton(checkName, row) {
    const runLink = row.querySelector('h4 a, .status-actions a, .merge-status-item a, a.Link--primary');
    const el = document.createElement('a');
    el.className = 'ghbcp-btn ghbcp-btn-neutral';
    el.textContent = 'Rerun?';
    const tip = 'Not a Prow job — /test can\'t reach it (Prow only reruns jobs it owns). ' +
      'Try GitHub\'s own "Re-run jobs" / "Re-run failed jobs" on its run (opened by this link) — ' +
      'that needs write access to the repo, so it may be greyed out or missing without it. ' +
      'Configure a GitHub token in Settings to turn this into a one-click Rerun. ' +
      'Or use /override (next to this) to unblock a Tide-blocked merge.';
    el.title = tip;
    el.setAttribute('aria-label', checkName + ': ' + tip);
    if (runLink && runLink.href) {
      el.href = runLink.href;
      el.target = '_blank';
      el.rel = 'noopener noreferrer';
    } else {
      el.href = '#';
      el.addEventListener('click', (e) => e.preventDefault());
    }
    return el;
  }

  /**
   * Map a `rerunActionsJob`/`rerunFailedActionsJobs` error code to a
   * user-facing message.
   * @param {string|undefined} error
   * @returns {string}
   */
  function rerunErrorMessage(error) {
    switch (error) {
      case 'no-token': return 'No GitHub token configured — add one in Settings to enable rerun';
      case 'forbidden': return 'Token lacks Actions write access to this repo';
      case 'not-found': return 'Job not found (GitHub Actions runs are rerunnable for 30 days)';
      default: return 'Rerun failed: ' + (error || 'unknown error');
    }
  }

  /**
   * "Rerun" button for checks Prow doesn't own. When a GitHub token is
   * configured (Settings) and the row's run/job IDs parse from its own link,
   * this is a real one-click action: `POST /repos/{repo}/actions/jobs/{jobId}/rerun`
   * via background.js, gated behind a confirm() since it's a real
   * side-effecting action (spends CI minutes) rather than posting a comment.
   * Falls back to `createRerunHintButton()` (a link, no token needed) when
   * either is missing — the safe, zero-setup default.
   * @param {string} checkName
   * @param {Element} row - The check row, used to find its run-page link.
   * @param {Object} context - `{repoName, prNumber, ...}` for this check.
   * @returns {HTMLAnchorElement|HTMLButtonElement}
   */
  function createRerunActionButton(checkName, row, context) {
    const runLink = row.querySelector('h4 a, .status-actions a, .merge-status-item a, a.Link--primary');
    const ids = runLink ? parseActionsRunJobIds(runLink.getAttribute('href')) : null;
    if (!ids || !lastGithubToken) {
      return createRerunHintButton(checkName, row);
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ghbcp-btn ghbcp-btn-neutral';
    btn.textContent = 'Rerun';
    const tip = 'Rerun "' + checkName + '" via the GitHub Actions API — not a Prow job, so /test can\'t reach it. ' +
      'Uses your configured token and consumes CI minutes.';
    btn.title = tip;
    btn.setAttribute('aria-label', tip);
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!window.confirm(
        'Rerun "' + checkName + '" via GitHub Actions?\n\n' +
        'This uses your configured token and consumes CI minutes.'
      )) return;
      try {
        const resp = await chrome.runtime.sendMessage({
          action: 'rerunActionsJob',
          repo: context.repoName,
          runId: ids.runId,
          jobId: ids.jobId
        });
        if (resp && resp.success) {
          showToast('Rerun triggered for ' + checkName, 'success');
        } else {
          showToast(rerunErrorMessage(resp && resp.error), 'error');
        }
      } catch (err) {
        showToast('Failed to reach the extension background — try reloading the page', 'error');
      }
    });
    return btn;
  }

  /**
   * Determine the CI status of a check row element by inspecting its icon classes
   * and data-conclusion attributes. Used by both scrapeCheckNames() and injectCheckButtons()
   * to keep status detection consistent in one place.
   *
   * GitHub check-run conclusions: failure, timed_out, action_required → failed
   *                               cancelled, stale               → pending (amber)
   *                               success, neutral, skipped      → passed (green)
   * @param {Element} element - A check row or list item element.
   * @returns {'failed'|'pending'|'passed'}
   */
  function getCheckStatus(element) {
    const isFailed = element.querySelector('.octicon-x-circle-fill') !== null ||
                     element.querySelector('.color-fg-danger, [data-conclusion="failure"], [data-conclusion="timed_out"], [data-conclusion="action_required"]') !== null ||
                     element.classList.contains('bg-danger');
    if (isFailed) return 'failed';
    // cancelled = manually stopped (should be re-run); stale = deadline exceeded without result
    const isPending = element.querySelector('.octicon-dot-fill') !== null ||
                      element.querySelector('.color-fg-attention, [data-conclusion="pending"], [data-conclusion="cancelled"], [data-conclusion="stale"]') !== null;
    return isPending ? 'pending' : 'passed';
  }

  /**
   * Look up `checkName` against the scraped presubmit config (`lastPresubmitJobs`),
   * matching on either Prow's status context ("ci/prow/images") or the full
   * prowjob name ("pull-ci-...-images") — a check row may surface either.
   * Shared by `scrapeCheckNames()` and `injectCheckButtons()` so "is this
   * check Prow-managed" is decided the same way in both places.
   * @param {string} checkName
   * @returns {Object|null} The matching presubmit job entry, or null.
   */
  function matchPresubmitJob(checkName) {
    if (!lastPresubmitJobs) return null;
    return lastPresubmitJobs.find(
      j => j.context === checkName || j.jobName === checkName
    ) || null;
  }

  /**
   * Whether Prow itself owns `checkName` (so `/test`/rerunning it as a
   * ProwJob makes sense), vs. it being a plain GitHub Actions check Prow has
   * no knowledge of. When the presubmit list hasn't loaded, assumes
   * Prow-managed (matches `injectCheckButtons()`'s best-effort default before
   * `lastPresubmitJobs` resolves).
   * @param {string} checkName
   * @returns {boolean}
   */
  function isProwManagedCheck(checkName) {
    return !lastPresubmitJobs ||
      checkName.startsWith('ci/prow/') ||
      matchPresubmitJob(checkName) !== null;
  }

  /**
   * Scrape CI check names and statuses from the current PR page.
   * Supports both the modern Primer React UI and the legacy merge-status UI.
   * @returns {{name: string, status: 'failed'|'pending'|'passed', isProwManaged: boolean, runId: string|null, jobId: string|null}[]}
   */
  function scrapeCheckNames() {
    const names = [];
    const seen = new Set();

    // Modern GitHub Primer React UI: section[aria-label="Checks"] > li[aria-label]
    const checksSection = document.querySelector(CHECKS_SECTION_SELECTOR);
    if (checksSection) {
      const items = checksSection.querySelectorAll('li[aria-label]');
      for (const item of items) {
        const nameEl = item.querySelector('h4 a span');
        if (!nameEl) continue;
        const name = nameEl.textContent.trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const linkEl = item.querySelector('h4 a');
        const ids = linkEl ? parseActionsRunJobIds(linkEl.getAttribute('href')) : null;
        names.push({
          name,
          status: getCheckStatus(item),
          isProwManaged: isProwManagedCheck(name),
          runId: ids ? ids.runId : null,
          jobId: ids ? ids.jobId : null
        });
      }
    }

    // Legacy GitHub UI fallback
    if (names.length === 0) {
      const rows = document.querySelectorAll(LEGACY_CHECK_ROW_SELECTOR);
      for (const row of rows) {
        const nameEl = row.querySelector('.status-actions a, .merge-status-item a, a.Link--primary, .text-bold');
        if (!nameEl) continue;
        const name = nameEl.textContent.trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const ids = parseActionsRunJobIds(nameEl.getAttribute('href'));
        names.push({
          name,
          status: getCheckStatus(row),
          isProwManaged: isProwManagedCheck(name),
          runId: ids ? ids.runId : null,
          jobId: ids ? ids.jobId : null
        });
      }
    }

    return names;
  }


  /**
   * Build a name → live status lookup from the checks currently rendered on
   * the page, so callers with a separately-sourced job list (e.g. presubmits
   * from Prow config YAML) can override their static/config-derived status
   * with what GitHub is actually reporting right now.
   * @returns {Map<string, 'failed'|'pending'|'passed'>}
   */
  function buildLiveCheckStatusMap() {
    const map = new Map();
    for (const c of scrapeCheckNames()) {
      map.set(c.name, c.status);
    }
    return map;
  }

  const PROW_CHECK_PATTERN = /^(pull-|ci\/prow\/|tide$|branch-protection$)/;
  const PROW_LABEL_PATTERN = /^(lgtm|approved|needs-ok-to-test|do-not-merge|size\/|needs-rebase|tide\/)/;

  function detectProwSignals() {
    const checks = scrapeCheckNames();
    if (checks.some(c => PROW_CHECK_PATTERN.test(c.name))) return true;
    const labels = document.querySelectorAll('.IssueLabel');
    for (const el of labels) {
      if (PROW_LABEL_PATTERN.test(el.textContent.trim())) return true;
    }
    return false;
  }

  /**
   * Scrape rehearsal job names from REHEARSALNOTIFIER comment tables on the PR page.
   * @returns {{name: string, status: 'pending'}[]}
   */
  function scrapeRehearsalNames() {
    const names = [];
    const seen = new Set();
    const comments = document.querySelectorAll('.timeline-comment, .js-comment-container, [id^="issuecomment-"]');
    for (const comment of comments) {
      const body = comment.querySelector('.comment-body, .js-comment-body, .markdown-body');
      if (!body) continue;
      if (!body.textContent.includes('REHEARSALNOTIFIER')) continue;
      const table = body.querySelector('table');
      if (!table) continue;
      const rows = table.querySelectorAll('tbody tr');
      for (const row of rows) {
        const cell = row.querySelector('td');
        if (!cell) continue;
        const name = cell.textContent.trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        names.push({ name, status: 'pending' });
      }
    }
    return names;
  }

  // Must match the background allowlist; only links under this prefix in a
  // REHEARSALNOTIFIER comment point at the full affected-jobs listing.
  const REHEARSAL_LIST_URL_PREFIX = 'https://gcsweb-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/test-platform-results/pj-rehearse/';

  /**
   * Find the link to the full affected-jobs listing in the latest
   * REHEARSALNOTIFIER comment. The comment table itself is truncated to 25
   * rows; the linked GCS listing has every affected job.
   * @returns {string|null} Listing URL, or null when no comment links one.
   */
  function findRehearsalListUrl() {
    let url = null;
    const comments = document.querySelectorAll('.timeline-comment, .js-comment-container, [id^="issuecomment-"]');
    for (const comment of comments) {
      const body = comment.querySelector('.comment-body, .js-comment-body, .markdown-body');
      if (!body) continue;
      if (!body.textContent.includes('REHEARSALNOTIFIER')) continue;
      const link = body.querySelector(`a[href^="${REHEARSAL_LIST_URL_PREFIX}"]`);
      if (link) url = link.href;
    }
    return url;
  }

  /**
   * Fetch the full affected-jobs list for the current PR via the background
   * worker, caching per listing URL. Returns null when no REHEARSALNOTIFIER
   * listing link exists or the fetch fails — callers fall back to the scraped
   * (25-row) comment table.
   * @returns {Promise<{name: string, status: 'pending'}[]|null>}
   */
  async function fetchFullRehearsalJobs() {
    const url = findRehearsalListUrl();
    if (!url || !CM.isContextValid()) return null;
    if (url === lastRehearsalJobsUrl && lastRehearsalJobs) return lastRehearsalJobs;
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'getRehearsalJobs', url });
      if (resp && resp.jobs && resp.jobs.length > 0) {
        lastRehearsalJobsUrl = url;
        lastRehearsalJobs = resp.jobs.map(j => ({ name: j.name, status: 'pending' }));
        return lastRehearsalJobs;
      }
    } catch (e) {
      // fall through to scraped table
    }
    return null;
  }

  /**
   * Fetch branch names for the current repo via the background worker
   * (GitHub API) for the cherry-pick branch picker. Cached per repo.
   * @returns {Promise<{name: string, status: 'pending'}[]|null>}
   */
  async function fetchRepoBranches() {
    if (!CM.isContextValid() || !currentRepo) return null;
    if (lastRepoBranches && lastRepoBranchesRepo === currentRepo) return lastRepoBranches;
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'getRepoBranches', repo: currentRepo });
      if (resp && resp.branches && resp.branches.length > 0) {
        lastRepoBranchesRepo = currentRepo;
        lastRepoBranches = resp.branches.map(name => ({ name, status: 'pending' }));
        return lastRepoBranches;
      }
    } catch (e) {
      // fall through to free-form input
    }
    return null;
  }

  /**
   * Ask the background service worker for presubmit CI jobs for the current repo
   * and base branch.  Returns null when the extension context is invalid, the repo
   * is unknown, or the background worker returns no data.
   * @returns {Promise<Object[]|null>} Array of presubmit job objects, or null.
   */
  async function fetchPresubmitJobs() {
    if (!CM.isContextValid() || !currentRepo) return null;
    try {
      const resp = await chrome.runtime.sendMessage({
        action: 'getPresubmitJobs',
        repo: currentRepo,
        branch: detectTargetBranch(),
        prNumber: getPRNumber()
      });
      return resp && resp.jobs ? resp.jobs : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Show a floating job-picker dialog anchored to `anchorBtn` for commands that
   * need a CI job name as input.  Populates the list from rehearsal comments,
   * presubmit config, or scraped check names (in that order of preference).
   * Handles multi-select, keyboard navigation, search filtering, and optional
   * confirmation before posting.
   * @param {Object}                command   - Command descriptor (hasJobPicker, jobSource, jobPickerFilter, etc.).
   * @param {Object}                context   - Context data (repoName, prNumber).
   * @param {HTMLButtonElement|null} anchorBtn - Button that triggered the picker, or null.
   * @returns {Promise<void>}
   */
  async function showTestJobPicker(command, context, anchorBtn) {
    closeOpenDialogs();

    const usePresubmits = (command.commandTemplate || '').startsWith('/test');
    const filter = command.jobPickerFilter || 'all';
    let jobs;

    if (command.jobSource === 'rehearsals') {
      jobs = await fetchFullRehearsalJobs() || scrapeRehearsalNames();
    } else if (command.jobSource === 'branches') {
      jobs = await fetchRepoBranches();
      if (!jobs) {
        // Branch list unavailable (rate limit, offline) — free-form input instead.
        showInputPopover(command, context, anchorBtn);
        return;
      }
    } else if (usePresubmits && lastPresubmitJobs && lastPresubmitJobs.length > 0) {
      const liveStatus = buildLiveCheckStatusMap();
      jobs = lastPresubmitJobs.map(j => ({
        name: j.name,
        // Prefer whatever GitHub is actually showing for this check right now
        // (matched by Prow context or raw job name) over the config-derived
        // guess — a required job defaults to 'passed' only because Prow
        // config doesn't say otherwise, but the page might show it failing.
        status: liveStatus.get(j.context) || liveStatus.get(j.jobName) || liveStatus.get(j.name) ||
                (j.optional ? 'pending' : 'passed'),
        context: j.context,
        jobName: j.jobName
      }));
    }

    if (!jobs) {
      jobs = scrapeCheckNames();
      if (filter === 'failed') {
        jobs = jobs.filter(j => j.status === 'failed');
      } else if (filter === 'pending') {
        jobs = jobs.filter(j => j.status === 'pending');
      }
    }

    const selected = new Set();
    const template = command.commandTemplate || '/test {input}';

    const picker = document.createElement('div');
    picker.className = 'ghbcp-job-picker';
    picker.setAttribute('role', 'dialog');
    picker.setAttribute('aria-modal', 'true');
    picker.setAttribute('aria-label', 'Select CI jobs to run');

    const header = document.createElement('div');
    header.className = 'ghbcp-job-picker-header';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'ghbcp-job-picker-search';
    searchInput.placeholder = 'Search jobs... (' + jobs.length + ' available)';
    searchInput.setAttribute('aria-label', 'Search CI jobs');
    header.appendChild(searchInput);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ghbcp-job-picker-close';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', 'Close job picker');
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closePicker();
    });
    header.appendChild(closeBtn);

    picker.appendChild(header);

    const list = document.createElement('div');
    list.className = 'ghbcp-job-picker-list';
    list.setAttribute('role', 'list');

    const footer = document.createElement('div');
    footer.className = 'ghbcp-job-picker-footer';

    const selectAllLabel = document.createElement('label');
    selectAllLabel.className = 'ghbcp-job-picker-select-all';
    const selectAllCb = document.createElement('input');
    selectAllCb.type = 'checkbox';
    selectAllLabel.appendChild(selectAllCb);
    selectAllLabel.appendChild(document.createTextNode(' Select All'));
    footer.appendChild(selectAllLabel);

    const countSpan = document.createElement('span');
    countSpan.className = 'ghbcp-job-picker-count';
    countSpan.setAttribute('aria-live', 'polite');
    countSpan.setAttribute('aria-atomic', 'true');
    footer.appendChild(countSpan);

    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.className = 'ghbcp-btn ghbcp-btn-primary ghbcp-job-picker-submit';
    submitBtn.disabled = true;
    submitBtn.setAttribute('aria-label', (command.label || 'Run') + ' selected jobs');
    footer.appendChild(submitBtn);

    function updateFooter() {
      const count = selected.size;
      countSpan.textContent = count + ' selected';
      submitBtn.textContent = (command.label || 'Run') + ' Selected' + (count > 0 ? ' (' + count + ')' : '');
      submitBtn.disabled = count === 0;
      const visibleItems = list.querySelectorAll('.ghbcp-job-picker-item');
      const visibleNames = Array.from(visibleItems).map(el => el.dataset.jobName);
      const allVisible = visibleNames.length > 0 && visibleNames.every(name => selected.has(name));
      const someVisible = visibleNames.some(name => selected.has(name));
      selectAllCb.checked = allVisible;
      // The native indeterminate property is the correct mechanism for the mixed state;
      // setting aria-checked on a native checkbox conflicts with its implicit ARIA semantics.
      selectAllCb.indeterminate = !allVisible && someVisible;
    }

    function renderJobs(searchFilter) {
      list.innerHTML = '';
      const filtered = searchFilter
        ? jobs.filter(j => {
            const name = j.name.toLowerCase();
            const terms = searchFilter.toLowerCase().match(/"[^"]*"|\S+/g) || [];
            return terms.every(t => name.includes(t.replace(/^"|"$/g, '')));
          })
        : jobs;

      if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'ghbcp-job-picker-empty';
        empty.textContent = searchFilter ? 'No matching jobs' : 'No CI jobs found on this page';
        list.appendChild(empty);
        updateFooter();
        return;
      }

      const order = { failed: 0, pending: 1, passed: 2 };
      filtered.sort((a, b) => order[a.status] - order[b.status]);

      for (const job of filtered) {
        const item = document.createElement('div');
        item.className = 'ghbcp-job-picker-item' + (selected.has(job.name) ? ' selected' : '');
        item.dataset.jobName = job.name;
        item.setAttribute('role', 'listitem');

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'ghbcp-job-picker-checkbox';
        cb.checked = selected.has(job.name);
        cb.setAttribute('aria-label', `${job.name} (${job.status || 'unknown'})`);
        item.appendChild(cb);

        const dot = document.createElement('span');
        dot.className = `ghbcp-job-dot ghbcp-job-dot-${job.status}`;
        dot.setAttribute('aria-hidden', 'true');
        item.appendChild(dot);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'ghbcp-job-name';
        nameSpan.textContent = job.name;
        item.appendChild(nameSpan);

        // Keep checkbox and selected-set in sync regardless of input method
        // (mouse click on item row, direct click on checkbox, or keyboard Space).
        cb.addEventListener('change', () => {
          if (cb.checked) {
            selected.add(job.name);
            item.classList.add('selected');
          } else {
            selected.delete(job.name);
            item.classList.remove('selected');
          }
          updateFooter();
        });

        item.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          // When the checkbox itself is clicked the browser already toggles it
          // and fires the 'change' event above — avoid double-toggling.
          if (e.target === cb) return;
          cb.checked = !cb.checked;
          cb.dispatchEvent(new Event('change'));
        });

        list.appendChild(item);
      }
      updateFooter();
    }

    selectAllCb.addEventListener('change', (e) => {
      e.stopPropagation();
      const visibleItems = list.querySelectorAll('.ghbcp-job-picker-item');
      if (selectAllCb.checked) {
        visibleItems.forEach(el => {
          selected.add(el.dataset.jobName);
          el.classList.add('selected');
          el.querySelector('.ghbcp-job-picker-checkbox').checked = true;
        });
      } else {
        visibleItems.forEach(el => {
          selected.delete(el.dataset.jobName);
          el.classList.remove('selected');
          el.querySelector('.ghbcp-job-picker-checkbox').checked = false;
        });
      }
      updateFooter();
    });

    submitBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (selected.size === 0) return;
      // /override targets Prow status contexts, so normalize each scraped check
      // name (e.g. "Lint / Lint (ubuntu-latest) (pull_request)") to the context
      // Prow/tide actually see ("Lint (ubuntu-latest)"). Other commands (/test)
      // use the job name as-is.
      const isOverride = template.trimStart().startsWith('/override');
      const isTest = template.trimStart().startsWith('/test');

      // /test only reaches jobs Prow owns (isProwManagedCheck()). When this
      // picker's jobs came from scrapeCheckNames() (lastPresubmitJobs was
      // unavailable, so entries carry isProwManaged/runId/jobId — see that
      // function), route selected GitHub-Actions-native jobs through the real
      // rerun API instead of folding them into a /test comment Prow would
      // just bounce as "target not found". Without a token configured there's
      // no way to fire that call, so fall back to the old behavior (still
      // posted as /test — a harmless no-op for those, same as a single
      // check row's rerun-hint-link fallback).
      let commentNames = Array.from(selected);
      let rerunJobs = [];
      if (isTest && lastGithubToken) {
        const jobsByName = new Map(jobs.map(j => [j.name, j]));
        const prowNames = [];
        for (const name of selected) {
          const job = jobsByName.get(name);
          if (job && job.isProwManaged === false && job.runId && job.jobId) {
            rerunJobs.push(job);
          } else {
            prowNames.push(name);
          }
        }
        commentNames = prowNames;
      }

      const names = commentNames.map(n =>
        CM.sanitizeCommand(isOverride ? CM.getOverrideContext(n) : n));
      // 'single-command' joins space-separated (/cherrypick a b); the comma
      // variant exists for /jira backport, whose plugin requires "a,b".
      let cmdText = null;
      if (names.length > 0) {
        if (command.joinMode === 'single-command') {
          cmdText = template.replace('{input}', names.join(' '));
        } else if (command.joinMode === 'single-command-comma') {
          // A comma inside a name can't be expressed in a comma-joined argument
          // (the /jira backport parser has no escaping) — surface the conflict
          // and keep the picker open instead of emitting an ambiguous command.
          const unsafe = names.filter(n => n.includes(','));
          if (unsafe.length > 0) {
            alert(`Comma-separated submission cannot include: ${unsafe.join(' ')}`);
            return;
          }
          cmdText = template.replace('{input}', names.join(','));
        } else {
          cmdText = names.map(n => template.replace('{input}', n)).join('\n');
        }
      }

      const confirmMsg = [
        cmdText ? `Post:\n${cmdText}` : null,
        rerunJobs.length > 0
          ? 'Rerun via GitHub Actions (uses your configured token, consumes CI minutes):\n' +
            rerunJobs.map(j => j.name).join('\n')
          : null
      ].filter(Boolean).join('\n\n');
      if (!confirmMsg) return;

      // Always confirm when a real rerun is involved, regardless of
      // confirmBeforePost — it spends CI compute/money, not just posts a comment.
      if (shouldConfirm(command) || rerunJobs.length > 0) {
        if (!confirm(confirmMsg)) return;
      }

      if (cmdText) fillComment(cmdText);
      for (const job of rerunJobs) {
        chrome.runtime.sendMessage({
          action: 'rerunActionsJob',
          repo: context.repoName,
          runId: job.runId,
          jobId: job.jobId
        }).then(resp => {
          if (resp && resp.success) {
            showToast('Rerun triggered for ' + job.name, 'success');
          } else {
            showToast(rerunErrorMessage(resp && resp.error), 'error');
          }
        }).catch(() => {
          showToast('Failed to reach the extension background for ' + job.name, 'error');
        });
      }
      closePicker();
    });

    searchInput.addEventListener('input', () => renderJobs(searchInput.value));
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closePicker(); }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const firstCb = list.querySelector('.ghbcp-job-picker-checkbox');
        if (firstCb) firstCb.focus();
      }
    });

    // Arrow key navigation and Escape dismiss within the job list
    list.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closePicker(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const checkboxes = Array.from(list.querySelectorAll('.ghbcp-job-picker-checkbox'));
      if (checkboxes.length === 0) return;
      const idx = checkboxes.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') {
        const next = idx < checkboxes.length - 1 ? checkboxes[idx + 1] : null;
        if (next) next.focus();
        else submitBtn.focus();
      } else {
        const prev = idx > 0 ? checkboxes[idx - 1] : null;
        if (prev) prev.focus();
        else searchInput.focus();
      }
    });

    // Focus trap: keep keyboard focus within the picker dialog
    addFocusTrap(picker, searchInput);

    picker.appendChild(list);
    picker.appendChild(footer);
    renderJobs('');

    // Keep dropdown status dots in sync with GitHub's own checks section as
    // it updates in place (Prow polling re-renders check rows without a full
    // page reload) — otherwise a job's color can go stale until the picker
    // is closed and reopened. Rehearsal/branch job sources aren't backed by
    // a check row, so there's nothing live to watch for those.
    let liveStatusObserver = null;
    if (command.jobSource !== 'rehearsals' && command.jobSource !== 'branches') {
      let refreshTimer = null;
      const refreshLiveStatuses = () => {
        const liveStatus = buildLiveCheckStatusMap();
        let changed = false;
        for (const job of jobs) {
          const live = liveStatus.get(job.context) || liveStatus.get(job.jobName) || liveStatus.get(job.name);
          if (live && live !== job.status) {
            job.status = live;
            changed = true;
          }
        }
        if (changed) renderJobs(searchInput.value);
      };
      const watchTarget = document.querySelector(CHECKS_SECTION_SELECTOR) ||
                           document.querySelector('.merge-status-list');
      if (watchTarget) {
        liveStatusObserver = new MutationObserver(() => {
          clearTimeout(refreshTimer);
          refreshTimer = setTimeout(refreshLiveStatuses, 150);
        });
        liveStatusObserver.observe(watchTarget, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class', 'data-conclusion']
        });
      }
    }

    function onClickOutside(e) {
      if (!picker.contains(e.target) && e.target !== anchorBtn) {
        closePicker();
      }
    }
    const rawClosePicker = createDialogCloser(picker, onClickOutside, anchorBtn);
    function closePicker() {
      if (liveStatusObserver) liveStatusObserver.disconnect();
      rawClosePicker();
    }

    attachOverlay(picker, anchorBtn);
    requestAnimationFrame(() => searchInput.focus());
  }

  /**
   * Returns true when the user should be prompted to confirm before posting.
   * @param {Object} command - Command descriptor.
   * @returns {boolean}
   */
  function shouldConfirm(command) {
    return !!(command.requireConfirm || config.globalSettings.confirmBeforePost);
  }

  /**
   * Route a command button click to the appropriate handler (job picker, input
   * popover, or direct fill), applying confirmation if required.
   * @param {Object}          command   - Command descriptor.
   * @param {Object}          context   - Context data (repoName, prNumber, testName).
   * @param {HTMLButtonElement|null} btn - The clicked button, used to anchor overlays.
   */
  function handleCommandClick(command, context, btn) {
    if (command.expandRehearsalJobs) {
      expandAndPostRehearseAll(command);
      return;
    }
    if (command.hasPayloadPicker) {
      showPayloadPicker(command, context, btn);
      return;
    }
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

    if (shouldConfirm(command)) {
      if (!confirm(`Post "${cmdText}"?`)) return;
    }

    fillComment(cmdText);
  }

  /**
   * "Rehearse All" — a bare /pj-rehearse only runs a limited subset of
   * affected jobs, so expand the command to name every affected job from the
   * full GCS listing (or the scraped 25-row comment table as fallback).
   * Posts the bare command when no job list can be found at all.
   * @param {Object} command - Command descriptor (command, requireConfirm).
   */
  async function expandAndPostRehearseAll(command) {
    let jobs = await fetchFullRehearsalJobs();
    if (!jobs || jobs.length === 0) jobs = scrapeRehearsalNames();
    const base = CM.sanitizeCommand(command.command);
    const names = jobs.map(j => CM.sanitizeCommand(j.name)).filter(Boolean);
    const cmdText = names.length > 0 ? base + ' ' + names.join(' ') : base;

    if (shouldConfirm(command)) {
      // The expanded command can list hundreds of jobs; confirm with a count
      // instead of the full text.
      const preview = names.length > 0 ? `${base} … (${names.length} jobs listed)` : cmdText;
      if (!confirm(`Post "${preview}"?`)) return;
    }

    fillComment(cmdText);
  }

  /**
   * Build the close function shared by every GHBCP dialog: detach the dialog,
   * drop its document-level click listener, and hand focus back to the button
   * that opened it. The result is also stored on the element so a replacing
   * dialog can tear this one down cleanly.
   * @param {HTMLElement}            dialog    - The dialog element.
   * @param {Function}               onOutside - Its document click handler.
   * @param {HTMLButtonElement|null} anchorBtn - Button that opened it, or null.
   * @returns {Function} The close function.
   */
  function createDialogCloser(dialog, onOutside, anchorBtn) {
    // Deferred via setTimeout so the click that opened the dialog (still
    // bubbling to document) doesn't immediately trigger onOutside. Guard
    // against a close() that fires before this timeout: cancel it in close()
    // and skip attaching if the dialog is already gone, or the listener
    // would be added but nothing would ever remove it.
    const attachTimer = setTimeout(() => {
      if (dialog.isConnected) document.addEventListener('click', onOutside);
    }, 0);
    const close = () => {
      clearTimeout(attachTimer);
      // Only take focus back if it still sits in the dialog (or nowhere):
      // posting moves focus to the comment textarea, and clicking outside
      // means the user has already chosen where to go.
      const active = document.activeElement;
      const hadFocus = !active || active === document.body || dialog.contains(active);
      dialog.remove();
      document.removeEventListener('click', onOutside);
      if (anchorBtn && hadFocus) anchorBtn.focus();
    };
    dialog._ghbcpClose = close;
    return close;
  }

  /**
   * Close a previously-opened GHBCP dialog via its stored close function so
   * its document-level click listener is removed too; falls back to removing
   * the element for dialogs created before the close handoff existed.
   * @param {string} selector - Dialog selector ('.ghbcp-job-picker' or '.ghbcp-popover').
   */
  function closeExistingDialog(selector) {
    const existing = document.querySelector(selector);
    if (!existing) return;
    if (typeof existing._ghbcpClose === 'function') {
      existing._ghbcpClose();
    } else {
      existing.remove();
    }
  }

  /**
   * Close whichever GHBCP dialog is currently open, so only one is ever shown.
   */
  function closeOpenDialogs() {
    closeExistingDialog('.ghbcp-job-picker');
    closeExistingDialog('.ghbcp-popover');
  }

  // Field layout per payload command (docs.ci.openshift.org
  // release-oversight/pull-request-testing). The -with-prs variants accept
  // only one command per comment, so the picker always emits a single line.
  const PAYLOAD_FORMS = {
    '/payload':                    ['version', 'suite', 'type'],
    '/payload-with-prs':           ['version', 'suite', 'type', 'prs'],
    '/payload-job':                ['jobs'],
    '/payload-job-with-prs':       ['job', 'prs'],
    '/payload-aggregate':          ['job', 'count'],
    '/payload-aggregate-with-prs': ['job', 'count', 'prs']
  };

  /**
   * Guess relevant OCP release versions from the PR's CI check names
   * (e.g. "ci/prow/e2e-aws-4.20") to prefill the payload version field.
   * @returns {string[]} Unique versions, newest first.
   */
  function detectReleaseVersions() {
    const versions = new Set();
    for (const check of scrapeCheckNames()) {
      const matches = check.name.match(/\b[45]\.\d{1,2}\b/g);
      if (matches) matches.forEach(v => versions.add(v));
    }
    return Array.from(versions).sort((a, b) => {
      const [aMaj, aMin] = a.split('.').map(Number);
      const [bMaj, bMin] = b.split('.').map(Number);
      return (bMaj - aMaj) || (bMin - aMin);
    });
  }

  /**
   * Structured form dialog for the /payload command family: release version +
   * suite + type for /payload, periodic job name(s) and aggregation count for
   * the job/aggregate variants, and a PR list for the -with-prs variants.
   * @param {Object}                 command   - Command descriptor (hasPayloadPicker).
   * @param {Object}                 context   - Context data (repoName, prNumber).
   * @param {HTMLButtonElement|null} anchorBtn - Button that triggered the picker, or null.
   */
  function showPayloadPicker(command, context, anchorBtn) {
    // Commands are user-editable, so resolve the form as an own property only —
    // a command named e.g. "toString" must not pick up an Object.prototype
    // member. A command with no known form gets the free-form popover instead
    // of a payload form whose fields would not match its arguments.
    const formKey = String(command.command || '').trim();
    if (!Object.prototype.hasOwnProperty.call(PAYLOAD_FORMS, formKey)) {
      showInputPopover(command, context, anchorBtn);
      return;
    }
    const fields = PAYLOAD_FORMS[formKey];

    closeOpenDialogs();

    const picker = document.createElement('div');
    picker.className = 'ghbcp-job-picker ghbcp-payload-picker';
    picker.setAttribute('role', 'dialog');
    picker.setAttribute('aria-modal', 'true');
    picker.setAttribute('aria-label', command.label || command.command);

    const form = document.createElement('div');
    form.className = 'ghbcp-payload-form';

    // The dialog has no search field to identify it the way the job picker
    // does, so name the command on screen as well as in aria-label.
    const title = document.createElement('div');
    title.className = 'ghbcp-payload-title';
    title.textContent = command.label || command.command;
    picker.appendChild(title);

    const inputs = {};
    // Only fields that actually rendered a control; the submit handler and
    // initial focus read this rather than the requested field list.
    const rendered = [];

    function addRow(key, labelText, el) {
      const row = document.createElement('div');
      row.className = 'ghbcp-payload-row';
      const label = document.createElement('label');
      label.textContent = labelText;
      const id = 'ghbcp-payload-' + key;
      label.setAttribute('for', id);
      el.id = id;
      // Constraints let reportValidity() surface a native message; the submit
      // handler's own checks stay authoritative.
      el.required = true;
      el.addEventListener('input', () => el.setCustomValidity(''));
      row.appendChild(label);
      row.appendChild(el);
      form.appendChild(row);
      inputs[key] = el;
      rendered.push(key);
    }

    for (const field of fields) {
      if (field === 'version') {
        const input = document.createElement('input');
        input.type = 'text';
        const detected = detectReleaseVersions();
        input.value = detected[0] || '';
        input.placeholder = 'e.g. 4.20';
        // A single token: the suite and type go in their own fields, so reject
        // a pasted "4.20 nightly blocking" rather than duplicating them.
        input.pattern = '\\S+';
        input.setAttribute('aria-label', 'Release version');
        if (detected.length > 0) {
          const listId = 'ghbcp-payload-versions';
          const datalist = document.createElement('datalist');
          datalist.id = listId;
          for (const v of detected) {
            const opt = document.createElement('option');
            opt.value = v;
            datalist.appendChild(opt);
          }
          picker.appendChild(datalist);
          input.setAttribute('list', listId);
        }
        addRow(field, 'Version', input);
      } else if (field === 'suite') {
        const select = document.createElement('select');
        select.setAttribute('aria-label', 'Payload suite');
        for (const v of ['nightly', 'ci']) {
          const opt = document.createElement('option');
          opt.value = v;
          opt.textContent = v;
          select.appendChild(opt);
        }
        addRow(field, 'Suite', select);
      } else if (field === 'type') {
        const select = document.createElement('select');
        select.setAttribute('aria-label', 'Payload type');
        for (const v of ['blocking', 'informing']) {
          const opt = document.createElement('option');
          opt.value = v;
          opt.textContent = v;
          select.appendChild(opt);
        }
        addRow(field, 'Type', select);
      } else if (field === 'count') {
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '1';
        input.step = '1';
        input.value = '10';
        addRow(field, 'Runs (aggregation count)', input);
      } else if (field === 'jobs' || field === 'job') {
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = field === 'jobs' ? 'periodic-ci-... [more jobs]' : 'periodic-ci-...';
        // The aggregate/-with-prs variants take exactly one job name.
        if (field === 'job') input.pattern = '\\S+';
        addRow(field, field === 'jobs' ? 'Periodic job(s)' : 'Periodic job', input);
      } else if (field === 'prs') {
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'org/repo#123 org/repo#456';
        input.setAttribute('aria-label', 'Additional PRs');
        addRow(field, 'PRs', input);
      }
    }

    const footer = document.createElement('div');
    footer.className = 'ghbcp-job-picker-footer';

    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.className = 'ghbcp-btn ghbcp-btn-primary';
    submitBtn.textContent = 'Post';
    submitBtn.setAttribute('aria-label', 'Post payload command');

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'ghbcp-btn ghbcp-btn-neutral';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.setAttribute('aria-label', 'Cancel');

    function onClickOutside(e) {
      if (!picker.contains(e.target) && e.target !== anchorBtn) {
        closePayloadPicker();
      }
    }
    const closePayloadPicker = createDialogCloser(picker, onClickOutside, anchorBtn);

    submitBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const parts = [];
      for (const field of rendered) {
        const input = inputs[field];
        const value = input.value.trim();
        // Write the trimmed value back so a whitespace-only entry trips the
        // native `required` constraint and reportValidity() actually speaks.
        if (input.value !== value) input.value = value;
        // 'count' is a whole number of runs: reject fractions, exponent
        // notation (Prow parses the literal text), and out-of-range values.
        const countOk = field !== 'count' ||
          (/^\d+$/.test(value) && Number(value) >= 1 && Number.isSafeInteger(Number(value)));
        if (value && !countOk) {
          input.setCustomValidity('Enter a whole number of runs, e.g. 10');
        }
        const invalid = !value ||
          (typeof input.checkValidity === 'function' && !input.checkValidity()) ||
          !countOk;
        if (invalid) {
          input.focus();
          if (typeof input.reportValidity === 'function') input.reportValidity();
          return;
        }
        // Post the canonical numeral, so "007" does not reach Prow verbatim.
        parts.push(field === 'count' ? String(Number(value)) : value);
      }
      const cmdText = CM.sanitizeCommand(command.command + ' ' + parts.join(' '));
      if (shouldConfirm(command)) {
        if (!confirm(`Post "${cmdText}"?`)) return;
      }
      fillComment(cmdText);
      closePayloadPicker();
    });

    cancelBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closePayloadPicker();
    });

    picker.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closePayloadPicker();
        return;
      }
      if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
        // The picker lives inside GitHub's comment form, so Enter must never
        // reach it. Advance through the fields instead of submitting from the
        // first one — that also keeps Enter from racing the version field's
        // datalist suggestion commit.
        e.preventDefault();
        e.stopPropagation();
        const idx = rendered.indexOf(e.target.id.replace('ghbcp-payload-', ''));
        const next = idx >= 0 && idx < rendered.length - 1 ? inputs[rendered[idx + 1]] : null;
        if (next) next.focus();
        else submitBtn.click();
      }
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(submitBtn);
    picker.appendChild(form);
    picker.appendChild(footer);

    const firstField = inputs[rendered[0]] || submitBtn;
    addFocusTrap(picker, firstField);

    attachOverlay(picker, anchorBtn);
    requestAnimationFrame(() => firstField.focus());
  }

  /**
   * Show a floating input popover anchored to `anchorBtn` for commands that need
   * free-form user input before posting.  Handles Enter/Escape keyboard shortcuts,
   * optional confirmation, and click-outside dismissal.
   * @param {Object}                command   - Command descriptor (commandTemplate, requireConfirm, etc.).
   * @param {Object}                context   - Context data (testName, repoName, prNumber).
   * @param {HTMLButtonElement|null} anchorBtn - Button that triggered the popover, or null.
   */
  function showInputPopover(command, context, anchorBtn) {
    closeOpenDialogs();

    const popover = document.createElement('div');
    popover.className = 'ghbcp-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-modal', 'true');
    popover.setAttribute('aria-label', command.label || command.command || 'Command input');

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ghbcp-popover-input';
    input.placeholder = command.inputPlaceholder || 'Enter value...';
    input.setAttribute('aria-label', command.inputPlaceholder || 'Enter value');
    if (context && context.testName) {
      input.value = context.testName;
    }

    const postBtn = document.createElement('button');
    postBtn.type = 'button';
    postBtn.className = 'ghbcp-btn ghbcp-btn-primary ghbcp-popover-post';
    postBtn.textContent = 'Post';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'ghbcp-btn ghbcp-btn-neutral ghbcp-popover-cancel';
    cancelBtn.textContent = '✕';
    cancelBtn.setAttribute('aria-label', 'Cancel');

    // Declared before its first use at click time; the handler below is
    // hoisted, so the pair can reference each other.
    const closePopover = createDialogCloser(popover, onClickOutside, anchorBtn);

    function doPost() {
      const val = input.value.trim();
      if (!val) return;
      const template = command.commandTemplate || (command.command + ' {input}');
      const cmdText = CM.sanitizeCommand(template.replace('{input}', val));

      if (shouldConfirm(command)) {
        if (!confirm(`Post "${cmdText}"?`)) return;
      }

      fillComment(cmdText);
      closePopover();
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
        closePopover();
      }
    });

    cancelBtn.addEventListener('click', (e) => {
      e.preventDefault();
      closePopover();
    });

    popover.appendChild(input);
    popover.appendChild(postBtn);
    popover.appendChild(cancelBtn);

    // Dismiss with Escape from any focusable element inside the popover
    popover.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closePopover(); }
    });

    // Focus trap: keep keyboard focus within the popover dialog
    addFocusTrap(popover, input);

    function onClickOutside(e) {
      if (!popover.contains(e.target) && e.target !== anchorBtn) {
        closePopover();
      }
    }
    attachOverlay(popover, anchorBtn);
    requestAnimationFrame(() => input.focus());
  }

  /**
   * Fill the PR comment textarea with `cmdText`, using the React native setter so
   * React-controlled inputs detect the change and re-enable the submit button.
   * Optionally auto-submits the comment if `globalSettings.autoSubmit` is enabled.
   * @param {string} cmdText - The slash command text to post.
   */
  function fillComment(cmdText) {
    const textarea = findCommentTextarea();
    if (!textarea) {
      showToast('No comment box found', 'error');
      return;
    }

    textarea.focus();
    // Use the native setter so React-controlled textareas recognise the change
    // and re-enable the submit button. Plain assignment is ignored by React's
    // internal value tracking.
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
    const nativeSetter = descriptor && descriptor.set;
    if (nativeSetter) {
      nativeSetter.call(textarea, cmdText);
    } else {
      textarea.value = cmdText;
    }
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));

    if (config.globalSettings.autoSubmit) {
      const trySubmit = (attempts) => {
        const submitBtn = findSubmitButton(textarea);
        if (submitBtn) {
          submitBtn.click();
          showToast(`Posted ${cmdText}`, 'success');
        } else if (attempts > 0) {
          setTimeout(() => trySubmit(attempts - 1), 100);
        } else {
          showToast(`Filled: ${cmdText} (submit manually)`, 'warning');
        }
      };
      setTimeout(() => trySubmit(5), 100);
    } else {
      showToast(`Filled: ${cmdText}`, 'success');
    }
  }

  /**
   * Find the most appropriate comment textarea on the current PR page.
   * Priority order: open review dialog textarea → `#new_comment_field` → various
   * legacy selectors for the new-comment form area.
   * @returns {HTMLTextAreaElement|null}
   */
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

  /**
   * Locate the primary submit button for the form that contains `textarea`.
   * Checks the enclosing review dialog first, then the nearest `<form>`, then
   * falls back to page-level selectors.  Only non-disabled buttons are returned.
   * @param {HTMLTextAreaElement} textarea - The comment textarea whose form to search.
   * @returns {HTMLButtonElement|null}
   */
  function findSubmitButton(textarea) {
    // Review dialog submit button
    const dialog = textarea.closest('div[role="dialog"][aria-modal="true"]');
    if (dialog) {
      const btn = dialog.querySelector('button[data-variant="primary"]:not([disabled])');
      if (btn) return btn;
    }

    const form = textarea.closest('form');
    if (form) {
      const btn = form.querySelector('button.btn-primary[type="submit"]:not([disabled])');
      if (btn) return btn;
    }
    const selectors = [
      '.js-new-comment-form button.btn-primary[type="submit"]:not([disabled])',
      'button.btn-primary[type="submit"]:not([name="comment_and_close"]):not([disabled])'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  /**
   * Attach `overlay` to the DOM relative to `anchorBtn`.  When an anchor button
   * is available its parent becomes the positioning context; otherwise the overlay
   * is appended to the existing `.ghbcp-command-bar` or `document.body`.
   * @param {HTMLElement}            overlay   - The overlay element to attach.
   * @param {HTMLElement|null}       anchorBtn - Button that triggered the overlay, or null.
   */
  function attachOverlay(overlay, anchorBtn) {
    if (anchorBtn && anchorBtn.parentElement) {
      anchorBtn.parentElement.style.position = 'relative';
      anchorBtn.parentElement.appendChild(overlay);
    } else {
      // Keyboard shortcut path: no button anchor, attach to command bar or body
      const bar = document.querySelector('.ghbcp-command-bar');
      const container = bar || document.body;
      if (bar) bar.style.position = 'relative';
      container.appendChild(overlay);
    }
  }

  /**
   * Show a self-dismissing toast notification. Removes any existing toast first.
   * @param {string} message - The text to display.
   * @param {'success'|'warning'|'error'} type - Visual style variant.
   */
  function showToast(message, type) {
    const existing = document.querySelector('.ghbcp-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `ghbcp-toast ghbcp-toast-${type || 'success'}`;
    // role="alert" implies aria-live="assertive" (interrupts screen reader immediately).
    // role="status" implies aria-live="polite" (waits for current task to finish).
    // Use assertive only for errors; polite for success/warning.
    if (type === 'error') {
      toast.setAttribute('role', 'alert');
    } else {
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
    }
    toast.setAttribute('aria-atomic', 'true');
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('ghbcp-toast-show'));

    setTimeout(() => {
      toast.classList.remove('ghbcp-toast-show');
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  /**
   * Trap keyboard Tab focus within `container`. Shift+Tab from the first
   * focusable element wraps to the last, and Tab from the last wraps to the
   * first. `firstFocusable` is always treated as focusable even when hidden.
   * @param {HTMLElement} container     - The dialog or overlay element to trap focus within.
   * @param {HTMLElement} firstFocusable - The element that is always considered focusable
   *   (e.g. the search input), even when its offsetParent is null.
   * @returns {void}
   */
  function addFocusTrap(container, firstFocusable) {
    container.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(container.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter(el => el.offsetParent !== null || el === firstFocusable);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  /**
   * Build a named group of command buttons wrapped in a labelled container.
   * @param {string}   name     - Group label shown above the buttons.
   * @param {Object[]} commands - Array of command descriptors.
   * @returns {HTMLDivElement}
   */
  function createCommandGroup(name, commands) {
    const group = document.createElement('div');
    group.className = 'ghbcp-cmd-group';
    group.setAttribute('role', 'group');
    const groupLabelId = 'ghbcp-group-' + (++_ghbcpGroupIdCounter);
    group.setAttribute('aria-labelledby', groupLabelId);
    const groupLabel = document.createElement('span');
    groupLabel.className = 'ghbcp-group-label';
    groupLabel.id = groupLabelId;
    groupLabel.textContent = name;
    group.appendChild(groupLabel);
    const btnWrap = document.createElement('div');
    btnWrap.className = 'ghbcp-btn-wrap';
    const ctx = { repoName: currentRepo, prNumber: getPRNumber() };
    for (const cmd of commands) {
      btnWrap.appendChild(createButton(cmd, ctx));
    }
    group.appendChild(btnWrap);
    return group;
  }

  /**
   * Build the "Bot Commands" bar header element with title, optional refresh
   * button (when cached plugin data is available), and optional config-file link.
   * @param {Object|null} pluginData - Cached plugin data from lastPluginData, or null.
   * @param {Function}    onRefresh  - Callback to invoke after a refresh is triggered.
   * @returns {HTMLElement} The header div ready to be appended to the bar.
   */
  function buildBarHeader(pluginData, onRefresh) {
    const header = document.createElement('div');
    header.className = 'ghbcp-bar-header';

    const headerLeft = document.createElement('span');
    headerLeft.innerHTML = '<span class="ghbcp-bar-icon" aria-hidden="true">&#129302;</span> <span class="ghbcp-bar-title">Bot Commands</span>';
    header.appendChild(headerLeft);

    const headerRight = document.createElement('span');
    headerRight.className = 'ghbcp-bar-actions';

    if (pluginData) {
      if (pluginData.cachedAt) {
        const ago = Math.round((Date.now() - pluginData.cachedAt) / 60000);
        const refreshBtn = document.createElement('button');
        refreshBtn.type = 'button';
        refreshBtn.className = 'ghbcp-refresh-btn';
        refreshBtn.innerHTML = '&#8635;';
        refreshBtn.title = `Refresh plugin config (cached ${ago} min ago)`;
        refreshBtn.setAttribute('aria-label', `Refresh plugin config (cached ${ago} min ago)`);
        refreshBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!CM.isContextValid()) return;
          refreshBtn.classList.add('ghbcp-spinning');
          try {
            await chrome.runtime.sendMessage({ action: 'refreshPlugins', repo: currentRepo });
          } catch (err) { /* ignore */ }
          refreshBtn.classList.remove('ghbcp-spinning');
          onRefresh();
        });
        headerRight.appendChild(refreshBtn);
      }

      if (pluginData.configFileUrl) {
        const configLink = document.createElement('a');
        configLink.className = 'ghbcp-config-link';
        configLink.href = pluginData.configFileUrl;
        configLink.target = '_blank';
        configLink.rel = 'noopener noreferrer';
        configLink.innerHTML = '<span aria-hidden="true">&#9881;</span>';
        configLink.title = 'Edit plugin config on GitHub';
        configLink.setAttribute('aria-label', 'Edit plugin config on GitHub');
        headerRight.appendChild(configLink);
      }
    }

    header.appendChild(headerRight);
    return header;
  }

  /**
   * Build a DocumentFragment containing one group per matching profile plus an
   * optional "Repo Overrides" group for repo-specific extra commands.
   * @param {Object[]} profiles      - Matched, enabled profile objects.
   * @param {Object[]} extraCommands - Additional commands from repo overrides.
   * @returns {DocumentFragment}
   */
  function buildCommandGroups(profiles, extraCommands) {
    const fragment = document.createDocumentFragment();
    for (const profile of profiles) {
      if (profile.globalCommands.length === 0) continue;
      fragment.appendChild(createCommandGroup(profile.name, profile.globalCommands));
    }
    if (extraCommands.length > 0) {
      fragment.appendChild(createCommandGroup('Repo Overrides', extraCommands));
    }
    return fragment;
  }

  /**
   * Inject (or replace) the global command bar above the PR comment textarea.
   * The bar contains one button group per matching profile plus an optional
   * "Repo Overrides" group.  Falls back to the discussion timeline or `<body>`
   * when the comment form container is not found.
   * @param {Object[]} profiles      - Matched, enabled profile objects.
   * @param {Object[]} extraCommands - Additional commands from repo overrides.
   */
  function injectGlobalCommandBar(profiles, extraCommands) {
    const existing = document.querySelector('.ghbcp-command-bar');
    if (existing) existing.remove();

    const textarea = findCommentTextarea();

    const bar = document.createElement('div');
    bar.className = 'ghbcp-command-bar';
    bar.dataset.ghbcpInjected = 'true';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Bot Commands');

    bar.appendChild(buildBarHeader(lastPluginData, inject));

    bar.appendChild(buildCommandGroups(profiles, extraCommands));

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

  /**
   * Inject "Test" and "Override" buttons next to CI check rows.
   * When `config.globalSettings.showOnlyFailedTests` is true (the default),
   * buttons are injected only on failed checks; when false, all checks get buttons.
   * Supports both the modern Primer React checks UI and the legacy merge-status UI.
   * Clears previously injected buttons before re-injecting so that a refresh
   * picks up the latest command set without duplicating buttons.
   * @param {Object[]} profiles - Matched, enabled profile objects.
   */
  function injectCheckButtons(profiles) {
    // Clear any previously injected check buttons so that a plugin refresh or
    // re-inject picks up the latest command set instead of skipping processed rows.
    document.querySelectorAll('.ghbcp-check-btns').forEach(el => el.remove());
    document.querySelectorAll('[data-ghbcp-injected]').forEach(el => {
      delete el.dataset.ghbcpInjected;
    });

    let checkRows = [];

    // Modern GitHub UI
    const checksSection = document.querySelector(CHECKS_SECTION_SELECTOR);
    if (checksSection) {
      checkRows = checksSection.querySelectorAll('li[aria-label]');
    }

    // Legacy fallback
    if (checkRows.length === 0) {
      checkRows = document.querySelectorAll(LEGACY_CHECK_ROW_SELECTOR);
    }

    for (const row of checkRows) {
      if (row.dataset.ghbcpInjected === 'true') continue;

      if (config.globalSettings.showOnlyFailedTests && getCheckStatus(row) !== 'failed') continue;

      const nameEl = row.querySelector('h4 a span') ||
                     row.querySelector('.status-actions a, .merge-status-item a, a.Link--primary, .text-bold');
      const checkName = nameEl ? nameEl.textContent.trim() : '';
      if (!checkName) continue;

      const presubmitMatch = matchPresubmitJob(checkName);
      const rerunJobName = presubmitMatch ? presubmitMatch.name : null;

      // /test only reruns jobs Prow itself owns (ci-operator presubmits,
      // surfaced as "ci/prow/<job>" or matched above against the scraped
      // presubmit config). A repo can also report plain GitHub Actions checks
      // (e.g. a native workflow's matrix jobs) that Prow has no knowledge of
      // at all — posting /test <name> for one of those gets "The specified
      // target(s) for /test were not found" back, no matter how the name is
      // spelled. /override is different: Prow's override plugin accepts any
      // failed status context *or check run* (github.com/kubernetes-sigs/prow
      // pkg/plugins/override, ListCheckRuns), so it still works on these and
      // remains the correct way to unblock a Tide-blocked merge. So once the
      // presubmit list has loaded, only the /test button is gated.
      const canTest = isProwManagedCheck(checkName);

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
          if (canTest) {
            const jobName = rerunJobName || checkName;
            const testCmd = Object.assign({}, cmd, {
              command: '/test ' + jobName,
              label: 'Test',
              description: '/test ' + jobName
            });
            btnContainer.appendChild(createButton(testCmd, context));
          } else {
            btnContainer.appendChild(createRerunActionButton(checkName, row, context));
          }

          const overrideContext = CM.getOverrideContext(checkName);
          const overrideCmd = Object.assign({}, cmd, {
            command: '/override "' + overrideContext + '"',
            label: 'Override',
            description: '/override "' + overrideContext + '"',
            style: 'warning'
          });
          btnContainer.appendChild(createButton(overrideCmd, context));
        }

        for (const dyn of (profile.dynamicCommands || [])) {
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

  /**
   * Inject a compact approve/LGTM toolbar into the review-changes panel on the
   * "Files changed" tab.  No-ops when the current page is not the files tab or
   * when no matching `/lgtm` or `/approve` commands exist in the active profiles
   * or repo-level extra commands.
   * @param {Object[]} profiles      - Matched, enabled profile objects.
   * @param {Object[]} extraCommands - Additional commands from repo overrides.
   */
  function injectReviewToolbar(profiles, extraCommands) {
    const isFilesTab = window.location.pathname.includes('/files') ||
                       document.querySelector('.js-diff-progressive-container');
    if (!isFilesTab) return;

    if (document.querySelector('.ghbcp-review-toolbar')) return;

    const reviewForm = document.querySelector('.js-reviews-container, #review-changes-modal, .pull-request-review-menu');
    if (!reviewForm) return;

    const toolbar = document.createElement('div');
    toolbar.className = 'ghbcp-review-toolbar';
    toolbar.dataset.ghbcpInjected = 'true';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Bot Commands');

    const REVIEW_COMMANDS = ['/lgtm', '/approve'];
    const approveCommands = [];
    for (const profile of profiles) {
      for (const cmd of profile.globalCommands) {
        if (REVIEW_COMMANDS.includes(cmd.command)) {
          approveCommands.push(cmd);
        }
      }
    }
    for (const cmd of (extraCommands || [])) {
      if (REVIEW_COMMANDS.includes(cmd.command)) {
        approveCommands.push(cmd);
      }
    }

    if (approveCommands.length === 0) return;

    for (const cmd of approveCommands) {
      toolbar.appendChild(createButton(cmd, { repoName: currentRepo, prNumber: getPRNumber() }));
    }

    if (reviewForm.parentElement) {
      reviewForm.parentElement.insertBefore(toolbar, reviewForm);
    }
  }

  /**
   * Inject a command bar inside an open review dialog (`div[role="dialog"]`).
   * No-ops when no dialog is present, the bar is already injected, or there is
   * no textarea in the dialog.
   * @param {Object[]} profiles      - Matched, enabled profile objects.
   * @param {Object[]} extraCommands - Additional commands from repo overrides.
   */
  function injectReviewDialogBar(profiles, extraCommands) {
    const dialog = document.querySelector('div[role="dialog"][aria-modal="true"]');
    if (!dialog) return;
    if (dialog.querySelector('.ghbcp-command-bar')) return;

    const textarea = dialog.querySelector('textarea');
    if (!textarea) return;

    const bar = document.createElement('div');
    bar.className = 'ghbcp-command-bar';
    bar.dataset.ghbcpInjected = 'true';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Bot Commands');
    bar.style.margin = '0 0 8px 0';

    bar.appendChild(buildBarHeader(lastPluginData, inject));

    bar.appendChild(buildCommandGroups(profiles, extraCommands));

    const fieldset = textarea.closest('fieldset');
    if (fieldset && fieldset.parentElement) {
      fieldset.parentElement.insertBefore(bar, fieldset);
    } else if (textarea.parentElement) {
      textarea.parentElement.insertBefore(bar, textarea.parentElement.firstChild);
    }
  }

  /**
   * Register keyboard shortcuts from all matching profiles. Removes any previously
   * registered listener before re-registering so shortcut bindings stay fresh.
   * @param {Object[]} profiles - Enabled, matched profile objects.
   */
  function registerShortcuts(profiles) {
    document.removeEventListener('keydown', handleShortcut);
    shortcutMap = {};

    for (const profile of profiles) {
      for (const cmd of profile.globalCommands) {
        if (cmd.shortcut) {
          shortcutMap[cmd.shortcut.toLowerCase()] = cmd;
        }
      }
    }

    document.addEventListener('keydown', handleShortcut);
  }

  /**
   * Handle a keyboard shortcut event. Ignores events targeting text inputs or
   * any active GHBCP overlay (job picker / input popover) to prevent accidental
   * command posting while the user is interacting with the extension's own UI.
   * @param {KeyboardEvent} e
   */
  function handleShortcut(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    // Suppress shortcuts when a GHBCP overlay is open to prevent accidental posts
    if (document.querySelector('.ghbcp-popover, .ghbcp-job-picker')) return;

    const parts = [];
    if (e.altKey) parts.push('alt');
    if (e.ctrlKey) parts.push('ctrl');
    if (e.shiftKey) parts.push('shift');
    if (e.metaKey) parts.push('meta');
    parts.push(e.key.toLowerCase());
    const combo = parts.join('+');

    const cmd = shortcutMap[combo];
    if (cmd) {
      e.preventDefault();
      handleCommandClick(cmd, { repoName: currentRepo, prNumber: getPRNumber() }, null);
    }
  }

  /**
   * Main injection entry point. Loads config, resolves matching profiles and plugin
   * data, then injects the command bar, check buttons, review toolbar, and shortcuts.
   * No-ops if the extension is disabled, the page is not a PR, or context is invalid.
   */
  async function inject() {
    try {
      if (!CM.isContextValid()) return;
      if (!isPRPage()) return;

      config = await CM.getConfig();
      if (config._migrated) {
        showToast('Bot Commands updated to v' + config.version + ' — built-in profiles refreshed', 'success');
        delete config._migrated;
      }
      if (!config.globalSettings.enabled) return;

      currentRepo = detectRepo();
      if (!currentRepo) return;
      if (CM.isRepoExcluded(config, currentRepo)) return;

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

      lastPresubmitJobs = await fetchPresubmitJobs();
      lastGithubToken = await CM.getGithubToken();

      if (config.globalSettings.prowAutoDetect !== false) {
        const hasProwSignals = detectProwSignals() ||
          (lastPluginData && lastPluginData.plugins && lastPluginData.plugins.length > 0) ||
          (lastPresubmitJobs && lastPresubmitJobs.length > 0);
        if (!hasProwSignals) {
          profiles = profiles.filter(p => !CM.isProwProfile(p.id));
          if (profiles.length === 0) return;
        }
      }

      const extraCommands = CM.getExtraCommands(config, currentRepo);

      injectGlobalCommandBar(profiles, extraCommands);
      injectCheckButtons(profiles);
      injectReviewToolbar(profiles, extraCommands);
      injectReviewDialogBar(profiles, extraCommands);
      registerShortcuts(profiles);
    } catch (e) {
      console.error('[GHBCP] inject() failed:', e);
    }
  }

  /**
   * Debounce wrapper for `inject` to avoid redundant re-injections when multiple
   * DOM mutations or navigation events fire in rapid succession.
   */
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
          // Skip our own injected elements — their role="dialog" and textarea
          // contents must not retrigger injection, or the picker/popover would
          // be removed 50 ms after opening by the debounced inject() call.
          const cls = typeof node.className === 'string' ? node.className : '';
          if (/\bghbcp-/.test(cls)) continue;

          if (node.querySelector && (
            node.querySelector('textarea') ||
            node.querySelector('.merge-status-list') ||
            node.querySelector('section[aria-label="Checks"]') ||
            node.matches && (
              node.matches('.merge-status-item, .js-merge-status-check-item') ||
              node.matches(CHECKS_SECTION_SELECTOR) ||
              node.matches('div[role="dialog"]')
            ) ||
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
