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

async function getConfig() {
  return new Promise(resolve => {
    chrome.storage.sync.get(STORAGE_KEY, result => {
      resolve(result[STORAGE_KEY] || null);
    });
  });
}

async function getCache() {
  return new Promise(resolve => {
    chrome.storage.local.get(CACHE_KEY, result => {
      resolve(result[CACHE_KEY] || {});
    });
  });
}

async function setCache(cache) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [CACHE_KEY]: cache }, resolve);
  });
}

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

function buildConfigFileUrl(source, org, repoName) {
  if (source.format === 'sharded') {
    const basePath = source.pathTemplate.replace(/\/$/, '');
    return `https://github.com/${source.configRepo}/blob/${source.branch}/${basePath}/${org}/${repoName}/_pluginconfig.yaml`;
  } else {
    return `https://github.com/${source.configRepo}/blob/${source.branch}/${source.filePath}`;
  }
}

async function getPresubmitsCache() {
  return new Promise(resolve => {
    chrome.storage.local.get(PRESUBMITS_CACHE_KEY, result => {
      resolve(result[PRESUBMITS_CACHE_KEY] || {});
    });
  });
}

async function setPresubmitsCache(cache) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [PRESUBMITS_CACHE_KEY]: cache }, resolve);
  });
}

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
