// GitHub Bot Command Palette — Background Service Worker
importScripts('vendor/js-yaml.min.js');

const STORAGE_KEY = 'ghbcp_config';
const CACHE_KEY = 'ghbcp_plugin_cache';

const PRESUBMITS_CACHE_KEY = 'ghbcp_presubmits_cache';

// Plugin names recognised in top-level YAML sections (e.g. `approve: [{repos: [...]}]`).
// Must stay in sync with the keys of GHBCP_PROW_PLUGIN_MAP in prow-plugin-map.js.
const KNOWN_PROW_PLUGINS = [
  'approve', 'lgtm', 'hold', 'trigger', 'assign', 'lifecycle',
  'label', 'milestone', 'override', 'wip', 'retitle', 'cherrypick'
];

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'getEnabledPlugins') {
    handleGetEnabledPlugins(msg.repo, false).then(sendResponse);
    return true;
  }
  if (msg.action === 'refreshPlugins') {
    handleGetEnabledPlugins(msg.repo, true).then(sendResponse);
    return true;
  }
  if (msg.action === 'testPluginSource') {
    handleTestSource(msg.source, msg.testRepo).then(sendResponse);
    return true;
  }
  if (msg.action === 'getPresubmitJobs') {
    handleGetPresubmitJobs(msg.repo, msg.branch, msg.forceRefresh, msg.prNumber).then(sendResponse);
    return true;
  }
  if (msg.action === 'getRehearsalJobs') {
    handleGetRehearsalJobs(msg.url).then(sendResponse);
    return true;
  }
  if (msg.action === 'getRepoBranches') {
    handleGetRepoBranches(msg.repo).then(sendResponse);
    return true;
  }
});

function storageGet(area, key, defaultValue) {
  return new Promise(resolve => {
    chrome.storage[area].get(key, result => {
      if (chrome.runtime.lastError) {
        resolve(defaultValue);
        return;
      }
      resolve(result[key] !== undefined ? result[key] : defaultValue);
    });
  });
}

