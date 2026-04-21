// GitHub Bot Command Palette — Background Service Worker
importScripts('vendor/js-yaml.min.js');

const STORAGE_KEY = 'ghbcp_config';
const CACHE_KEY = 'ghbcp_plugin_cache';

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
