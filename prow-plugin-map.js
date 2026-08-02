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
    commands: ['/retest', '/retest-required', '/test', '/ok-to-test'],
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
    commands: ['/wip'],
    description: 'Work in progress'
  },
  'retitle': {
    commands: ['/retitle'],
    description: 'Rename PR title'
  },
  'cherrypick': {
    commands: ['/cherry-pick', '/cherrypick'],
    description: 'Cherry-pick to branch'
  },
  'jira-lifecycle-plugin': {
    commands: ['/jira', '/verified'],
    description: 'Jira lifecycle & pre-merge verification'
  },
  'payload-testing-prow-plugin': {
    commands: ['/payload', '/payload-job', '/payload-with-prs', '/payload-job-with-prs',
      '/payload-aggregate', '/payload-aggregate-with-prs', '/payload-abort'],
    description: 'Release payload testing'
  },
  'publicize': {
    commands: ['/publicize'],
    description: 'Publish private repo changes upstream'
  },
  'multi-pr-prow-plugin': {
    commands: ['/testwith'],
    description: 'Multi-PR test triggering'
  },
  'backport-verifier': {
    commands: ['/validate-backports'],
    description: 'Backport commit validation'
  },
  'pipeline-controller': {
    commands: ['/pipeline'],
    description: 'Two-stage gated pipelines'
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