function storageSet(area, key, value) {
  return new Promise((resolve, reject) => {
    chrome.storage[area].set({ [key]: value }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

async function getConfig() {
  return storageGet('sync', STORAGE_KEY, null);
}

async function getCache() {
  return storageGet('local', CACHE_KEY, {});
}

async function setCache(cache) {
  return storageSet('local', CACHE_KEY, cache);
}

async function getPresubmitsCache() {
  return storageGet('local', PRESUBMITS_CACHE_KEY, {});
}

async function setPresubmitsCache(cache) {
  return storageSet('local', PRESUBMITS_CACHE_KEY, cache);
}

/**
 * Retrieve the enabled plugins for `repo` by querying all configured plugin sources.
 * @param {string}  repo         - Repository in `org/repo` format.
 * @param {boolean} forceRefresh - When true, bypass the TTL cache and re-fetch.
 * @returns {Promise<{plugins: string[]|null, configFileUrl: string|null, cachedAt: number|null}>}
 */
async function handleGetEnabledPlugins(repo, forceRefresh) {
  const config = await getConfig();
  if (!config || !config.pluginConfigSources || config.pluginConfigSources.length === 0) {
    return { plugins: null, configFileUrl: null, cachedAt: null };
  }

  const enabledSources = config.pluginConfigSources.filter(s => s.enabled);
  if (enabledSources.length === 0) {
    return { plugins: null, configFileUrl: null, cachedAt: null };
  }

  const [org, repoName] = repo.split('/');
  let allPlugins = new Set();
  let configFileUrl = null;
  let cachedAt = null;
  let foundInAnySource = false;

  for (const source of enabledSources) {
    const result = await getPluginsFromSource(source, org, repoName, repo, forceRefresh);
    if (result && result.plugins) {
      foundInAnySource = true;
      for (const p of result.plugins) allPlugins.add(p);
      if (!configFileUrl) configFileUrl = result.configFileUrl;
      if (!cachedAt || result.cachedAt > cachedAt) cachedAt = result.cachedAt;
    }
  }

  if (!foundInAnySource) {
    return { plugins: null, configFileUrl: null, cachedAt: null };
  }

  return {
    plugins: Array.from(allPlugins),
    configFileUrl,
    cachedAt
  };
}

/**
 * Fetch enabled plugins for a single source, using the local cache when fresh.
 * @param {Object} source    - Plugin config source descriptor from user settings.
 * @param {string} org       - GitHub organisation name.
 * @param {string} repoName  - Repository name (without org prefix).
 * @param {string} fullRepo  - Full `org/repo` string.
 * @param {boolean} forceRefresh - Bypass TTL and force a network fetch.
 * @returns {Promise<{plugins: string[], configFileUrl: string, cachedAt: number}|null>}
 */
async function getPluginsFromSource(source, org, repoName, fullRepo, forceRefresh) {
  const cache = await getCache();
  const sourceCache = cache[source.id] || { repos: {} };
  const repoCache = sourceCache.repos[fullRepo];
  const ttlMs = (source.cacheTTLMinutes || 60) * 60 * 1000;

  if (!forceRefresh && repoCache && repoCache.fetchedAt && (Date.now() - repoCache.fetchedAt < ttlMs)) {
    if (repoCache.error) return null;
    return {
      plugins: repoCache.plugins,
      configFileUrl: buildConfigFileUrl(source, org, repoName),
      cachedAt: repoCache.fetchedAt
    };
  }

  let plugins;
  try {
    const repoYaml = await fetchYaml(source, org, repoName);
    const repoPlugins = extractPlugins(repoYaml, fullRepo, org);

    let orgPlugins = [];
    if (source.format === 'sharded') {
      try {
        const orgYaml = await fetchOrgYaml(source, org);
        orgPlugins = extractOrgPlugins(orgYaml, fullRepo, org);
      } catch (_) { /* org-level config is optional */ }
    }

    const merged = new Set([...orgPlugins, ...repoPlugins]);
    plugins = Array.from(merged);
  } catch (err) {
    sourceCache.repos[fullRepo] = { fetchedAt: Date.now(), plugins: null, error: err.message };
    cache[source.id] = sourceCache;
    try { await setCache(cache); } catch (_) { /* best effort */ }
    return null;
  }

  sourceCache.repos[fullRepo] = { fetchedAt: Date.now(), plugins, error: null };
  cache[source.id] = sourceCache;
  // Cache write is best-effort; a storage failure should not suppress the result.
  try { await setCache(cache); } catch (_) { /* best effort */ }

  return {
    plugins,
    configFileUrl: buildConfigFileUrl(source, org, repoName),
    cachedAt: Date.now()
  };
}

/**
 * Fetch the raw YAML config file for the given source and repo.
 * @param {Object} source   - Plugin config source descriptor.
 * @param {string} org      - GitHub organisation name.
 * @param {string} repoName - Repository name.
 * @returns {Promise<string>} Raw YAML text.
 * @throws {Error} When the HTTP response is not OK.
 */
async function fetchYaml(source, org, repoName) {
  let url;
  if (source.format === 'sharded') {
    const basePath = source.pathTemplate.replace(/\/+$/, '');
    url = `https://raw.githubusercontent.com/${source.configRepo}/${source.branch}/${basePath}/${org}/${repoName}/_pluginconfig.yaml`;
  } else {
    url = `https://raw.githubusercontent.com/${source.configRepo}/${source.branch}/${source.filePath}`;
  }

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} fetching ${url}`);
  }
  return resp.text();
}

/**
 * Fetch the org-level plugin config YAML for sharded sources.
 * @param {Object} source - Plugin config source descriptor.
 * @param {string} org    - GitHub organisation name.
 * @returns {Promise<string>} Raw YAML text.
 * @throws {Error} When the HTTP response is not OK.
 */
async function fetchOrgYaml(source, org) {
  const basePath = source.pathTemplate.replace(/\/+$/, '');
  const url = `https://raw.githubusercontent.com/${source.configRepo}/${source.branch}/${basePath}/${org}/_pluginconfig.yaml`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} fetching ${url}`);
  }
  return resp.text();
}

/**
 * Collect external plugin names into `plugins`. Prow's hook server matches
 * external_plugins entries keyed by either the full repo OR the org — a
 * union, not a precedence — and external plugins are not subject to
 * plugins.<org>.excluded_repos.
 * @param {Object} parsed   - Parsed plugin config YAML.
 * @param {string} fullRepo - Full `org/repo` string.
 * @param {string} org      - GitHub organisation name.
 * @param {Set}    plugins  - Accumulator set (mutated).
 */
function collectExternalPlugins(parsed, fullRepo, org, plugins) {
  if (!parsed.external_plugins) return;
  for (const key of [fullRepo, org]) {
    const entry = parsed.external_plugins[key];
    if (Array.isArray(entry)) {
      for (const p of entry) {
        if (p && p.name) plugins.add(p.name);
      }
    }
  }
}

/**
 * Extract org-default plugins from an org-level YAML config, respecting excluded_repos.
 * @param {string} yamlText - Raw org-level YAML content.
 * @param {string} fullRepo - Full `org/repo` string.
 * @param {string} org      - GitHub organisation name.
 * @returns {string[]} Plugin names from org defaults (empty if repo is excluded).
 */
function extractOrgPlugins(yamlText, fullRepo, org) {
  const parsed = jsyaml.load(yamlText);
  if (!parsed) return [];

  const plugins = new Set();

  if (parsed.plugins) {
    const entry = parsed.plugins[org];
    if (entry) {
      // excluded_repos only removes the repo from the org's plugins stanza;
      // top-level sections and external plugins still apply to it.
      const excluded = entry.excluded_repos || [];
      const repoName = fullRepo.slice(org.length + 1);
      if (!excluded.includes(repoName)) {
        const pluginList = entry.plugins || (Array.isArray(entry) ? entry : []);
        for (const p of pluginList) plugins.add(p);
      }
    }
  }

  // Also check top-level plugin sections (same as extractPlugins Method 2)
  for (const pluginName of KNOWN_PROW_PLUGINS) {
    if (parsed[pluginName] && Array.isArray(parsed[pluginName])) {
      for (const entry of parsed[pluginName]) {
        if (entry.repos && Array.isArray(entry.repos)) {
          if (entry.repos.includes(fullRepo) || entry.repos.includes(org)) {
            plugins.add(pluginName);
          }
        }
      }
    }
  }

  // external_plugins (cherrypick, jira-lifecycle-plugin, payload-testing-prow-plugin,
  // publicize, ...) are declared at the ORG level for openshift/openshift-priv —
  // repo-level files carry none — so the org pass must parse them too.
  collectExternalPlugins(parsed, fullRepo, org, plugins);

  return Array.from(plugins);
}

/**
 * Parse a Prow plugins YAML string and extract plugin names for the given repo/org.
 * Supports both the `plugins` map format and top-level plugin-section formats.
 * @param {string} yamlText - Raw YAML content.
 * @param {string} fullRepo - Full `org/repo` string.
 * @param {string} org      - GitHub organisation name.
 * @returns {string[]} Deduplicated list of plugin names.
 */
function extractPlugins(yamlText, fullRepo, org) {
  const parsed = jsyaml.load(yamlText);
  if (!parsed) return [];

  const plugins = new Set();

  // Method 1: plugins section — maps org/repo or org to plugin list
  if (parsed.plugins) {
    const entry = parsed.plugins[fullRepo] || parsed.plugins[org];
    if (entry) {
      if (Array.isArray(entry)) {
        for (const p of entry) plugins.add(p);
      } else if (entry.plugins && Array.isArray(entry.plugins)) {
        for (const p of entry.plugins) plugins.add(p);
      }
    }
  }

  // Method 2: top-level plugin sections with repos lists
  // e.g. approve: [{repos: [org/repo], ...}]
  // knownPlugins is derived from KNOWN_PROW_PLUGINS (module-level constant above)
  // so it automatically stays in sync in one place.
  for (const pluginName of KNOWN_PROW_PLUGINS) {
    if (parsed[pluginName] && Array.isArray(parsed[pluginName])) {
      for (const entry of parsed[pluginName]) {
        if (entry.repos && Array.isArray(entry.repos)) {
          if (entry.repos.includes(fullRepo) || entry.repos.includes(org)) {
            plugins.add(pluginName);
          }
        }
      }
    }
  }

  // Method 3: external_plugins section — union of org/repo- and org-keyed
  // entries (e.g. cherrypick, needs-rebase, refresh).
  collectExternalPlugins(parsed, fullRepo, org, plugins);

  return Array.from(plugins);
}

/**
 * Build the GitHub web URL for viewing the plugin config file.
 * @param {Object} source   - Plugin config source descriptor.
 * @param {string} org      - GitHub organisation name.
 * @param {string} repoName - Repository name.
 * @returns {string} GitHub blob URL.
 */
function buildConfigFileUrl(source, org, repoName) {
  if (source.format === 'sharded') {
    const basePath = source.pathTemplate.replace(/\/+$/, '');
    return `https://github.com/${source.configRepo}/blob/${source.branch}/${basePath}/${org}/${repoName}/_pluginconfig.yaml`;
  } else {
    return `https://github.com/${source.configRepo}/blob/${source.branch}/${source.filePath}`;
  }
}

/**
 * Resolve the base branch for a PR, using `hintBranch` if provided,
 * or fetching it from the GitHub REST API as a fallback.
 * @param {string}      repo        - Full `org/repo` string.
 * @param {string|null} prNumber    - PR number string, or null.
 * @param {string|null} hintBranch  - Branch name from the page DOM, if available.
 * @returns {Promise<string|null>} Branch name, or null if unresolvable.
 */
async function resolveBaseBranch(repo, prNumber, hintBranch) {
  if (hintBranch) return hintBranch;
  if (!prNumber) return null;
  try {
    const resp = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}`, {
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.base && data.base.ref ? data.base.ref : null;
  } catch (e) {
    return null;
  }
}

/**
 * Sort branch names for the cherry-pick picker: long-lived release branches
 * (no "/") first, bot/feature branches ("dependabot/...", "copilot/...") last,
 * alphabetical within each group.
 * @param {string[]} branches - Branch names (sorted in place).
 * @returns {string[]} The same array, sorted.
 */
function sortBranchNames(branches) {
  return branches.sort((a, b) =>
    (a.includes('/') - b.includes('/')) || a.localeCompare(b));
}

/**
 * Fetch the branch names of a repo from the GitHub API (unauthenticated),
 * for the cherry-pick branch picker. Paginates up to 3 pages of 100.
 * @param {string} repo - Full `org/repo` string.
 * @returns {Promise<{branches: string[]|null}>}
 */
async function handleGetRepoBranches(repo) {
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return { branches: null };
  const branches = [];
  try {
    for (let page = 1; page <= 3; page++) {
      const resp = await fetch(
        `https://api.github.com/repos/${repo}/branches?per_page=100&page=${page}`,
        { headers: { 'Accept': 'application/vnd.github.v3+json' } }
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (!Array.isArray(data)) break;
      for (const b of data) {
        if (b && b.name) branches.push(b.name);
      }
      if (data.length < 100) break;
    }
  } catch (e) {
    // a partial list from earlier pages is still useful
  }
  if (branches.length === 0) return { branches: null };
  return { branches: sortBranchNames(branches) };
}

