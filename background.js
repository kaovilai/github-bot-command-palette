// GitHub Bot Command Palette — Background Service Worker
importScripts('vendor/js-yaml.min.js');

const STORAGE_KEY = 'ghbcp_config';
const CACHE_KEY = 'ghbcp_plugin_cache';

const PRESUBMITS_CACHE_KEY = 'ghbcp_presubmits_cache';

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

  try {
    const yamlText = await fetchYaml(source, org, repoName);
    const plugins = extractPlugins(yamlText, fullRepo, org);

    sourceCache.repos[fullRepo] = {
      fetchedAt: Date.now(),
      plugins,
      error: null
    };
    cache[source.id] = sourceCache;
    await setCache(cache);

    return {
      plugins,
      configFileUrl: buildConfigFileUrl(source, org, repoName),
      cachedAt: Date.now()
    };
  } catch (err) {
    sourceCache.repos[fullRepo] = {
      fetchedAt: Date.now(),
      plugins: null,
      error: err.message
    };
    cache[source.id] = sourceCache;
    await setCache(cache);
    return null;
  }
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
    const basePath = source.pathTemplate.replace(/\/$/, '');
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
  const knownPlugins = ['approve', 'lgtm', 'hold', 'trigger', 'assign', 'lifecycle',
    'label', 'milestone', 'override', 'wip', 'retitle', 'cherrypick'];

  for (const pluginName of knownPlugins) {
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
    const basePath = source.pathTemplate.replace(/\/$/, '');
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
 * Fetch the list of presubmit CI jobs for a repo/branch from the Prow config.
 * @param {string}      repo         - Full `org/repo` string.
 * @param {string|null} branch       - Target branch hint from the page DOM.
 * @param {boolean}     forceRefresh - Bypass TTL cache.
 * @param {string|null} prNumber     - PR number used to resolve branch via API.
 * @returns {Promise<{jobs: Object[]|null}>}
 */
async function handleGetPresubmitJobs(repo, branch, forceRefresh, prNumber) {
  const config = await getConfig();
  if (!config || !config.pluginConfigSources) {
    return { jobs: null };
  }

  const source = config.pluginConfigSources.find(s => s.enabled && s.presubmitsBasePath);
  if (!source) return { jobs: null };

  const resolvedBranch = await resolveBaseBranch(repo, prNumber, branch);
  if (!resolvedBranch) return { jobs: null };

  const [org, repoName] = repo.split('/');
  const cacheKey = `${repo}/${resolvedBranch}`;
  const cache = await getPresubmitsCache();
  const ttlMs = (source.cacheTTLMinutes || 60) * 60 * 1000;

  if (!forceRefresh && cache[cacheKey] && cache[cacheKey].fetchedAt && (Date.now() - cache[cacheKey].fetchedAt < ttlMs)) {
    return { jobs: cache[cacheKey].jobs || null };
  }

  try {
    const basePath = source.presubmitsBasePath.replace(/\/$/, '');
    const fileName = `${org}-${repoName}-${resolvedBranch}-presubmits.yaml`;
    const url = `https://raw.githubusercontent.com/${source.configRepo}/${source.branch}/${basePath}/${org}/${repoName}/${fileName}`;

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const yamlText = await resp.text();
    const parsed = jsyaml.load(yamlText);

    const jobs = [];
    if (parsed && parsed.presubmits) {
      const entries = parsed.presubmits[repo] || [];
      for (const entry of entries) {
        if (entry.rerun_command) {
          const name = entry.rerun_command.replace(/^\/test\s+/, '');
          jobs.push({
            name,
            context: entry.context || '',
            always_run: entry.always_run || false,
            optional: entry.optional || false
          });
        }
      }
    }

    cache[cacheKey] = { fetchedAt: Date.now(), jobs };
    await setPresubmitsCache(cache);
    return { jobs };
  } catch (err) {
    cache[cacheKey] = { fetchedAt: Date.now(), jobs: null, error: err.message };
    await setPresubmitsCache(cache);
    return { jobs: null };
  }
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
    const plugins = extractPlugins(yamlText, repo, org);
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
