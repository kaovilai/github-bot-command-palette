# Privacy Policy — GitHub Bot Command Palette

_Last updated: 2026-10-16_

GitHub Bot Command Palette ("the extension") adds buttons for CI/bot slash
commands (`/lgtm`, `/retest`, `/override`, …) to GitHub pull request pages.
The developer does not operate any server, and the extension does not collect,
receive, or store any data about you.

## What the extension accesses

- **GitHub pull request pages** (`github.com`): the extension reads the page
  (PR title, comment box, Checks section) in your browser to place buttons and
  to list the CI jobs you can re-run or override. This content is processed
  locally and is never sent to the developer.
- **Public CI metadata**: to resolve job names and rehearsal results, the
  extension makes requests to `api.github.com`, `raw.githubusercontent.com`,
  `gcs.ci.openshift.org`, `gcsweb-ci.apps.ci.l2s4.p1.openshiftapps.com`, and
  `storage.googleapis.com`. These requests contain repository names, PR
  numbers, and file paths needed for the lookup. They go directly from your
  browser to those services and are subject to their own privacy policies.
- **Update check** (side-loaded installs only): the extension fetches this project's
  public `manifest.json` from `raw.githubusercontent.com` to compare version numbers.
  The request carries no personal data. Chrome Web Store installs skip it.

## What the extension stores

- **Settings** (bot profiles, repo patterns, custom commands): stored in
  `chrome.storage.sync`, which Chrome syncs across your signed-in Chrome
  profiles via your Google account. The developer cannot see it.
- **Optional GitHub Personal Access Token**: if you choose to paste one to
  enable one-click GitHub Actions reruns, it is stored in
  `chrome.storage.local` on your device only — never synced and never included
  in settings export. It is sent only to `api.github.com`, only when you click
  **Rerun** or **Verify Token**. You can remove it at any time in Settings.
- **Short-lived caches** of public CI configuration, kept locally to avoid
  repeat requests.

## What the extension does not do

- No analytics, telemetry, advertising, or tracking.
- No data is sold, shared with third parties, or used for anything other than
  the extension's single purpose.
- No remote code is loaded; all code ships inside the extension package.

## Your choices

Uninstalling the extension removes its local data. Synced settings can be
cleared from Chrome's sync settings.

## Contact

Questions or concerns: open an issue at
<https://github.com/kaovilai/github-bot-command-palette/issues>.