// pj-rehearse truncates the REHEARSALNOTIFIER comment table to 25 rows but
// uploads the full affected-jobs listing to GCS and links it from the comment.
// The listing is a plain pipe-table: "Test Name | Repo | Type | Reason", one
// row per job. Only URLs under this prefix are fetched (the URL comes from
// page DOM, so it must be allowlisted here, not trusted).
const REHEARSAL_LIST_URL_PREFIX = 'https://gcsweb-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/test-platform-results/pj-rehearse/';

function isAllowedRehearsalListUrl(url) {
  return typeof url === 'string' && url.startsWith(REHEARSAL_LIST_URL_PREFIX);
}

/**
 * Parse the pj-rehearse affected-jobs pipe-table into job objects.
 * @param {string} text - Raw listing ("Test Name | Repo | Type | Reason" header + rows).
 * @returns {{name: string, repo: string, type: string, reason: string}[]}
 */
function parseRehearsalJobList(text) {
  const jobs = [];
  if (!text) return jobs;
  for (const line of text.split('\n')) {
    const parts = line.split('|').map(p => p.trim());
    const name = parts[0];
    if (!name || name === 'Test Name' || parts.length < 2) continue;
    jobs.push({ name, repo: parts[1] || '', type: parts[2] || '', reason: parts[3] || '' });
  }
  return jobs;
}

