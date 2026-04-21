// Prow plugin name → slash commands mapping
const GHBCP_PROW_PLUGIN_MAP = {
  'approve': {
    commands: ['/approve', '/approve cancel'],
    description: 'PR approval workflow'
  },
  'lgtm': {
    commands: ['/lgtm', '/lgtm cancel'],
    description: 'Looks Good To Me'
  },
  'hold': {
    commands: ['/hold', '/hold cancel'],
    description: 'Hold/unhold PR merging'
  },
  'trigger': {
    commands: ['/retest', '/retest-required', '/test'],
    description: 'Trigger CI tests'
  },
  'assign': {
    commands: ['/assign', '/unassign', '/cc', '/uncc'],
    description: 'Assign reviewers'
  },
  'lifecycle': {
    commands: ['/close', '/reopen', '/lifecycle'],
    description: 'Issue/PR lifecycle'
  },
  'label': {
    commands: ['/label', '/remove-label'],
    description: 'Label management'
  },
  'milestone': {
    commands: ['/milestone'],
    description: 'Milestone management'
  },
  'override': {
    commands: ['/override'],
    description: 'Override failed checks'
  },
  'wip': {
    commands: ['/wip', '/hold'],
    description: 'Work in progress'
  },
  'retitle': {
    commands: ['/retitle'],
    description: 'Rename PR title'
  },
  'cherrypick': {
    commands: ['/cherry-pick'],
    description: 'Cherry-pick to branch'
  }
};

// Reverse map: command → plugin name
const GHBCP_COMMAND_TO_PLUGIN = {};
for (const [plugin, info] of Object.entries(GHBCP_PROW_PLUGIN_MAP)) {
  for (const cmd of info.commands) {
    GHBCP_COMMAND_TO_PLUGIN[cmd] = plugin;
  }
}

if (typeof window !== 'undefined') {
  window.GHBCP = window.GHBCP || {};
  window.GHBCP.ProwPluginMap = GHBCP_PROW_PLUGIN_MAP;
  window.GHBCP.CommandToPlugin = GHBCP_COMMAND_TO_PLUGIN;
}