/**
 * Fetch and parse the full affected-jobs listing linked from a
 * REHEARSALNOTIFIER comment.
 * @param {string} url - GCS listing URL scraped from the comment.
 * @returns {Promise<{jobs: Object[]|null}>}
 */
async function handleGetRehearsalJobs(url) {
  if (!isAllowedRehearsalListUrl(url)) return { jobs: null };
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const jobs = parseRehearsalJobList(await resp.text());
    return { jobs: jobs.length > 0 ? jobs : null };
  } catch (e) {
    return { jobs: null };
  }
}

// Fallback presubmit source: when no configured plugin source provides a
// presubmitsBasePath (e.g. default config ships no sources, or a stored source
// predates the field), rerun_command targets are still resolved from the
// openshift/release Prow job config instead of falling back to the raw check
// context. Lookups for repos not onboarded to OpenShift CI simply 404 and are
// cached as empty.
const DEFAULT_PRESUBMIT_SOURCE = {
  name: 'OpenShift CI (openshift/release)',
  configRepo: 'openshift/release',
  branch: 'master',
  presubmitsBasePath: 'ci-operator/jobs',
  cacheTTLMinutes: 60
};

/**
 * Pick the plugin config source used for presubmit job lookups.
 * Prefers an enabled configured source with a presubmitsBasePath; otherwise
 * falls back to DEFAULT_PRESUBMIT_SOURCE.
 * @param {Object|null} config - Stored extension config, or null.
 * @returns {Object} Source descriptor with a presubmitsBasePath.
 */
function resolvePresubmitSource(config) {
  const sources = (config && config.pluginConfigSources) || [];
  return sources.find(s => s.enabled && s.presubmitsBasePath) || DEFAULT_PRESUBMIT_SOURCE;
}

/**
 * Fetch the list of presubmit CI jobs for a repo/branch from the Prow config.
 * @param {string}      repo         - Full `org/repo` string.
 * @param {string|null} branch       - Target branch hint from the page DOM.
 * @param {boolean}     forceRefresh - Bypass TTL cache.
 * @param {string|null} prNumber     - PR number used to resolve branch via API.
 * @returns {Promise<{jobs: Object[]|null}>}
 */
async function handleGetPresubmitJobs(repo, branch, forceRefresh, prNumber) {
  const config = await getConfig();
  const source = resolvePresubmitSource(config);

  const resolvedBranch = await resolveBaseBranch(repo, prNumber, branch);
  if (!resolvedBranch) return { jobs: null };

  const [org, repoName] = repo.split('/');
  const cacheKey = `${repo}/${resolvedBranch}`;
  const cache = await getPresubmitsCache();
  const ttlMs = (source.cacheTTLMinutes || 60) * 60 * 1000;

  if (!forceRefresh && cache[cacheKey] && cache[cacheKey].fetchedAt && (Date.now() - cache[cacheKey].fetchedAt < ttlMs)) {
    return { jobs: cache[cacheKey].jobs || null };
  }

  let jobs;
  try {
    const basePath = source.presubmitsBasePath.replace(/\/+$/, '');
    const fileName = `${org}-${repoName}-${resolvedBranch}-presubmits.yaml`;
    const url = `https://raw.githubusercontent.com/${source.configRepo}/${source.branch}/${basePath}/${org}/${repoName}/${fileName}`;

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const yamlText = await resp.text();
    const parsed = jsyaml.load(yamlText);

    jobs = [];
    if (parsed && parsed.presubmits) {
      const entries = parsed.presubmits[repo] || [];
      for (const entry of entries) {
        if (entry.rerun_command) {
          const name = entry.rerun_command.replace(/^\/test\s+/, '');
          jobs.push({
            name,
            jobName: entry.name || '',
            context: entry.context || '',
            always_run: entry.always_run || false,
            optional: entry.optional || false
          });
        }
      }
    }
  } catch (err) {
    cache[cacheKey] = { fetchedAt: Date.now(), jobs: null, error: err.message };
    try { await setPresubmitsCache(cache); } catch (_) { /* best effort */ }
    return { jobs: null };
  }

  cache[cacheKey] = { fetchedAt: Date.now(), jobs };
  // Cache write is best-effort; a storage failure should not suppress the result.
  try { await setPresubmitsCache(cache); } catch (_) { /* best effort */ }
  return { jobs };
}

/**
 * Test a plugin config source by fetching its YAML for a sample repo.
 * Used by the settings page to validate source configuration before saving.
 * @param {Object}      source   - Plugin config source descriptor to test.
 * @param {string|null} testRepo - Optional repo to use instead of the default test repo.
 * @returns {Promise<{success: boolean, plugins?: string[], rawLength?: number, configFileUrl?: string, error?: string}>}
 */
async function handleTestSource(source, testRepo) {
  if (!source || !source.configRepo) {
    return { success: false, error: 'Missing config repo' };
  }

  const repo = testRepo || 'test-org/test-repo';
  const [org, repoName] = repo.split('/');

  try {
    const yamlText = await fetchYaml(source, org, repoName);
    const repoPlugins = extractPlugins(yamlText, repo, org);

    let orgPlugins = [];
    if (source.format === 'sharded') {
      try {
        const orgYaml = await fetchOrgYaml(source, org);
        orgPlugins = extractOrgPlugins(orgYaml, repo, org);
      } catch (_) { /* org-level config is optional */ }
    }

    const merged = new Set([...orgPlugins, ...repoPlugins]);
    const plugins = Array.from(merged);
    return {
      success: true,
      plugins,
      rawLength: yamlText.length,
      configFileUrl: buildConfigFileUrl(source, org, repoName)
    };
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
}
